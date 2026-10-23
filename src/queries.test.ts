import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendVersion,
  compareWithPrevious,
  initialVersionPick,
  isBlankQuery,
  resumeQuery,
  limitDescription,
  listAllQueries,
  MAX_DESCRIPTION,
  MAX_VERSIONS,
  lastRunExpiredMessage,
  normalizeLastRun,
  normalizeLayout,
  normalizePreferences,
  normalizeQuery,
  normalizeScheduledExport,
  normalizeSheetSchedule,
  normalizeSqlOrigin,
  queryIsDirty,
  UNTITLED_QUERY,
} from './queries.ts';

describe('normalizeLayout', () => {
  it('keeps a chosen column width, stacked height, and editor height', () => {
    assert.deepEqual(normalizeLayout({ sidebar: 400.4, stack: 220.2, editor: 480.6 }), {
      sidebar: 400,
      stack: 220,
      editor: 481,
      assistant: 360,
    });
  });

  it('uses the defaults when a size is missing or not a number', () => {
    assert.deepEqual(normalizePreferences({ projectId: 'p', location: 'EU' }).layout, {
      sidebar: 260,
      stack: 260,
      editor: 320,
      assistant: 360,
    });
    assert.deepEqual(normalizeLayout({ sidebar: 'wide', editor: Number.NaN }), {
      sidebar: 260,
      stack: 260,
      editor: 320,
      assistant: 360,
    });
  });

  it('clamps a size that is outside the pane limits', () => {
    assert.deepEqual(normalizeLayout({ sidebar: 20, stack: 900, editor: 5000 }), {
      sidebar: 180,
      stack: 480,
      editor: 1200,
      assistant: 360,
    });
  });
});

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

describe('compareWithPrevious', () => {
  it('starts with the newest save compared to the one before it', () => {
    assert.deepEqual(initialVersionPick(3), { base: 1, head: 0 });
    assert.deepEqual(compareWithPrevious(0, 3), { base: 1, head: 0 });
  });

  it('compares a chosen save with the immediately previous save', () => {
    assert.deepEqual(compareWithPrevious(2, 5), { base: 3, head: 2 });
  });

  it('compares the oldest save with empty', () => {
    assert.deepEqual(initialVersionPick(1), { base: null, head: 0 });
    assert.deepEqual(compareWithPrevious(4, 5), { base: null, head: 4 });
  });
});

describe('resumeQuery', () => {
  const blank = {
    title: UNTITLED_QUERY,
    sql: '',
    description: '',
    versions: [],
    exportTarget: null,
    lastRun: null,
    sheetSchedule: null,
    scheduledExport: null,
    sqlOrigin: null,
  };

  it('opens the newest query that has something in it', () => {
    const chosen = resumeQuery([
      { ...blank, title: 'Revenue', sql: 'SELECT 1', updatedAt: '2026-10-01T00:00:00Z' },
      { ...blank, title: 'Draft', sql: 'SELECT 2', updatedAt: '2026-10-04T00:00:00Z' },
      { ...blank, updatedAt: '2026-10-05T00:00:00Z' },
    ]);
    assert.equal(chosen?.title, 'Draft');
  });

  it('leaves the editor empty when every query is a blank shell', () => {
    assert.equal(resumeQuery([{ ...blank, updatedAt: '2026-10-01T00:00:00Z' }]), null);
    assert.equal(isBlankQuery({ ...blank, sql: '  ' }), true);
    assert.equal(isBlankQuery({ ...blank, sql: 'SELECT 1' }), false);
    assert.equal(isBlankQuery({ ...blank, description: 'Note' }), false);
  });
});

describe('queryIsDirty', () => {
  const stored = {
    title: 'Revenue',
    sql: 'SELECT 1',
    description: '',
    versions: [{ sql: 'SELECT 1', savedAt: '2026-10-20T00:00:00Z' }],
    exportTarget: null,
  };
  const target = { kind: 'sheet' as const, fileId: 'abcdefghij1234', sheetName: 'Daily' };

  it('is clean when the editor matches the latest save', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', '', null), false);
  });

  it('is dirty when the text changed after the last save', () => {
    assert.equal(
      queryIsDirty({ ...stored, sql: 'SELECT 2', versions: stored.versions }, 'Revenue', 'SELECT 2', '', null),
      true,
    );
  });

  it('is dirty when only the description changed', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', 'Daily revenue', null), true);
  });

  it('is dirty when only the export target changed', () => {
    assert.equal(queryIsDirty(stored, 'Revenue', 'SELECT 1', '', target), true);
    assert.equal(queryIsDirty({ ...stored, exportTarget: target }, 'Revenue', 'SELECT 1', '', target), false);
  });
});

