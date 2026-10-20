export const PAGE_SIZES = [25, 50, 100, 250] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 100;

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

export function pageCount(totalRows: number | null, pageSize: number): number | null {
  if (totalRows == null || pageSize <= 0) return null;
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

export function canGoNext(
  pageIndex: number,
  pageSize: number,
  totalRows: number | null,
  rowCount: number,
): boolean {
  if (pageIndex < 0 || pageSize <= 0) return false;
  if (totalRows != null) return (pageIndex + 1) * pageSize < totalRows;
  return rowCount >= pageSize;
}

export function formatRowRange(
  pageIndex: number,
  pageSize: number,
  rowCount: number,
  totalRows: number | null,
): string {
  if (rowCount === 0) return totalRows === 0 ? '0 rows' : 'No rows on this page';
  const start = pageIndex * pageSize + 1;
  const end = start + rowCount - 1;
  const range = `${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')}`;
  return totalRows == null ? range : `${range} of ${totalRows.toLocaleString('en-US')}`;
}
