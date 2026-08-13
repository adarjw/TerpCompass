/**
 * File intake: pick documents, copy them into the app's private sandbox
 * (files never leave the device), and extract text locally.
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SqlExecutor } from '../db/database';
import { chunksRepo, resourcesRepo } from '../db/repo';
import { makeId } from '../lib/ids';
import { extractPdfText } from '../lib/pdf';
import { chunkResourceText } from '../lib/syllabus';
import type { Resource, ResourceKind } from '../lib/types';

const RESOURCE_DIR = 'resources';

function resourcesDir(): Directory {
  const dir = new Directory(Paths.document, RESOURCE_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

export async function pickDocument(
  mimeTypes?: string[],
): Promise<PickedDocument | null> {
  const picked = await pickDocuments(mimeTypes, 1);
  return picked[0] ?? null;
}

/** Pick up to `max` files at once (multi-screenshot scans). */
export async function pickDocuments(
  mimeTypes: string[] | undefined,
  max: number,
): Promise<PickedDocument[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: mimeTypes ?? ['application/pdf', 'text/*', 'message/rfc822', '*/*'],
    copyToCacheDirectory: true,
    multiple: max > 1,
  });
  if (result.canceled || result.assets.length === 0) return [];
  return result.assets
    .slice(0, max)
    .map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? null }));
}

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.txt', '.md', '.csv', '.ics', '.eml', '.text', '.markdown', '.json',
]);

export function validateImportedFile(name: string, size: number | null): string | null {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Unsupported file type "${ext || 'none'}". Supported: PDF, TXT, MD, CSV, ICS, EML, JSON.`;
  }
  if (size != null && size > MAX_FILE_BYTES) {
    return 'File is larger than 25 MB. Please attach a smaller file.';
  }
  return null;
}

/** Copy a picked file into the app sandbox; returns the sandboxed URI. */
export function copyIntoSandbox(picked: PickedDocument): string {
  const dir = resourcesDir();
  const safeName = picked.name.replace(/[^\w.\- ]+/g, '_');
  const dest = new File(dir, `${makeId()}-${safeName}`);
  new File(picked.uri).copySync(dest);
  return dest.uri;
}

export async function readTextFile(uri: string): Promise<string> {
  return new File(uri).text();
}

export interface ExtractionOutcome {
  status: Resource['extractionStatus'];
  error?: string;
  pages: { page: number | null; text: string }[];
}

/** Extract text locally based on file type. Never sends bytes anywhere. */
export async function extractText(
  uri: string,
  filename: string,
): Promise<ExtractionOutcome> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      const buf = new Uint8Array(await new File(uri).arrayBuffer());
      const result = extractPdfText(buf);
      const total = result.pages.reduce((n, p) => n + p.text.length, 0);
      if (result.pages.length === 0 || total < 20) {
        return {
          status: 'no_text',
          error:
            'No readable text found in this PDF (it may be scanned images). ' +
            'Paste the text manually, or attach a text version.',
          pages: [],
        };
      }
      return { status: 'ok', pages: result.pages };
    }
    // Plain-text formats.
    const text = await new File(uri).text();
    if (text.trim().length === 0) {
      return { status: 'no_text', error: 'The file is empty.', pages: [] };
    }
    return { status: 'ok', pages: [{ page: null, text }] };
  } catch (e) {
    return {
      status: 'error',
      error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}`,
      pages: [],
    };
  }
}

export interface AttachResult {
  resource: Resource;
  chunkCount: number;
  warning?: string;
}

/**
 * Full intake pipeline: validate → copy to sandbox → extract → chunk → store.
 * On extraction failure the resource is still saved with a clear error state
 * so the user can see it and retry / paste text instead.
 */
export async function attachFileResource(
  db: SqlExecutor,
  courseId: string,
  kind: ResourceKind,
  picked: PickedDocument,
  semesterYear: number,
): Promise<AttachResult> {
  const validation = validateImportedFile(picked.name, picked.size);
  if (validation) throw new Error(validation);

  const sandboxUri = copyIntoSandbox(picked);
  const resource: Resource = {
    id: makeId(),
    courseId,
    kind,
    title: picked.name,
    fileUri: sandboxUri,
    originalFilename: picked.name,
    addedAt: new Date().toISOString(),
    extractionStatus: 'pending',
  };

  const outcome = await extractText(sandboxUri, picked.name);
  resource.extractionStatus = outcome.status;
  resource.extractionError = outcome.error;
  await resourcesRepo.insert(db, resource);

  let chunkCount = 0;
  if (outcome.status === 'ok') {
    const chunks = chunkResourceText(
      {
        resourceId: resource.id,
        courseId,
        sourceFilename: picked.name,
        pages: outcome.pages,
        defaultYear: semesterYear,
      },
      makeId,
    );
    await chunksRepo.insertMany(db, chunks);
    chunkCount = chunks.length;
  }
  return { resource, chunkCount, warning: outcome.error };
}

/** Store pasted text / a link as a resource with chunks. */
export async function attachTextResource(
  db: SqlExecutor,
  courseId: string,
  kind: ResourceKind,
  title: string,
  text: string,
  semesterYear: number,
  url?: string,
): Promise<AttachResult> {
  const resource: Resource = {
    id: makeId(),
    courseId,
    kind,
    title: title || 'Pasted text',
    url,
    originalFilename: title || 'pasted-text',
    addedAt: new Date().toISOString(),
    extractionStatus: text.trim() ? 'ok' : 'no_text',
    extractionError: text.trim() ? undefined : 'No text provided.',
  };
  await resourcesRepo.insert(db, resource);
  let chunkCount = 0;
  if (text.trim()) {
    const chunks = chunkResourceText(
      {
        resourceId: resource.id,
        courseId,
        sourceFilename: resource.originalFilename!,
        pages: [{ page: null, text }],
        defaultYear: semesterYear,
      },
      makeId,
    );
    await chunksRepo.insertMany(db, chunks);
    chunkCount = chunks.length;
  }
  return { resource, chunkCount };
}

/** Delete the sandbox copy when a resource is removed. */
export function deleteSandboxFile(uri: string | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Best effort; orphaned files are cleaned by "Delete all data".
  }
}

/** Remove every stored resource file (used by "Delete all local data"). */
export function deleteAllSandboxFiles(): void {
  try {
    const dir = new Directory(Paths.document, RESOURCE_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // Best effort.
  }
}

/** Write a JSON/text export and return a shareable file. */
export function writeExportFile(filename: string, contents: string): string {
  const f = new File(Paths.cache, filename);
  if (f.exists) f.delete();
  f.create();
  f.write(contents);
  return f.uri;
}
