import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendVersion,
  initialVersionPick,
  landingQuery,
  listAllQueries,
  MAX_VERSIONS,
  queryIsDirty,
  UNTITLED_QUERY,
  versionSides,
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

describe('versionSides', () => {
  it('starts with the newest save on the right and the previous save on the left', () => {
    assert.deepEqual(initialVersionPick(3), { focus: 0, anchor: 1 });
    assert.deepEqual(versionSides(0, 1, 3), { olderIndex: 1, newerIndex: 0 });
  });

  it('orders any two clicked saves from older to newer', () => {
    assert.deepEqual(versionSides(3, 0, 5), { olderIndex: 3, newerIndex: 0 });
  });

  it('compares a single save with empty', () => {
    assert.deepEqual(initialVersionPick(1), { focus: 0, anchor: null });
    assert.deepEqual(versionSides(0, null, 1), { olderIndex: null, newerIndex: 0 });
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
