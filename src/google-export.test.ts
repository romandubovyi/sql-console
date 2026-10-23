import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cellWrites,
  lastTableCellStarts,
  listSharedFiles,
  sharedFiles,
  sheetTitles,
  spreadsheetValueChunks,
  writeDocument,
  writeSpreadsheet,
} from './google-export.ts';

const FILE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const SPREADSHEET = 'application/vnd.google-apps.spreadsheet';
const DOCUMENT = 'application/vnd.google-apps.document';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function rowCount(body: unknown): number {
  if (!body || typeof body !== 'object' || !('values' in body)) return 0;
  return Array.isArray(body.values) ? body.values.length : 0;
}

function scripted(responses: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: String(input), method: init?.method ?? 'GET', body });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected ${init?.method ?? 'GET'} ${String(input)}`);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { fetchImpl, calls };
}

describe('sharedFiles', () => {
  it('keeps spreadsheets and documents and follows one more page', async () => {
    assert.deepEqual(
      sharedFiles({
        files: [
          { id: 'sheet-id-1111', name: ' Revenue ', mimeType: SPREADSHEET },
          { id: 'doc-id-22222', name: '', mimeType: DOCUMENT },
          { id: 'other-id-333', name: 'Slides', mimeType: 'application/vnd.google-apps.presentation' },
        ],
      }),
      [
        { id: 'sheet-id-1111', name: 'Revenue', kind: 'sheet' },
        { id: 'doc-id-22222', name: 'Untitled', kind: 'doc' },
      ],
    );
    const { fetchImpl, calls } = scripted([
      { body: { files: [{ id: 'sheet-id-1111', name: 'Revenue', mimeType: SPREADSHEET }], nextPageToken: 'next' } },
      { body: { files: [{ id: 'doc-id-22222', name: 'Notes', mimeType: DOCUMENT }] } },
    ]);
    const listed = await listSharedFiles(fetchImpl);
    assert.equal(listed.status, 'ok');
    if (listed.status === 'ok') assert.deepEqual(listed.value.map(file => file.id), ['sheet-id-1111', 'doc-id-22222']);
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? '', /corpora=allDrives/);
    assert.match(calls[0]?.url ?? '', /includeItemsFromAllDrives=true/);
    assert.match(calls[1]?.url ?? '', /pageToken=next/);
  });

  it('reads sheet tab titles', () => {
    assert.deepEqual(sheetTitles({ sheets: [{ properties: { title: 'Daily' } }, { properties: { title: '  ' } }] }), ['Daily']);
  });
});

describe('writeSpreadsheet', () => {
  it('adds a new sheet and writes the page at A1 without clearing other sheets', async () => {
    const { fetchImpl, calls } = scripted([
      { body: { sheets: [{ properties: { title: 'Other' } }] } },
      { body: {} },
      { body: {} },
    ]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: '',
      fallbackSheetName: 'Revenue',
      mode: 'create',
      columns: ['name'],
      rows: [['Ada']],
    });
    assert.deepEqual(written, { status: 'ok', value: { sheetName: 'Revenue', rows: 1 } });
    assert.match(calls[1]?.url ?? '', /:batchUpdate$/);
    assert.deepEqual(calls[1]?.body, { requests: [{ addSheet: { properties: { title: 'Revenue' } } }] });
    assert.equal(calls.some(call => String(call.url).includes(':clear')), false);
    assert.match(calls[2]?.url ?? '', /valueInputOption=RAW/);
    assert.deepEqual(calls[2]?.body, { values: [['name'], ['Ada']] });
  });

  it('writes a sheet that does not fit in one request as later rows', async () => {
    const cell = 'x'.repeat(4_000);
    const { fetchImpl, calls } = scripted([
      { body: { sheets: [{ properties: { title: 'Daily' } }] } },
      { body: {} },
      { body: {} },
      { body: {} },
    ]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: 'Daily',
      fallbackSheetName: 'Revenue',
      mode: 'replace',
      columns: ['name'],
      rows: Array.from({ length: 225 }, () => [cell]),
    });
    assert.equal(written.status, 'ok');
    const puts = calls.filter(call => call.method === 'PUT');
    assert.equal(puts.length, 2);
    assert.match(puts[0]?.url ?? '', /!A1/);
    assert.match(puts[1]?.url ?? '', /!A226/);
    assert.equal(rowCount(puts[0]?.body), 225);
    assert.equal(rowCount(puts[1]?.body), 1);
  });

  it('rejects one sheet row that is still too large after the cell limit', async () => {
    const cell = 'x'.repeat(4_000);
    const width = 230;
    const { fetchImpl, calls } = scripted([]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: 'Daily',
      fallbackSheetName: 'Revenue',
      mode: 'replace',
      columns: Array.from({ length: width }, (_, index) => `c${index}`),
      rows: [Array.from({ length: width }, () => cell)],
    });
    assert.equal(written.status, 'error');
    if (written.status === 'error') assert.match(written.message, /too large/);
    assert.equal(calls.length, 0);
  });

  it('clears an existing sheet when replacing it', async () => {
    const { fetchImpl, calls } = scripted([{ body: { sheets: [{ properties: { title: 'Daily' } }] } }, { body: {} }, { body: {} }]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: 'Daily',
      fallbackSheetName: 'Revenue',
      mode: 'replace',
      columns: ['name'],
      rows: [],
    });
    assert.equal(written.status, 'ok');
    assert.equal(calls.some(call => JSON.stringify(call.body ?? null).includes('addSheet')), false);
    assert.match(calls[1]?.url ?? '', /\/values\/'Daily'!A%3AZZ:clear$/);
  });

  it('does not replace a sheet when the new name already exists', async () => {
    const { fetchImpl, calls } = scripted([{ body: { sheets: [{ properties: { title: 'Daily' } }] } }]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: 'Daily',
      fallbackSheetName: 'Revenue',
      mode: 'create',
      columns: ['name'],
      rows: [],
    });
    assert.equal(written.status, 'error');
    if (written.status === 'error') assert.match(written.message, /already exists/);
    assert.equal(calls.length, 1);
  });

  it('does not create a sheet when replacing one that is missing', async () => {
    const { fetchImpl, calls } = scripted([{ body: { sheets: [{ properties: { title: 'Other' } }] } }]);
    const written = await writeSpreadsheet(fetchImpl, {
      fileId: FILE,
      sheetName: 'Daily',
      fallbackSheetName: 'Revenue',
      mode: 'replace',
      columns: ['name'],
      rows: [],
    });
    assert.equal(written.status, 'error');
    if (written.status === 'error') assert.match(written.message, /no sheet named/);
    assert.equal(calls.length, 1);
  });

  it('reports a missing share as denied and a disabled API as the Google message', async () => {
    const denied = await writeSpreadsheet(
      scripted([{ status: 403, body: { error: { message: 'The caller does not have permission' } } }]).fetchImpl,
      { fileId: FILE, sheetName: 'Daily', fallbackSheetName: 'Revenue', mode: 'replace', columns: ['name'], rows: [] },
    );
    assert.deepEqual(denied, { status: 'denied' });

    const disabled = await writeSpreadsheet(
      scripted([{ status: 403, body: { error: { message: 'Google Sheets API has not been used in project 1 before or it is disabled.' } } }]).fetchImpl,
      { fileId: FILE, sheetName: 'Daily', fallbackSheetName: 'Revenue', mode: 'replace', columns: ['name'], rows: [] },
    );
    assert.equal(disabled.status, 'error');
    if (disabled.status === 'error') assert.match(disabled.message, /disabled/);

    const scope = await writeSpreadsheet(
      scripted([{ status: 403, body: { error: { message: 'Request had insufficient authentication scopes.' } } }]).fetchImpl,
      { fileId: FILE, sheetName: 'Daily', fallbackSheetName: 'Revenue', mode: 'replace', columns: ['name'], rows: [] },
    );
    assert.deepEqual(scope, { status: 'scope' });
  });

  it('refuses a page with no columns', async () => {
    const written = await writeSpreadsheet(async () => {
      throw new Error('should not fetch');
    }, { fileId: FILE, sheetName: 'Daily', fallbackSheetName: 'Revenue', mode: 'replace', columns: [], rows: [] });
    assert.equal(written.status, 'error');
  });
});

describe('writeDocument', () => {
  it('appends a heading and fills the new table from the last cell backward', async () => {
    const created = {
      body: {
        content: [
          {
            endIndex: 20,
            table: {
              tableRows: [
                { tableCells: [{ content: [{ startIndex: 5 }] }, { content: [{ startIndex: 7 }] }] },
                { tableCells: [{ content: [{ startIndex: 9 }] }, { content: [{ startIndex: 11 }] }] },
              ],
            },
          },
        ],
      },
    };
    const { fetchImpl, calls } = scripted([
      { body: { body: { content: [{ endIndex: 2 }] } } },
      { body: {} },
      { body: created },
      { body: {} },
    ]);
    const written = await writeDocument(fetchImpl, {
      fileId: FILE,
      title: 'Revenue',
      columns: ['name', 'note'],
      rows: [['Ada', '']],
    });
    assert.deepEqual(written, { status: 'ok', value: { rows: 1 } });
    assert.deepEqual(calls[1]?.body, {
      requests: [
        { insertText: { location: { index: 1 }, text: 'Revenue\n' } },
        { insertTable: { rows: 2, columns: 2, endOfSegmentLocation: { segmentId: '' } } },
      ],
    });
    assert.deepEqual(calls[3]?.body, {
      requests: [
        { insertText: { location: { index: 9 }, text: 'Ada' } },
        { insertText: { location: { index: 7 }, text: 'note' } },
        { insertText: { location: { index: 5 }, text: 'name' } },
      ],
    });
  });

  it('stops when the new table does not match the page', async () => {
    const { fetchImpl } = scripted([
      { body: { body: { content: [{ endIndex: 2 }] } } },
      { body: {} },
      { body: { body: { content: [{ endIndex: 4 }] } } },
    ]);
    const written = await writeDocument(fetchImpl, {
      fileId: FILE,
      title: 'Revenue',
      columns: ['name'],
      rows: [['Ada']],
    });
    assert.equal(written.status, 'error');
    if (written.status === 'error') assert.match(written.message, /could not be filled/);
  });
});

describe('spreadsheetValueChunks', () => {
  it('keeps a small grid together and splits before the size limit', () => {
    assert.equal(spreadsheetValueChunks([['a'], ['b']], 100).ok, true);
    const split = spreadsheetValueChunks([['aa'], ['bbbb'], ['cc']], 12);
    assert.equal(split.ok, true);
    if (!split.ok) return;
    assert.deepEqual(split.chunks, [[['aa']], [['bbbb']], [['cc']]]);
    assert.equal(spreadsheetValueChunks([['x'.repeat(20)]], 10).ok, false);
  });
});

describe('cellWrites', () => {
  it('walks the last table from the highest index', () => {
    const starts = lastTableCellStarts({
      body: {
        content: [
          { table: { tableRows: [{ tableCells: [{ content: [{ startIndex: 2 }] }] }] } },
          { table: { tableRows: [{ tableCells: [{ content: [{ startIndex: 8 }] }] }] } },
        ],
      },
    });
    assert.deepEqual(starts, [8]);
    assert.deepEqual(cellWrites([8, 10], [['a', '']]), [{ insertText: { location: { index: 8 }, text: 'a' } }]);
    assert.deepEqual(cellWrites([], []), []);
  });
});
