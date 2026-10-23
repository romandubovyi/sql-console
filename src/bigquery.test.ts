import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dryRunBigQuery, EXPORT_ROW_LIMIT, fetchAllResultRows, fetchResultPage, formatBytes, formatCell, interpretQueryBody, queryResultIsGone, runBigQueryJob } from './bigquery.ts';

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

test('requests a later page by start index', async () => {
  let requested = '';
  const fetchImpl: typeof fetch = async input => {
    requested = String(input);
    return new Response(
      JSON.stringify({
        jobComplete: true,
        totalRows: '3',
        schema: { fields: [{ name: 'n' }] },
        rows: [{ f: [{ v: '3' }] }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const outcome = await fetchResultPage({
    fetchImpl,
    projectId: 'my-project',
    jobId: 'job 1',
    location: 'EU',
    startIndex: 50,
    pageSize: 25,
  });

  assert.equal(outcome.status, 'ok');
  const url = new URL(requested);
  assert.equal(url.searchParams.get('startIndex'), '50');
  assert.equal(url.searchParams.get('maxResults'), '25');
  assert.equal(url.searchParams.get('location'), 'EU');
  assert.match(url.pathname, /\/queries\/job%201$/);
});

test('reads every page of a job and stops when the result is past the export limit', async () => {
  const pages = [
    { totalRows: '3', schema: { fields: [{ name: 'n' }] }, rows: [{ f: [{ v: '1' }] }, { f: [{ v: '2' }] }] },
    { totalRows: '3', schema: { fields: [{ name: 'n' }] }, rows: [{ f: [{ v: '3' }] }] },
  ];
  let calls = 0;
  const outcome = await fetchAllResultRows({
    fetchImpl: async () => new Response(JSON.stringify({ jobComplete: true, ...pages[calls++] }), { status: 200 }),
    projectId: 'owox-marketing',
    jobId: 'job_1',
    location: 'US',
  });
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.table.rows, [['1'], ['2'], ['3']]);
  assert.equal(calls, 2);

  const tooBig = await fetchAllResultRows({
    fetchImpl: async () =>
      new Response(JSON.stringify({ jobComplete: true, totalRows: String(EXPORT_ROW_LIMIT + 1), schema: { fields: [{ name: 'n' }] }, rows: [] }), {
        status: 200,
      }),
    projectId: 'owox-marketing',
    jobId: 'job_1',
    location: null,
  });
  assert.equal(tooBig.status, 'error');
  if (tooBig.status === 'error') assert.match(tooBig.message, /100,000 rows/);
});

test('treats a missing query job as expired', async () => {
  assert.equal(queryResultIsGone(404, 'Not found: Job owox:US.job_1'), true);
  assert.equal(queryResultIsGone(400, 'Syntax error'), false);
  const outcome = await fetchResultPage({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'Not found: Job owox:US.job_1' } }), { status: 404 }),
    projectId: 'owox-marketing',
    jobId: 'job_1',
    location: 'US',
    startIndex: 0,
    pageSize: 100,
  });
  assert.deepEqual(outcome, { status: 'expired' });
});

test('waits for a scheduled job without cancelling it', async () => {
  const calls: string[] = [];
  const bodies = [
    { jobComplete: false, jobReference: { jobId: 'job_1', location: 'EU' } },
    { jobComplete: true, jobReference: { jobId: 'job_1', location: 'EU' }, schema: { fields: [{ name: 'n' }] }, totalRows: '1' },
  ];
  const outcome = await runBigQueryJob({
    fetchImpl: async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
      const body = bodies[calls.length - 1];
      if (!body) throw new Error('unexpected poll');
      return new Response(JSON.stringify(body), { status: 200 });
    },
    projectId: 'owox-marketing',
    location: 'EU',
    sql: 'SELECT 1',
  });
  assert.equal(outcome.status, 'ok');
  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? '', /POST .*\/queries\?location=EU$/);
  assert.match(calls[0] ?? '', /bigquery\/v2\/projects\/owox-marketing\/queries/);
  assert.match(calls[1] ?? '', /maxResults=0/);
  assert.equal(calls.some(call => call.includes('/cancel')), false);
});

test('stops a scheduled job when the deadline has already passed', async () => {
  const signal = AbortSignal.abort();
  const outcome = await runBigQueryJob({
    fetchImpl: async () => {
      throw new Error('should not query');
    },
    projectId: 'owox-marketing',
    location: null,
    sql: 'SELECT 1',
    signal,
  });
  assert.deepEqual(outcome, { status: 'error', message: 'The scheduled export ran out of time.' });
});

test('dry run asks BigQuery not to execute the query', async () => {
  let sent = '';
  let requested = '';
  const outcome = await dryRunBigQuery({
    fetchImpl: async (input, init) => {
      requested = String(input);
      sent = String(init?.body);
      return new Response(
        JSON.stringify({ jobComplete: true, totalBytesProcessed: '4096', schema: { fields: [{ name: 'n' }] } }),
        { status: 200 },
      );
    },
    projectId: 'owox-marketing',
    location: 'EU',
    sql: 'SELECT 1',
  });
  const body = JSON.parse(sent) as { dryRun?: boolean; query?: string; maxResults?: number };
  assert.equal(body.dryRun, true);
  assert.equal(body.query, 'SELECT 1');
  assert.equal(body.maxResults, undefined);
  assert.match(requested, /\/queries\?location=EU$/);
  assert.deepEqual(outcome, { valid: true, bytesProcessed: '4096', message: null });
});

test('dry run reads bytes nested under job statistics', async () => {
  const outcome = await dryRunBigQuery({
    fetchImpl: async () =>
      new Response(JSON.stringify({ statistics: { query: { totalBytesProcessed: '10' } } }), { status: 200 }),
    projectId: 'owox-marketing',
    location: null,
    sql: 'SELECT 1',
  });
  assert.equal(outcome.valid, true);
  assert.equal(outcome.bytesProcessed, '10');
});

test('dry run reports a BigQuery error and refuses a write locally', async () => {
  const failed = await dryRunBigQuery({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: 'Syntax error: Unexpected keyword' } }), { status: 400 }),
    projectId: 'owox-marketing',
    location: null,
    sql: 'SELECT',
  });
  assert.deepEqual(failed, { valid: false, bytesProcessed: null, message: 'Syntax error: Unexpected keyword' });

  let called = false;
  const write = await dryRunBigQuery({
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
    projectId: 'owox-marketing',
    location: null,
    sql: 'DELETE FROM events WHERE true',
  });
  assert.equal(called, false);
  assert.equal(write.valid, false);
  assert.match(write.message ?? '', /SELECT or WITH/);
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
