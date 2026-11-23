type Cell = string | number | boolean | null | undefined;

/** UTF-8 byte-order mark so spreadsheet apps detect the encoding. */
const BOM = String.fromCharCode(0xfeff);

function escape(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  const s = String(cell);
  // Quote when needed; neutralise spreadsheet formula injection (=, +, -, @ prefixes on text).
  const safe = /^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`${BOM}${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
