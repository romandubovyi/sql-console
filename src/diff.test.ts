import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffLines } from './diff.ts';

describe('diffLines', () => {
  it('marks an inserted and a removed line', () => {
    const diff = diffLines('SELECT 1\nFROM events', 'SELECT 2\nFROM events\nLIMIT 10');
    assert.deepEqual(
      diff.map(line => `${line.kind}:${line.text}`),
      ['remove:SELECT 1', 'add:SELECT 2', 'same:FROM events', 'add:LIMIT 10'],
    );
  });

  it('keeps identical SQL as unchanged lines', () => {
    assert.deepEqual(diffLines('SELECT 1', 'SELECT 1'), [{ kind: 'same', text: 'SELECT 1' }]);
  });

  it('treats an empty side as no lines', () => {
    assert.deepEqual(diffLines('', 'SELECT 1'), [{ kind: 'add', text: 'SELECT 1' }]);
    assert.deepEqual(diffLines('', ''), []);
  });
});
