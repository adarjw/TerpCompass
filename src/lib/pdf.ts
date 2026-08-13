/**
 * Best-effort, fully local PDF text extraction. No cloud OCR, no AI.
 *
 * Handles the common case for syllabi: text stored in content streams
 * (optionally FlateDecode-compressed, inflated via pako) shown with Tj/TJ
 * operators. Scanned/image PDFs yield no text — the caller surfaces an
 * explicit "no text" state and asks the user to paste the content instead.
 *
 * Page numbers are approximated by content-stream order, which matches
 * simple single-stream-per-page documents; citations therefore say
 * "page N" only when extraction produced multiple streams.
 */

import { inflate } from 'pako';

function latin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/** Decode a PDF literal string ( ... ) honoring escape sequences. */
function decodePdfString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    switch (n) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '(': out += '('; break;
      case ')': out += ')'; break;
      case '\\': out += '\\'; break;
      case '\n': break; // line continuation
      default: {
        // Octal escape \ddd
        const oct = /^[0-7]{1,3}/.exec(raw.slice(i));
        if (oct) {
          out += String.fromCharCode(parseInt(oct[0], 8));
          i += oct[0].length - 1;
        } else {
          out += n;
        }
      }
    }
  }
  return out;
}

/** Pull text shown by Tj / TJ / ' / " operators out of one content stream. */
function textFromContentStream(stream: string): string {
  const parts: string[] = [];
  // Balanced-enough literal string matcher: PDF strings rarely nest in Tj args.
  const re = /\((?:[^()\\]|\\.)*\)\s*(Tj|')|\[((?:[^\][\\]|\\.)*)\]\s*TJ|T\*|Td|TD/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    const token = m[0];
    if (token === 'T*' || token === 'Td' || token === 'TD') {
      // Text positioning: often a new line.
      if (parts.length > 0 && parts[parts.length - 1] !== '\n') parts.push('\n');
      continue;
    }
    if (m[1] === 'Tj' || m[1] === "'") {
      const inner = token.slice(token.indexOf('(') + 1, token.lastIndexOf(')'));
      parts.push(decodePdfString(inner));
      if (m[1] === "'") parts.push('\n');
    } else if (m[2] !== undefined) {
      // TJ array: strings interleaved with kerning numbers.
      const strRe = /\((?:[^()\\]|\\.)*\)/g;
      let sm: RegExpExecArray | null;
      while ((sm = strRe.exec(m[2])) !== null) {
        parts.push(decodePdfString(sm[0].slice(1, -1)));
      }
    }
  }
  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface PdfExtractResult {
  pages: { page: number | null; text: string }[];
  /** True when the PDF contained streams we could not read (images/fonts ok). */
  hadUnreadableStreams: boolean;
}

export function extractPdfText(bytes: Uint8Array): PdfExtractResult {
  const raw = latin1(bytes);
  if (!raw.startsWith('%PDF')) {
    return { pages: [], hadUnreadableStreams: false };
  }

  const pageTexts: string[] = [];
  let hadUnreadable = false;

  // Iterate over all stream objects. `stream` keyword is followed by EOL,
  // content runs until the matching `endstream`.
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) !== null) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    // The object dictionary immediately precedes the `stream` keyword.
    const dictStart = raw.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : '';
    let content = raw.slice(start, end);
    // Trim trailing EOL before endstream.
    content = content.replace(/\r?\n$/, '');

    // Skip obvious non-content streams (images, fonts, XML metadata).
    if (/\/Subtype\s*\/Image|\/FontFile|\/Metadata|\/XML/i.test(dict)) {
      streamRe.lastIndex = end;
      continue;
    }

    if (/\/FlateDecode/.test(dict)) {
      try {
        const compressed = new Uint8Array(content.length);
        for (let i = 0; i < content.length; i++) {
          compressed[i] = content.charCodeAt(i) & 0xff;
        }
        content = latin1(inflate(compressed));
      } catch {
        hadUnreadable = true;
        streamRe.lastIndex = end;
        continue;
      }
    } else if (/\/Filter/.test(dict)) {
      // Some other filter (DCT, LZW...) we don't support.
      hadUnreadable = true;
      streamRe.lastIndex = end;
      continue;
    }

    const text = textFromContentStream(content);
    if (text.length > 0) pageTexts.push(text);
    streamRe.lastIndex = end;
  }

  const multi = pageTexts.length > 1;
  return {
    pages: pageTexts.map((text, i) => ({ page: multi ? i + 1 : 1, text })),
    hadUnreadableStreams: hadUnreadable,
  };
}
