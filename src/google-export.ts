import { sheetRange, sheetTitle, type ExportKind } from './export-target.ts';

const DRIVE_LIST = 'https://www.googleapis.com/drive/v3/files';
const CELL_LIMIT = 4_000;
const TABLE_CELL_LIMIT = 2_000;
const BODY_LIMIT = 900_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SharedFile {
  id: string;
  name: string;
  kind: ExportKind;
}

export type GoogleRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'denied' }
  | { status: 'scope' }
  | { status: 'error'; message: string };

export interface SheetWriteInput {
  fileId: string;
  sheetName: string;
  fallbackSheetName: string;
  /** `replace` clears an existing sheet. `create` adds a sheet and leaves the others unchanged. */
  mode: 'replace' | 'create';
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface DocumentWriteInput {
  fileId: string;
  title: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

const SPREADSHEET = 'application/vnd.google-apps.spreadsheet';
const DOCUMENT = 'application/vnd.google-apps.document';

function asFailure(result: Exclude<GoogleRead<unknown>, { status: 'ok' }>): Exclude<GoogleRead<never>, { status: 'ok' }> {
  if (result.status === 'error') return { status: 'error', message: result.message };
  return { status: result.status };
}

export async function listSharedFiles(fetchImpl: FetchLike, signal?: AbortSignal): Promise<GoogleRead<SharedFile[]>> {
  const files: SharedFile[] = [];
  let pageToken = '';
  for (let page = 0; page < 3; page += 1) {
    const url = new URL(DRIVE_LIST);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('fields', 'files(id,name,mimeType),nextPageToken');
    url.searchParams.set('q', `trashed = false and (mimeType = '${SPREADSHEET}' or mimeType = '${DOCUMENT}')`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('corpora', 'allDrives');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const loaded = await requestJson(fetchImpl, url, { signal });
    if (loaded.status !== 'ok') return asFailure(loaded);
    files.push(...sharedFiles(loaded.value));
    const token = record(loaded.value)?.nextPageToken;
    if (typeof token !== 'string' || token === '') return { status: 'ok', value: files };
    pageToken = token;
  }
  return { status: 'ok', value: files };
}

export function sharedFiles(body: unknown): SharedFile[] {
  const files = record(body)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap(item => {
    const file = record(item);
    const id = file?.id;
    const mimeType = file?.mimeType;
    if (typeof id !== 'string' || (mimeType !== SPREADSHEET && mimeType !== DOCUMENT)) return [];
    const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : 'Untitled';
    return [{ id, name, kind: mimeType === DOCUMENT ? 'doc' : 'sheet' }];
  });
}

export async function listSheetTitles(
  fetchImpl: FetchLike,
  fileId: string,
  signal?: AbortSignal,
): Promise<GoogleRead<string[]>> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'sheets.properties.title');
  const loaded = await requestJson(fetchImpl, url, { signal });
  if (loaded.status !== 'ok') return asFailure(loaded);
  return { status: 'ok', value: sheetTitles(loaded.value) };
}

export function sheetTitles(body: unknown): string[] {
  const sheets = record(body)?.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap(item => {
    const title = record(record(item)?.properties)?.title;
    return typeof title === 'string' && title.trim() ? [title] : [];
  });
}

export async function writeSpreadsheet(
  fetchImpl: FetchLike,
  input: SheetWriteInput,
  signal?: AbortSignal,
): Promise<GoogleRead<{ sheetName: string; rows: number }>> {
  if (input.columns.length === 0) return { status: 'error', message: 'The preview has no columns to export.' };
  const title = sheetTitle(input.sheetName, input.fallbackSheetName);
  const values = tableValues(input.columns, input.rows);
  const size = JSON.stringify(values).length;
  if (size > BODY_LIMIT) return { status: 'error', message: 'This page is too large to send in one request.' };

  const existing = await listSheetTitles(fetchImpl, input.fileId, signal);
  if (existing.status !== 'ok') return asFailure(existing);
  const alreadyThere = existing.value.includes(title);
  if (input.mode === 'create') {
    if (alreadyThere) {
      return {
        status: 'error',
        message: `A sheet named “${title}” already exists. Select it to replace its rows, or choose another name.`,
      };
    }
    const added = await requestJson(
      fetchImpl,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}:batchUpdate`,
      { method: 'POST', signal, body: { requests: [{ addSheet: { properties: { title } } }] } },
    );
    if (added.status !== 'ok') return asFailure(added);
  } else if (!alreadyThere) {
    return { status: 'error', message: `This spreadsheet has no sheet named “${title}”. Choose Create a new sheet.` };
  } else {
    const range = sheetRange(title, 'A:ZZ');
    const cleared = await requestJson(
      fetchImpl,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.fileId)}/values/${encodeURIComponent(range)}:clear`,
      { method: 'POST', signal, body: {} },
    );
    if (cleared.status !== 'ok') return asFailure(cleared);
  }

  const written = await requestJson(
    fetchImpl,
    valuesUrl(input.fileId, sheetRange(title, 'A1')),
    { method: 'PUT', signal, body: { values } },
  );
  if (written.status !== 'ok') return asFailure(written);
  return { status: 'ok', value: { sheetName: title, rows: input.rows.length } };
}

