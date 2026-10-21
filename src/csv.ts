/** RFC 4180 field. Quotes only when the cell contains a comma, quote, or line break. */
export function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** One header row and one row per preview record. Missing cells become empty fields. */
export function toCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(columns.map((_, index) => csvField(row[index] ?? '')).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** A download name from the query title. Characters that are not letters or digits become hyphens. */
export function csvFilename(title: string): string {
  const slug = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'query'}.csv`;
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
