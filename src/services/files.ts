/**
 * File intake: pick documents, copy them into the app's private sandbox
 * (files never leave the device), and extract text locally.
 *
 * expo-file-system's File/Directory classes have no web implementation
 * (every native method is a no-op stub there — constructing one throws).
 * Native keeps using them for a real sandbox directory on disk. Web instead
 * stores picked bytes as BLOB rows in the `sandbox_blobs` table (see
 * db/schema.ts) and hands out a synthetic "sandbox-blob://<id>" URI in their
 * place; `resolveSandboxImageUri` turns that back into a displayable `data:`
 * URI on demand (unlike a `blob:` object URL, a `data:` URI survives a
 * reload since it's regenerated from durably stored bytes each time).
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { SqlExecutor } from '../db/database';
import { chunksRepo, resourcesRepo } from '../db/repo';
import { makeId } from '../lib/ids';
import { extractPdfText } from '../lib/pdf';
import { chunkResourceText } from '../lib/syllabus';
import type { Resource, ResourceKind } from '../lib/types';

const RESOURCE_DIR = 'resources';
const NOTE_PHOTO_DIR = 'note-photos';
const SANDBOX_DIRS = [RESOURCE_DIR, NOTE_PHOTO_DIR];
const BLOB_SCHEME = 'sandbox-blob://';
const isWeb = Platform.OS === 'web';

function resourcesDir(): Directory {
  const dir = new Directory(Paths.document, RESOURCE_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function sandboxDir(name: string): Directory {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  /** Web only: the underlying Blob, read directly instead of via expo-file-system. */
  file?: Blob;
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
    .map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? null, size: a.size ?? null, file: a.file }));
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

// ---------- web blob storage ----------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Bytes for a picked file/blob-URL, read directly — never via expo-file-system. */
async function readPickedBytes(picked: PickedDocument): Promise<Uint8Array> {
  if (picked.file) return new Uint8Array(await picked.file.arrayBuffer());
  return new Uint8Array(await (await fetch(picked.uri)).arrayBuffer());
}

async function readPickedText(picked: PickedDocument): Promise<string> {
  if (picked.file) return picked.file.text();
  return (await fetch(picked.uri)).text();
}

async function storeBlobWeb(db: SqlExecutor, bytes: Uint8Array, mimeType: string): Promise<string> {
  const id = makeId();
  await db.runAsync(
    `INSERT INTO sandbox_blobs (id, mime_type, bytes, created_at) VALUES (?,?,?,?)`,
    [id, mimeType, bytes, new Date().toISOString()],
  );
  return `${BLOB_SCHEME}${id}`;
}

/**
 * Resolve a sandbox URI to something an <Image> source can use directly.
 * Native URIs are already real file:// paths and pass through unchanged; a
 * "sandbox-blob://" URI (web only) is read back from `sandbox_blobs` and
 * turned into a fresh `data:` URI.
 */
export async function resolveSandboxImageUri(db: SqlExecutor, uri: string): Promise<string> {
  if (!uri.startsWith(BLOB_SCHEME)) return uri;
  const id = uri.slice(BLOB_SCHEME.length);
  const row = await db.getFirstAsync<{ mime_type: string; bytes: ArrayBuffer }>(
    `SELECT mime_type, bytes FROM sandbox_blobs WHERE id = ?`,
    [id],
  );
  if (!row) return uri;
  return `data:${row.mime_type};base64,${bytesToBase64(new Uint8Array(row.bytes))}`;
}

// ---------- sandbox copy ----------

/**
 * Copy a picked file into the app sandbox; returns a URI usable to read it
 * back later (a real file:// URI on native, a "sandbox-blob://" reference
 * on web).
 */