export async function writeDocument(
  fetchImpl: FetchLike,
  input: DocumentWriteInput,
  signal?: AbortSignal,
): Promise<GoogleRead<{ rows: number }>> {
  if (input.columns.length === 0) return { status: 'error', message: 'The preview has no columns to export.' };
  const values = tableValues(input.columns, input.rows);
  if (values.length * input.columns.length > TABLE_CELL_LIMIT) {
    return { status: 'error', message: 'This page has too many cells for one Docs table. Choose a smaller page.' };
  }
  const loaded = await requestJson(fetchImpl, documentUrl(input.fileId), { signal });
  if (loaded.status !== 'ok') return asFailure(loaded);
  const endIndex = documentEndIndex(loaded.value);
  if (endIndex == null) return { status: 'error', message: 'The document has no body to append to.' };

  const created = await requestJson(fetchImpl, `${documentUrl(input.fileId)}:batchUpdate`, {
    method: 'POST',
    signal,
    body: {
      requests: [
        {
          insertText: {
            location: { index: Math.max(1, endIndex - 1) },
            text: `${input.title}\n`,
          },
        },
        {
          insertTable: {
            rows: values.length,
            columns: Math.max(1, input.columns.length),
            endOfSegmentLocation: { segmentId: '' },
          },
        },
      ],
    },
  });
  if (created.status !== 'ok') return asFailure(created);

  const filled = await requestJson(fetchImpl, documentUrl(input.fileId), { signal });
  if (filled.status !== 'ok') return asFailure(filled);
  const starts = lastTableCellStarts(filled.value);
  if (starts.length !== values.length * Math.max(1, input.columns.length)) {
    return { status: 'error', message: 'The document table was created, but its cells could not be filled.' };
  }
  const requests = cellWrites(starts, values);
  if (requests.length === 0) return { status: 'ok', value: { rows: input.rows.length } };
  const written = await requestJson(fetchImpl, `${documentUrl(input.fileId)}:batchUpdate`, {
    method: 'POST',
    signal,
    body: { requests },
  });
  if (written.status !== 'ok') return asFailure(written);
  return { status: 'ok', value: { rows: input.rows.length } };
}

export function documentEndIndex(document: unknown): number | null {
  const content = record(record(document)?.body)?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const endIndex = record(content.at(-1))?.endIndex;
  return typeof endIndex === 'number' ? endIndex : null;
}

/** Start index of each cell in the last table, row by row. */
export function lastTableCellStarts(document: unknown): number[] {
  const content = record(record(document)?.body)?.content;
  if (!Array.isArray(content)) return [];
  let table: Record<string, unknown> | null = null;
  for (const block of content) {
    const candidate = record(record(block)?.table);
    if (candidate) table = candidate;
  }
  const rows = table?.tableRows;
  if (!Array.isArray(rows)) return [];
  const starts: number[] = [];
  for (const row of rows) {
    const cells = record(row)?.tableCells;
    if (!Array.isArray(cells)) return [];
    for (const cell of cells) {
      const blocks = record(cell)?.content;
      const startIndex = Array.isArray(blocks) ? record(blocks[0])?.startIndex : null;
      if (typeof startIndex !== 'number') return [];
      starts.push(startIndex);
    }
  }
  return starts;
}

/** Inserts cell text from the end, so an earlier cell keeps the index Docs reported. */
export function cellWrites(starts: readonly number[], values: readonly (readonly string[])[]): { insertText: { location: { index: number }; text: string } }[] {
  const width = values[0]?.length ?? 0;
  if (width === 0) return [];
  const requests: { insertText: { location: { index: number }; text: string } }[] = [];
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const text = values[Math.floor(index / width)]?.[index % width] ?? '';
    if (!text) continue;
    const at = starts[index];
    if (at == null) continue;
    requests.push({ insertText: { location: { index: at }, text } });
  }
  return requests;
}

function tableValues(columns: readonly string[], rows: readonly (readonly string[])[]): string[][] {
  const header = columns.map(limitCell);
  return [header, ...rows.map(row => columns.map((_, index) => limitCell(row[index] ?? '')))];
}

function limitCell(value: string): string {
  return value.length <= CELL_LIMIT ? value : value.slice(0, CELL_LIMIT);
}

function documentUrl(fileId: string): string {
  return `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`;
}

function valuesUrl(fileId: string, range: string): string {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set('valueInputOption', 'RAW');
  return url.toString();
}

async function requestJson(
  fetchImpl: FetchLike,
  url: string | URL,
  init: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<GoogleRead<unknown>> {
  try {
    const response = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return { status: 'ok', value: body };
    return classifyGoogleFailure(response.status, body);
  } catch (cause) {
    const message = cause instanceof Error && cause.message ? cause.message : 'The Google request failed.';
    if (/scope/i.test(message)) return { status: 'scope' };
    return { status: 'error', message };
  }
}

function classifyGoogleFailure(status: number, body: unknown): GoogleRead<never> {
  const message = googleMessage(body) || `Google answered ${status}`;
  if (/scope/i.test(message) || /insufficient/i.test(message)) return { status: 'scope' };
  if (/has not been used|is disabled|enable it by visiting/i.test(message)) return { status: 'error', message };
  if (status === 401 || status === 403 || status === 404) return { status: 'denied' };
  return { status: 'error', message };
}

function googleMessage(body: unknown): string {
  const error = record(record(body)?.error);
  const message = error?.message ?? record(body)?.message;
  return typeof message === 'string' ? message : '';
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
