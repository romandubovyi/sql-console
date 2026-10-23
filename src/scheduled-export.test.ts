import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PluginCollectionDocument } from '@owox/plugin-sdk';
import { exportSavedSheet, ExportSheetError } from './scheduled-export.ts';
import type { QueryDocument } from './queries.ts';

const FILE = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const QUERY_ID = 'query-1';

function query(patch: Partial<QueryDocument> = {}): QueryDocument {
  return {
    title: 'Revenue',
    sql: 'SELECT 1',
    description: '',
    versions: [{ sql: 'SELECT 1', savedAt: '2026-10-20T00:00:00.000Z' }],
    exportTarget: { kind: 'sheet', fileId: FILE, sheetName: 'Daily' },
    lastRun: null,
    sheetSchedule: {
      scheduleId: '11111111-1111-4111-8111-111111111111',
      projectId: 'owox-marketing',
      location: 'EU',
      cron: '0 9 * * *',
      timeZone: 'Europe/Kyiv',
    },
    scheduledExport: null,
    ...patch,
  };
}

function collection(initial: QueryDocument | null, options?: { put?: () => void }) {
  let document = initial;
  const puts: QueryDocument[] = [];
  return {
    puts,
    async get(): Promise<PluginCollectionDocument<QueryDocument> | null> {
      if (!document) return null;
      return {
        id: QUERY_ID,
        document,
        createdAt: '2026-10-23T00:00:00.000Z',
        updatedAt: '2026-10-23T00:00:00.000Z',
      };
    },
    async put(_id: string, next: QueryDocument) {
      options?.put?.();
      document = next;
      puts.push(next);
      return {
        id: QUERY_ID,
        document: next,
        createdAt: '2026-10-23T00:00:00.000Z',
        updatedAt: '2026-10-23T09:00:00.000Z',
      };
    },
  };
}

function scripted(responses: { status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url: String(input), method: init?.method ?? 'GET', body });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`unexpected ${init?.method ?? 'GET'} ${String(input)}`);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { fetchImpl, calls };
}

const finishedJob = {
  jobComplete: true,
  jobReference: { jobId: 'job_1', location: 'EU' },
  schema: { fields: [{ name: 'n' }] },
  rows: [{ f: [{ v: '1' }] }],
  totalRows: '1',
};

const sheetList = { sheets: [{ properties: { title: 'Daily' } }] };

describe('exportSavedSheet', () => {
  it('runs the saved SQL and replaces the saved sheet', async () => {
    const { fetchImpl, calls } = scripted([
      { body: finishedJob },
      { body: finishedJob },
      { body: sheetList },
      { body: {} },
      { body: {} },
    ]);
    const stored = collection(query());
    const result = await exportSavedSheet({
      queryId: QUERY_ID,
      fetchImpl,
      collection: stored,
      now: () => '2026-10-23T09:00:00.000Z',
    });
    assert.deepEqual(result, { rows: 1, sheetName: 'Daily' });
    assert.equal(calls[0]?.method, 'POST');
    assert.match(calls[0]?.url ?? '', /\/projects\/owox-marketing\/queries\?location=EU$/);
    assert.deepEqual(calls[0]?.body, { query: 'SELECT 1', useLegacySql: false, maxResults: 0, timeoutMs: 20000 });
    assert.match(calls[3]?.url ?? '', /'Daily'!A%3AZZ:clear$/);
    assert.equal(stored.puts.length, 1);
    assert.equal(stored.puts[0]?.scheduledExport?.status, 'ok');
    assert.equal(stored.puts[0]?.scheduledExport?.rows, 1);
    assert.equal(stored.puts[0]?.lastRun?.jobId, 'job_1');
    assert.equal(stored.puts[0]?.lastRun?.sql, 'SELECT 1');
    assert.equal(stored.puts[0]?.sheetSchedule?.timeZone, 'Europe/Kyiv');
  });

  it('records a share failure and does not invent a job', async () => {
    const { fetchImpl, calls } = scripted([
      { body: finishedJob },
      { body: finishedJob },
      { status: 403, body: { error: { message: 'The caller does not have permission' } } },
    ]);
    const stored = collection(query());
    await assert.rejects(
      () => exportSavedSheet({ queryId: QUERY_ID, fetchImpl, collection: stored, now: () => '2026-10-23T09:00:00.000Z' }),
      (error: unknown) => error instanceof ExportSheetError && error.code === 'SHEET_DENIED',
    );
    assert.equal(calls.length, 3);
    assert.equal(stored.puts[0]?.scheduledExport?.status, 'error');
    assert.match(stored.puts[0]?.scheduledExport?.message ?? '', /Share/);
    assert.equal(stored.puts[0]?.lastRun, null);
  });

  it('refuses a query that has no saved schedule', async () => {
    const { fetchImpl, calls } = scripted([]);
    const stored = collection(query({ sheetSchedule: null }));
    await assert.rejects(
      () => exportSavedSheet({ queryId: QUERY_ID, fetchImpl, collection: stored, now: () => '2026-10-23T09:00:00.000Z' }),
      (error: unknown) => error instanceof ExportSheetError && error.code === 'QUERY_NOT_READY',
    );
    assert.equal(calls.length, 0);
    assert.match(stored.puts[0]?.scheduledExport?.message ?? '', /Save a schedule/);
  });

  it('says when the sheet was written but the query could not store it', async () => {
    const { fetchImpl } = scripted([
      { body: finishedJob },
      { body: finishedJob },
      { body: sheetList },
      { body: {} },
      { body: {} },
    ]);
    const stored = collection(query(), {
      put: () => {
        throw new Error('collection down');
      },
    });
    await assert.rejects(
      () => exportSavedSheet({ queryId: QUERY_ID, fetchImpl, collection: stored, now: () => '2026-10-23T09:00:00.000Z' }),
      (error: unknown) =>
        error instanceof ExportSheetError &&
        error.code === 'EXPORT_FAILED' &&
        /sheet was written/.test(error.message),
    );
  });
});
