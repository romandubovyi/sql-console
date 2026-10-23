import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createFolder,
  folderIdFor,
  MAX_FOLDERS,
  moveQuery,
  normalizeFolders,
  pruneFolders,
  removeFolder,
  renameFolder,
  revealQuery,
  toggleFolder,
} from './folders.ts';
import { normalizePreferences } from './queries.ts';

const revenue = { id: 'folder-revenue', title: 'Revenue', queryIds: ['query-a'], collapsed: false };

describe('normalizeFolders', () => {
  it('keeps a folder and drops a broken one, a duplicate, and a repeated query', () => {
    const folders = normalizeFolders([
      revenue,
      { id: 'folder-revenue', title: 'Again', queryIds: ['query-b'] },
      { id: 'bad id', title: 'Broken', queryIds: [] },
      { title: 'Missing id', queryIds: [] },
      { id: 'folder-ads', title: '  Ads  ', queryIds: ['query-a', 'query-c'], collapsed: true },
    ]);
    assert.deepEqual(folders, [
      revenue,
      { id: 'folder-ads', title: 'Ads', queryIds: ['query-c'], collapsed: true },
    ]);
  });

  it('is empty when preferences have no folders', () => {
    assert.deepEqual(normalizePreferences({ projectId: 'p', location: 'EU' }).folders, []);
    assert.equal(normalizePreferences({ projectId: 'p', location: 'EU', folders: [revenue] }).folders[0]?.title, 'Revenue');
  });
});

describe('folder edits', () => {
  it('creates, renames, collapses, and removes a folder without dropping its queries from the caller', () => {
    const created = createFolder([], '  Daily revenue  ', 'folder-1');
    assert.deepEqual(created, [{ id: 'folder-1', title: 'Daily revenue', queryIds: [], collapsed: false }]);
    assert.equal(createFolder(created ?? [], '   ', 'folder-2'), null);
    assert.equal(createFolder(Array.from({ length: MAX_FOLDERS }, (_, index) => ({
      id: `folder-${index}`,
      title: `Folder ${index}`,
      queryIds: [],
      collapsed: false,
    })), 'One more', 'folder-extra'), null);
    const renamed = renameFolder(created ?? [], 'folder-1', 'Finance');
    assert.equal(renamed?.[0]?.title, 'Finance');
    const collapsed = toggleFolder(renamed ?? [], 'folder-1');
    assert.equal(collapsed[0]?.collapsed, true);
    assert.deepEqual(removeFolder(collapsed, 'folder-1'), []);
  });

  it('moves a query between folders and back out, and opens the destination', () => {
    const folders = [
      revenue,
      { id: 'folder-ads', title: 'Ads', queryIds: [], collapsed: true },
    ];
    const moved = moveQuery(folders, 'query-a', 'folder-ads');
    assert.deepEqual(moved[0]?.queryIds, []);
    assert.deepEqual(moved[1], { id: 'folder-ads', title: 'Ads', queryIds: ['query-a'], collapsed: false });
    assert.equal(folderIdFor(moved, 'query-a'), 'folder-ads');
    const loose = moveQuery(moved, 'query-a', null);
    assert.deepEqual(loose[1]?.queryIds, []);
    assert.equal(folderIdFor(loose, 'query-a'), null);
    assert.equal(moveQuery(folders, 'query-a', 'missing'), folders);
    assert.equal(moveQuery(folders, 'query-a', 'folder-revenue'), folders);
    assert.equal(moveQuery(loose, 'query-a', null), loose);
  });

  it('opens a collapsed folder for the query that was selected', () => {
    const folders = [{ ...revenue, collapsed: true }];
    const opened = revealQuery(folders, 'query-a');
    assert.equal(opened[0]?.collapsed, false);
    assert.equal(revealQuery(opened, 'query-a'), opened);
  });

  it('drops deleted queries and keeps the same array when every id remains', () => {
    const folders = [revenue];
    assert.equal(pruneFolders(folders, new Set(['query-a'])), folders);
    const pruned = pruneFolders(folders, new Set());
    assert.deepEqual(pruned[0]?.queryIds, []);
  });
});
