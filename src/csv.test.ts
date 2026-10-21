import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvFilename, csvField, toCsv } from './csv.ts';

test('quotes a field that contains a comma, quote, or line break', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a, b'), '"a, b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('a\nb'), '"a\nb"');
});

test('writes a header and pads a short row', () => {
  assert.equal(toCsv(['name', 'note'], [['Ada', 'hello, world'], ['Grace']]), 'name,note\r\nAda,"hello, world"\r\nGrace,\r\n');
});

test('builds a csv filename from the query title', () => {
  assert.equal(csvFilename(' Revenue by day '), 'Revenue-by-day.csv');
  assert.equal(csvFilename('Виручка'), 'Виручка.csv');
  assert.equal(csvFilename('***'), 'query.csv');
  assert.equal(csvFilename(''), 'query.csv');
});
