/** Reads an uploaded .xlsx/.xls/.csv in the browser (SheetJS, loaded on demand) and picks the sheet to parse. */
import { parseGrid, type Grid, type SourceTable } from './grid';

export async function readWorkbook(data: ArrayBuffer, fileName: string): Promise<SourceTable> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const tables = wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    const grid: Grid = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) : [];
    return parseGrid(grid, fileName, name);
  });
  // Prefer a Screener "Data Sheet"; otherwise the sheet with the most usable rows.
  const best = tables.sort(
    (a, b) => Number(b.layout === 'screener') - Number(a.layout === 'screener') || b.rows.length * b.periods.length - a.rows.length * a.periods.length,
  )[0];
  if (!best) throw new Error('The file contains no sheets.');
  return best;
}