describe('description', () => {
  it('keeps a missing description empty and clamps the stored text', () => {
    assert.equal(normalizeQuery({ title: 'Revenue', sql: 'SELECT 1' }).description, '');
    assert.equal(limitDescription('a'.repeat(MAX_DESCRIPTION + 20)).length, MAX_DESCRIPTION);
    assert.equal(normalizeQuery({ description: 'b'.repeat(MAX_DESCRIPTION + 5) }).description.length, MAX_DESCRIPTION);
  });

  it('keeps a blank sheet name blank and drops a target without a file id', () => {
    assert.deepEqual(normalizeQuery({ exportTarget: { kind: 'sheet', fileId: 'abcdefghij1234', sheetName: '' } }).exportTarget, {
      kind: 'sheet',
      fileId: 'abcdefghij1234',
      sheetName: '',
    });
    assert.equal(normalizeQuery({ exportTarget: { kind: 'doc', fileId: 'short' } }).exportTarget, null);
    assert.equal(normalizeQuery({ title: 'Revenue' }).exportTarget, null);
    assert.equal(normalizeQuery({ title: 'Revenue' }).lastRun, null);
  });
});

describe('normalizeLastRun', () => {
  const run = {
    jobId: 'job_1',
    projectId: 'owox-marketing',
    location: 'EU',
    ranAt: '2026-10-23T12:00:00.000Z',
    sql: 'SELECT 1',
  };

  it('keeps a job reference and drops a broken one', () => {
    assert.deepEqual(normalizeLastRun(run), run);
    assert.deepEqual(normalizeLastRun({ ...run, location: '' }), { ...run, location: '' });
    assert.equal(normalizeLastRun({ ...run, jobId: 'job 1' }), null);
    assert.equal(normalizeLastRun({ ...run, ranAt: 'yesterday' }), null);
    assert.equal(normalizeQuery({ lastRun: run }).lastRun?.jobId, 'job_1');
  });

  it('names the time in the expired-result message', () => {
    assert.match(lastRunExpiredMessage(run.ranAt), /Last run .+BigQuery no longer has this result/);
  });
});

describe('normalizeSheetSchedule', () => {
  const schedule = {
    scheduleId: '11111111-1111-4111-8111-111111111111',
    projectId: 'owox-marketing',
    location: 'EU',
    cron: '0 9 * * *',
    timeZone: 'Europe/Kyiv',
  };

  it('keeps a captured project and a time zone that contains a slash', () => {
    assert.deepEqual(normalizeSheetSchedule(schedule), schedule);
    assert.deepEqual(normalizeSheetSchedule({ ...schedule, location: '' }), { ...schedule, location: '' });
    assert.equal(normalizeQuery({ sheetSchedule: schedule }).sheetSchedule?.timeZone, 'Europe/Kyiv');
  });

  it('drops a broken id, cron, or time zone', () => {
    assert.equal(normalizeSheetSchedule({ ...schedule, scheduleId: 'job 1' }), null);
    assert.equal(normalizeSheetSchedule({ ...schedule, projectId: 'owox/marketing' }), null);
    assert.equal(normalizeSheetSchedule({ ...schedule, cron: '0 9 * * *\n' }), null);
    assert.equal(normalizeSheetSchedule({ ...schedule, timeZone: 'Europe Kyiv' }), null);
    assert.equal(normalizeScheduledExport({ ranAt: 'yesterday', status: 'ok', message: 'Wrote 1 row.', rows: 1 }), null);
    const clipped = normalizeScheduledExport({
      ranAt: '2026-10-23T09:00:00.000Z',
      status: 'error',
      message: 'x'.repeat(600),
      rows: null,
    });
    assert.equal(clipped?.message.length, 500);
  });
});

describe('normalizeSqlOrigin', () => {
  const mart = {
    kind: 'data-mart' as const,
    dataMartId: '11111111-1111-4111-8111-111111111111',
    title: 'Revenue',
  };

  it('keeps a data mart or a report and drops a broken id', () => {
    assert.deepEqual(normalizeSqlOrigin(mart), mart);
    assert.deepEqual(
      normalizeSqlOrigin({
        kind: 'report',
        reportId: '22222222-2222-4222-8222-222222222222',
        dataMartId: mart.dataMartId,
        title: 'Weekly',
      }),
      {
        kind: 'report',
        reportId: '22222222-2222-4222-8222-222222222222',
        dataMartId: mart.dataMartId,
        title: 'Weekly',
      },
    );
    assert.equal(normalizeSqlOrigin({ ...mart, dataMartId: 'mart 1' }), null);
    assert.equal(normalizeQuery({ sqlOrigin: mart }).sqlOrigin?.kind, 'data-mart');
    assert.equal(normalizeQuery({ title: 'Revenue' }).sqlOrigin, null);
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
