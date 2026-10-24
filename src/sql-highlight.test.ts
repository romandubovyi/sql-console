import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SQL_TOKEN_CLASSES, tokenizeSql, type SqlTokenKind } from './sql-highlight.ts';

function kinds(sql: string): SqlTokenKind[] {
  return tokenizeSql(sql).map((token) => token.kind);
}

describe('tokenizeSql', () => {
  test('marks keywords case-insensitively', () => {
    assert.deepEqual(kinds('SELECT user_id FROM t WHERE x'), [
      'keyword',
      'space',
      'word',
      'space',
      'keyword',
      'space',
      'word',
      'space',
      'keyword',
      'space',
      'word',
    ]);
  });

  test('keeps plain words as words', () => {
    assert.deepEqual(kinds('my_table column_2'), ['word', 'space', 'word']);
  });

  test('tokenizes string literals with escaped quotes as one token', () => {
    const tokens = tokenizeSql("'it''s' = 'plain'");
    assert.deepEqual(tokens.map((t) => t.kind), ['string', 'space', 'other', 'space', 'string']);
    assert.equal(tokens[0].text, "'it''s'");
  });

  test('tokenizes line comments', () => {
    const tokens = tokenizeSql('-- note\nselect');
    assert.deepEqual(tokens.map((t) => [t.kind, t.text]), [
      ['comment', '-- note'],
      ['space', '\n'],
      ['keyword', 'select'],
    ]);
  });

  test('tokenizes block comments spanning lines', () => {
    const tokens = tokenizeSql('/* multi\nline */ 1');
    assert.deepEqual(tokens.map((t) => [t.kind, t.text]), [
      ['comment', '/* multi\nline */'],
      ['space', ' '],
      ['number', '1'],
    ]);
  });

  test('tokenizes quoted identifiers in backticks and double quotes', () => {
    const tokens = tokenizeSql('`my-project.ds.t` "alias"');
    assert.deepEqual(tokens.map((t) => t.kind), ['quoted', 'space', 'quoted']);
  });

  test('tokenizes numbers in common shapes', () => {
    assert.deepEqual(kinds('42 3.14 .5 1e-3'), [
      'number',
      'space',
      'number',
      'space',
      'number',
      'space',
      'number',
    ]);
  });

  test('treats punctuation as other and merges runs', () => {
    assert.deepEqual(kinds('a>=b'), ['word', 'other', 'word']);
    assert.equal(tokenizeSql('a>=b')[1].text, '>=');
  });

  test('handles a mixed query end to end', () => {
    const sql = "SELECT d, COUNT(*) AS n -- count\nFROM `ds.t` WHERE name = 'x'";
    assert.deepEqual(kinds(sql), [
      'keyword',
      'space',
      'word',
      'other',
      'space',
      'keyword',
      'other',
      'space',
      'keyword',
      'space',
      'word',
      'space',
      'comment',
      'space',
      'keyword',
      'space',
      'quoted',
      'space',
      'keyword',
      'space',
      'word',
      'space',
      'other',
      'space',
      'string',
    ]);
  });
});

describe('SQL_TOKEN_CLASSES', () => {
  test('covers only the highlighted kinds', () => {
    assert.deepEqual(SQL_TOKEN_CLASSES, {
      keyword: 'tok-k',
      string: 'tok-s',
      quoted: 'tok-q',
      comment: 'tok-c',
    });
  });
});
