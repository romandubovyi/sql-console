import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendVersion,
  compareWithPrevious,
  initialVersionPick,
  landingQuery,
  limitDescription,
  listAllQueries,
  MAX_DESCRIPTION,
  MAX_VERSIONS,
  lastRunExpiredMessage,
  normalizeLastRun,
  normalizeQuery,
  queryIsDirty,
  UNTITLED_QUERY,
} from './queries.ts';

describe('appendVersion', () => {
  it('keeps the newest save first and drops saves past the limit', () => {
    let versions: { sql: string; savedAt: string }[] = [];
    for (let index = 0; index < MAX_VERSIONS + 2; index += 1) {
      versions = appendVersion(versions, `SELECT ${index}`, `2026-10-20T00:00:${String(index).padStart(2, '0')}Z`);
    }
    assert.equal(versions.length, MAX_VERSIONS);
    assert.equal(versions[0]?.sql, `SELECT ${MAX_VERSIONS + 1}`);
    assert.equal(versions.at(-1)?.sql, 'SELECT 2');
  });

  it('does not record the same SQL twice or an initial empty editor', () => {
    const saved = appendVersion([], 'SELECT 1', '2026-10-20T00:00:00Z');
    assert.equal(appendVersion(saved, 'SELECT 1', '2026-10-20T00:01:00Z'), saved);
    assert.deepEqual(appendVersion([], '   ', '2026-10-20T00:00:00Z'), []);
  });
});

describe('compareWithPrevious', () => {
  it('starts with the newest save compared to the one before it', () => {
    assert.deepEqual(initialVersionPick(3), { base: 1, head: 0 });
    assert.deepEqual(compareWithPrevious(0, 3), { base: 1, head: 0 });
  });

  it('compares a chosen save with the immediately previous save', () => {
    assert.deepEqual(compareWithPrevious(2, 5), { base: 3, head: 2 });
  });

  it('compares the oldest save with empty', () => {
    assert.deepEqual(initialVersionPick(1), { base: null, head: 0 });
    assert.deepEqual(compareWithPrevious(4, 5), { base: null, head: 4 });
  });
});

describe('landingQuery', () => {
  it('opens the oldest empty Untitled query', () => {
    const chosen = landingQuery([
      { id: 'named', title: 'Revenue', sql: '', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'filled', title: UNTITLED_QUERY, sql: 'SELECT 1', createdAt: '2026-10-02T00:00:00Z' },
      { id: 'newer', title: UNTITLED_QUERY, sql: '', createdAt: '2026-10-04T00:00:00Z' },
      { id: 'older', title: UNTITLED_QUERY, sql: '  ', createdAt: '2026-10-03T00:00:00Z' },
    ]);
    assert.equal(chosen?.id, 'older');
  });

  it('reports when a new Untitled query has to be created', () => {
    assert.equal(landingQuery([{ id: 'named', title: 'Revenue', sql: 'SELECT 1', createdAt: '2026-10-01' }]), null);
  });
});

describe('queryIsDirty', () => {
  const stored = {
    title: 'Revenue',
    sql: 'SELECT 1',
    description: '',
    versions: [{ sql: 'SELECT 1', savedAt: '2026-10-20T00:00:00Z' }],
    exportTarget: null,
  };
  const target = { kind: 'sheet' as const, fileId: 'abcdefghij1234', sheetName: 'Daily' };

  it('is clean when the editor matches the latest save', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', '', null), false);
  });

  it('is dirty when the text changed after the last save', () => {
    assert.equal(
      queryIsDirty({ ...stored, sql: 'SELECT 2', versions: stored.versions }, 'Revenue', 'SELECT 2', '', null),
      true,
    );
  });

  it('is dirty when only the description changed', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', 'Daily revenue', null), true);
  });

  it('is dirty when only the export target changed', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', '', target), true);
    assert.equal(queryIsDirty({ ...stored, exportTarget: target }, 'Revenue', 'SELECT 1', '', target), false);
  });
});

describe('description', () => {
  it('keeps a missing description empty and clamps the stored text', () => {
    assert.equal(normalizeQuery({ title: 'Revenue', sql: 'SELECT 1' }).description, '');
    assert.equal(limitDescription('a'.repeat(MAX_DESCRIPTION + 20)).length, MAX_DESCRIPTION);
    assert.equal(normalizeQuery({ description: 'b'.repeat(MAX_DESCRIPTION + 5) }).description.length, MAX_DESCRIPTION);
  });

  it('keeps a blank sheet name blank and drops a target without a file id', () => {
    assert.deepEqual(normalizeQuery({ exportTarget: { kind: 'sheet', fileId: 'abcdefghij1234', sheetName: '' } }).exportTarget, {
      kind: 'sheet',
      fileId: 'abcdefghij1234',
      sheetName: '',
    });
    assert.equal(normalizeQuery({ exportTarget: { kind: 'doc', fileId: 'short' } }).exportTarget, null);
    assert.equal(normalizeQuery({ title: 'Revenue' }).exportTarget, null);
    assert.equal(normalizeQuery({ title: 'Revenue' }).lastRun, null);
  });
});

describe('normalizeLastRun', () => {
  const run = {
    jobId: 'job_1',
    projectId: 'owox-marketing',
    location: 'EU',
    ranAt: '2026-10-23T12:00:00.000Z',
    sql: 'SELECT 1',
  };

  it('keeps a job reference and drops a broken one', () => {
    assert.deepEqual(normalizeLastRun(run), run);
    assert.deepEqual(normalizeLastRun({ ...run, location: '' }), { ...run, location: '' });
    assert.equal(normalizeLastRun({ ...run, jobId: 'job 1' }), null);
    assert.equal(normalizeLastRun({ ...run, ranAt: 'yesterday' }), null);
    assert.equal(normalizeQuery({ lastRun: run }).lastRun?.jobId, 'job_1');
  });

  it('names the time in the expired-result message', () => {
    assert.match(lastRunExpiredMessage(run.ranAt), /Last run .+BigQuery no longer has this result/);
  });
});

describe('listAllQueries', () => {
  it('follows the cursor until the host has no further page', async () => {
    const pages = [
      { items: [{ id: 'a' }], nextCursor: 'next' },
      { items: [{ id: 'b' }], nextCursor: null },
    ];
    const seen: unknown[] = [];
    const items = await listAllQueries({
      list: async options => {
        seen.push(options);
        const page = pages.shift();
        if (!page) throw new Error('unexpected page');
        return page as never;
      },
    });
    assert.deepEqual(seen, [{ limit: 100 }, { limit: 100, cursor: 'next' }]);
    assert.deepEqual(items.map(item => item.id), ['a', 'b']);
  });
});
