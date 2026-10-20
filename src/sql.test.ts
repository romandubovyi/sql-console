import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReadOnlyQuery } from './sql.ts';

function sqlOf(input: string): string {
  const prepared = prepareReadOnlyQuery(input);
  if ('error' in prepared) assert.fail(prepared.error);
  return prepared.sql;
}

function errorOf(input: string): string {
  const prepared = prepareReadOnlyQuery(input);
  if (!('error' in prepared)) assert.fail(`expected an error for: ${input}`);
  return prepared.error;
}

test('keeps a select query as written', () => {
  assert.equal(sqlOf('SELECT 1 AS example'), 'SELECT 1 AS example');
});

test('accepts a with query and a trailing semicolon', () => {
  const sql = sqlOf('WITH rows AS (SELECT 1 AS n) SELECT * FROM rows;');
  assert.match(sql, /WITH rows AS \(SELECT 1 AS n\) SELECT \* FROM rows/);
  assert.doesNotMatch(sql, /rows;/);
});

test('keeps a semicolon that only appears inside a string or comment', () => {
  assert.match(sqlOf("SELECT '; drop table t' AS text"), /drop table t/);
  assert.doesNotMatch(sqlOf('SELECT 1; -- trailing note'), /1;/);
  assert.match(sqlOf('/* note; */\nSELECT 1'), /SELECT 1/);
});

test('rejects empty, multi-statement, and write queries', () => {
  assert.equal(errorOf('  '), 'Enter a SQL query.');
  assert.equal(errorOf('SELECT 1; SELECT 2'), 'Only one SQL statement is allowed.');
  assert.equal(errorOf('DROP TABLE t'), 'Only a single SELECT or WITH query is allowed.');
  assert.equal(
    errorOf('WITH rows AS (SELECT 1 AS n) DELETE FROM t WHERE true'),
    'Only a read-only SELECT query is allowed.',
  );
  assert.equal(errorOf("EXECUTE IMMEDIATE 'DROP TABLE t'"), 'Only a single SELECT or WITH query is allowed.');
});

test('allows a cte whose name matches a write verb', () => {
  const sql = sqlOf('WITH insert AS (SELECT 1 AS n) SELECT * FROM insert');
  assert.match(sql, /FROM insert/);
});
