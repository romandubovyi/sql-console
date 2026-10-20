import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canGoNext, formatRowRange, pageCount } from './paging.ts';

test('counts pages from the BigQuery total', () => {
  assert.equal(pageCount(0, 100), 1);
  assert.equal(pageCount(100, 100), 1);
  assert.equal(pageCount(101, 100), 2);
  assert.equal(pageCount(null, 100), null);
});

test('allows the next page when more rows exist', () => {
  assert.equal(canGoNext(0, 100, 250, 100), true);
  assert.equal(canGoNext(2, 100, 250, 50), false);
  assert.equal(canGoNext(0, 100, null, 100), true);
  assert.equal(canGoNext(0, 100, null, 40), false);
});

test('formats the visible row range', () => {
  assert.equal(formatRowRange(1, 25, 25, 80), '26–50 of 80');
  assert.equal(formatRowRange(0, 100, 0, 0), '0 rows');
});
