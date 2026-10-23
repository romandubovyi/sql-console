export type ExportKind = 'sheet' | 'doc';

export interface ExportTarget {
  kind: ExportKind;
  fileId: string;
  /** Empty means the query title is used when writing a spreadsheet. */
  sheetName: string;
}

const FILE_ID = /^[a-zA-Z0-9_-]{10,200}$/;
const SHEET_TITLE_LIMIT = 100;

function cleanSheetTitle(value: string): string {
  return value.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SHEET_TITLE_LIMIT);
}

/** Sheet name stored on a query. Blank means the query title is used at write time. */
export function storedSheetName(value: string): string {
  return cleanSheetTitle(value);
}

/** A sheet tab title. Characters Google rejects in a title become spaces. */
export function sheetTitle(value: string, fallback: string): string {
  return cleanSheetTitle(value) || cleanSheetTitle(fallback) || 'Results';
}

/** A1 notation that keeps a sheet title containing spaces or quotes. */
export function sheetRange(title: string, a1: string): string {
  return `'${title.replaceAll("'", "''")}'!${a1}`;
}

export function googleFileUrl(kind: ExportKind, fileId: string): string {
  const path = kind === 'doc' ? 'document' : 'spreadsheets';
  return `https://docs.google.com/${path}/d/${encodeURIComponent(fileId)}/edit`;
}

/** Reads a pasted Sheets or Docs link, or a bare file id. */
export function parseGoogleFileLink(value: string): { fileId: string; kind: ExportKind | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('://') && FILE_ID.test(trimmed)) return { fileId: trimmed, kind: null };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.google.com')) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const marker = parts.indexOf('d');
  const fileId = marker >= 0 ? parts[marker + 1] : '';
  if (!fileId || !FILE_ID.test(fileId)) return null;
  const kind = parts.includes('spreadsheets') ? 'sheet' : parts.includes('document') ? 'doc' : null;
  return { fileId, kind };
}

export function sameExportTarget(left: ExportTarget | null, right: ExportTarget | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.kind === right.kind && left.fileId === right.fileId && left.sheetName === right.sheetName;
}

export function normalizeExportTarget(value: unknown): ExportTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'doc' || record.kind === 'sheet' ? record.kind : null;
  const fileId = typeof record.fileId === 'string' ? record.fileId.trim() : '';
  if (!kind || !FILE_ID.test(fileId)) return null;
  const sheetName = typeof record.sheetName === 'string' ? cleanSheetTitle(record.sheetName) : '';
  return { kind, fileId, sheetName };
}
