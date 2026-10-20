import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, formatCell, interpretQueryBody } from './bigquery.ts';

test('formats scalar, empty, and nested cells', () => {
  assert.equal(formatCell(null), '');
  assert.equal(formatCell('42'), '42');
  assert.equal(formatCell({ f: [{ v: 'a' }] }), '{"f":[{"v":"a"}]}');
});

test('reads a finished query response', () => {
  const outcome = interpretQueryBody({
    jobComplete: true,
    totalRows: '1',
    totalBytesProcessed: '2048',
    jobReference: { jobId: 'job-1' },
    schema: { fields: [{ name: 'example' }, {}] },
    rows: [{ f: [{ v: '1' }, { v: null }] }],
  });
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.table.columns, ['example', 'column_2']);
  assert.deepEqual(outcome.table.rows, [['1', '']]);
  assert.equal(outcome.table.totalRows, 1);
  assert.equal(formatBytes(outcome.table.bytesProcessed), '2.0 KB');
});

test('reports a BigQuery error and a still-running job', () => {
  assert.deepEqual(interpretQueryBody({ error: { message: 'Syntax error' } }), {
    status: 'error',
    message: 'Syntax error',
  });
  assert.deepEqual(
    interpretQueryBody({
      jobComplete: false,
      jobReference: { jobId: 'job-2', location: 'EU' },
    }),
    { status: 'pending', jobId: 'job-2', location: 'EU' },
  );
});
