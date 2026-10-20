import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendVersion,
  landingQuery,
  listAllQueries,
  MAX_VERSIONS,
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
    assert.equal(versions[0]?.sql, 'SELECT 11');
    assert.equal(versions.at(-1)?.sql, 'SELECT 2');
  });

  it('does not record the same SQL twice or an initial empty editor', () => {
    const saved = appendVersion([], 'SELECT 1', '2026-10-20T00:00:00Z');
    assert.equal(appendVersion(saved, 'SELECT 1', '2026-10-20T00:01:00Z'), saved);
    assert.deepEqual(appendVersion([], '   ', '2026-10-20T00:00:00Z'), []);
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
  const stored = { title: 'Revenue', sql: 'SELECT 1', versions: [{ sql: 'SELECT 1', savedAt: '2026-10-20T00:00:00Z' }] };

  it('is clean when the editor matches the latest save', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1'), false);
  });

  it('is dirty when the text changed after the last save', () => {
    assert.equal(queryIsDirty({ ...stored, sql: 'SELECT 2', versions: stored.versions }, 'Revenue', 'SELECT 2'), true);
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
