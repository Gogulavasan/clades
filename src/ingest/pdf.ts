/** pdf.js glue (browser only): PDF bytes -> lines of text per page. All interpretation lives in src/extract/pdf.ts. */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfPage } from '../extract/pdf';

const MAX_PAGES = 800;
const SAME_LINE_TOLERANCE = 2.5;

interface Item {
  str: string;
  x: number;
  y: number;
}

export async function readPdf(data: ArrayBuffer, onProgress: (done: number, total: number) => void): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const pages: PdfPage[] = [];
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it) || it.str.trim() === '') continue;
      items.push({ str: it.str, x: Number(it.transform[4]), y: Number(it.transform[5]) });
    }
    // Rebuild visual lines: same baseline (top of page first), then left to right.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Item[][] = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last?.[0] && Math.abs(last[0].y - it.y) <= SAME_LINE_TOLERANCE) last.push(it);
      else lines.push([it]);
    }
    pages.push({ page: n, lines: lines.map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ')) });
    page.cleanup();
    if (n % 10 === 0 || n === total) onProgress(n, total);
  }
  await doc.destroy();
  return pages;
}
