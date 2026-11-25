/** pdf.js glue (browser only): PDF bytes -> positioned text -> pages. Layout lives in src/extract/layout.ts, interpretation in src/extract/pdf.ts. */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildPage, type PdfPage, type TextItem } from '../extract/layout';

const MAX_PAGES = 800;

export async function readPdf(data: ArrayBuffer, onProgress: (done: number, total: number) => void): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const pages: PdfPage[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it) || it.str.trim() === '') continue;
      items.push({ str: it.str, x: Number(it.transform[4]) - x0, y: Number(it.transform[5]) - y0, w: Number(it.width) || 0 });
    }
    pages.push(buildPage(n, items, x1 - x0, y1 - y0));
    page.cleanup();
    if (n % 10 === 0 || n === total) onProgress(n, total);
  }
  await doc.destroy();
  return pages;
}
