/**
 * OCR service — web. Recognizes text in a schedule screenshot fully
 * in-browser via tesseract.js (wasm). No API keys and no upload: the image
 * never leaves the device. The recognition engine + English model
 * (~5 MB total) are fetched once from tesseract.js's public CDN on first
 * use and cached by the browser after that.
 */

import { createWorker } from 'tesseract.js';

export const OCR_AVAILABLE = true;

export interface OcrResult {
  ok: boolean;
  text: string;
  error?: string;
}

export async function ocrImage(
  uri: string,
  onProgress?: (percent: number) => void,
): Promise<OcrResult> {
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });
    const { data } = await worker.recognize(uri);
    const text = (data.text ?? '').trim();
    if (text.length < 10) {
      return {
        ok: false,
        text: '',
        error:
          'Could not find readable text in that image. Try a sharper screenshot, or copy the text out of the image and paste it instead.',
      };
    }
    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      text: '',
      error: `Screenshot scanning failed: ${e instanceof Error ? e.message : String(e)}. You can paste the schedule text instead.`,
    };
  } finally {
    await worker?.terminate().catch(() => {});
  }
}
