// Minimal CSV builder — quotes fields containing commas, quotes, or newlines
// and doubles embedded quotes (RFC 4180). Good enough for report exports that
// Jason forwards from his inbox.
export function toCsv(headers: string[], rows: (string | number | boolean | null)[][]): string {
  const escape = (v: string | number | boolean | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows]
    .map((row) => row.map(escape).join(','))
    .join('\r\n');
}