export async function copyIntoSandbox(
  db: SqlExecutor,
  picked: PickedDocument,
  dirName: string = RESOURCE_DIR,
): Promise<string> {
  if (isWeb) {
    const bytes = await readPickedBytes(picked);
    return storeBlobWeb(db, bytes, picked.mimeType ?? 'application/octet-stream');
  }
  const dir = dirName === RESOURCE_DIR ? resourcesDir() : sandboxDir(dirName);
  const safeName = picked.name.replace(/[^\w.\- ]+/g, '_');
  const dest = new File(dir, `${makeId()}-${safeName}`);
  new File(picked.uri).copySync(dest);
  return dest.uri;
}

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);

/** Validation for a picked note photo — separate list from document imports. */
export function validateImportedImage(name: string, size: number | null): string | null {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return `Unsupported image type "${ext || 'none'}". Supported: JPG, PNG, HEIC, WEBP.`;
  }
  if (size != null && size > MAX_FILE_BYTES) {
    return 'Photo is larger than 25 MB. Please attach a smaller image.';
  }
  return null;
}

/** Copy a picked note photo into its own sandbox subdirectory. */
export async function copyNotePhotoIntoSandbox(db: SqlExecutor, picked: PickedDocument): Promise<string> {
  return copyIntoSandbox(db, picked, NOTE_PHOTO_DIR);
}

/** Read a freshly picked file's text — from the live pick, not sandbox storage. */
export async function readTextFile(picked: PickedDocument): Promise<string> {
  if (isWeb) return readPickedText(picked);
  return new File(picked.uri).text();
}

export interface ExtractionOutcome {
  status: Resource['extractionStatus'];
  error?: string;
  pages: { page: number | null; text: string }[];
}

/**
 * Extract text locally based on file type, from the live pick (before it's
 * copied into the sandbox). Never sends bytes anywhere.
 */
export async function extractText(picked: PickedDocument): Promise<ExtractionOutcome> {
  const lower = picked.name.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      const buf = isWeb ? await readPickedBytes(picked) : new Uint8Array(await new File(picked.uri).arrayBuffer());
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
    const text = isWeb ? await readPickedText(picked) : await new File(picked.uri).text();
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
 * Full intake pipeline: validate → extract → copy to sandbox → chunk → store.
 * Extraction reads from the live pick (works identically on native/web), so
 * it doesn't depend on how — or whether — the sandbox copy succeeds. On
 * extraction failure the resource is still saved with a clear error state so
 * the user can see it and retry / paste text instead.
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

  const outcome = await extractText(picked);
  const sandboxUri = await copyIntoSandbox(db, picked);
  const resource: Resource = {
    id: makeId(),
    courseId,
    kind,
    title: picked.name,
    fileUri: sandboxUri,
    originalFilename: picked.name,
    addedAt: new Date().toISOString(),
    extractionStatus: outcome.status,
    extractionError: outcome.error,
  };
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

/** Delete the sandbox copy when a resource/note photo is removed. */
export async function deleteSandboxFile(db: SqlExecutor, uri: string | undefined): Promise<void> {
  if (!uri) return;
  if (isWeb) {
    if (!uri.startsWith(BLOB_SCHEME)) return;
    try {
      await db.runAsync(`DELETE FROM sandbox_blobs WHERE id = ?`, [uri.slice(BLOB_SCHEME.length)]);
    } catch {
      // Best effort; orphaned rows are cleaned by "Delete all data".
    }
    return;
  }
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Best effort; orphaned files are cleaned by "Delete all data".
  }
}

/** Remove every stored resource/photo file (used by "Delete all local data"). Native only — web's sandbox_blobs table is cleared directly by wipeScheduleData/wipeAllData. */
export function deleteAllSandboxFiles(): void {
  if (isWeb) return;
  for (const name of SANDBOX_DIRS) {
    try {
      const dir = new Directory(Paths.document, name);
      if (dir.exists) dir.delete();
    } catch {
      // Best effort.
    }
  }
}

/** Write a JSON/text export and return a shareable file. Native only. */
export function writeExportFile(filename: string, contents: string): string {
  const f = new File(Paths.cache, filename);
  if (f.exists) f.delete();
  f.create();
  f.write(contents);
  return f.uri;
}
