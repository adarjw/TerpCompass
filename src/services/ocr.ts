/**
 * OCR service — native platforms (iOS/Android).
 *
 * In-app OCR uses tesseract.js, which only runs where wasm + web workers
 * exist (the web build). On phones the better path is already built into the
 * OS: long-press the screenshot → copy text (iOS Live Text / Google Lens),
 * then paste into the import screen. This stub keeps the native bundle free
 * of tesseract.js entirely; Metro picks ocr.web.ts on web.
 */

export const OCR_AVAILABLE = false;

export interface OcrResult {
  ok: boolean;
  text: string;
  error?: string;
}

export async function ocrImage(
  _uri: string,
  _onProgress?: (percent: number) => void,
): Promise<OcrResult> {
  return {
    ok: false,
    text: '',
    error:
      'In-app screenshot scanning is available in the web version. On your phone, long-press the screenshot, copy its text (Live Text / Lens), and paste it here instead.',
  };
}
