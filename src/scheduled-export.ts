import type { PluginCollection } from '@owox/plugin-sdk';
import { fetchAllResultRows, runBigQueryJob } from './bigquery.ts';
import { writeSpreadsheet } from './google-export.ts';
import { normalizeQuery, storedQuery, type QueryDocument, type ScheduledExport } from './queries.ts';

const MESSAGE_LIMIT = 500;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ExportSheetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExportSheetError';
    this.code = code;
  }
}

export interface ExportSavedSheetInput {
  queryId: string;
  fetchImpl: FetchLike | null;
  collection: Pick<PluginCollection<QueryDocument>, 'get' | 'put'>;
  signal?: AbortSignal;
  now?: () => string;
}

/** Runs the saved SQL and replaces the saved spreadsheet. Safe to run twice. */
export async function exportSavedSheet(input: ExportSavedSheetInput): Promise<{ rows: number; sheetName: string }> {
  const now = input.now ?? (() => new Date().toISOString());
  const stored = await input.collection.get(input.queryId);
  if (!stored) throw new ExportSheetError('QUERY_NOT_FOUND', 'This query is no longer saved.');
  const query = normalizeQuery(stored.document);
  const target = query.exportTarget;
  const schedule = query.sheetSchedule;
  if (!query.sql.trim()) {
    return fail(input, now, 'QUERY_NOT_READY', 'Save a SQL query before scheduling it.');
  }
  if (!target || target.kind !== 'sheet' || !schedule?.projectId) {
    return fail(input, now, 'QUERY_NOT_READY', 'Save a schedule before this run.');
  }
  if (!input.fetchImpl) {
    return fail(input, now, 'CREDENTIAL_MISSING', 'Select the Credential again for SQL-Console.');
  }

  const fetchImpl = input.fetchImpl;
  const started = await runBigQueryJob({
    fetchImpl,
    projectId: schedule.projectId,
    location: schedule.location || null,
    sql: query.sql,
    signal: input.signal,
  });
  if (started.status !== 'ok' || !started.table.jobId) {
    const message = started.status === 'ok' ? 'BigQuery did not return a job.' : started.message;
    return fail(input, now, failureCode(message), failureMessage(message));
  }

  const loaded = await fetchAllResultRows({
    fetchImpl,
    projectId: schedule.projectId,
    jobId: started.table.jobId,
    location: started.table.location ?? (schedule.location || null),
    signal: input.signal,
  });
  if (loaded.status !== 'ok') return fail(input, now, failureCode(loaded.message), failureMessage(loaded.message));

  const written = await writeSpreadsheet(
    fetchImpl,
    {
      fileId: target.fileId,
      sheetName: target.sheetName,
      fallbackSheetName: query.title,
      mode: 'replace',
      columns: loaded.table.columns,
      rows: loaded.table.rows,
    },
    input.signal,
  );
  if (written.status === 'scope') {
    return fail(input, now, 'CREDENTIAL_SCOPE', 'Select the Credential again for SQL-Console.');
  }
  if (written.status === 'denied') {
    return fail(
      input,
      now,
      'SHEET_DENIED',
      'Open the spreadsheet, choose Share, and add the service account as Editor.',
    );
  }
  if (written.status !== 'ok') return fail(input, now, 'EXPORT_FAILED', written.message);

  const ranAt = now();
  try {
    await storeResult(input, {
      lastRun: {
        jobId: started.table.jobId,
        projectId: schedule.projectId,
        location: started.table.location ?? schedule.location,
        ranAt,
        sql: query.sql,
      },
      scheduledExport: {
        ranAt,
        status: 'ok',
        message: `Wrote ${written.value.rows} rows to “${written.value.sheetName}”.`.slice(0, MESSAGE_LIMIT),
        rows: written.value.rows,
      },
    });
  } catch (cause) {
    if (cause instanceof ExportSheetError) throw cause;
    throw new ExportSheetError('EXPORT_FAILED', 'The sheet was written, but the query could not store that result.');
  }
  return written.value;
}

async function fail(input: ExportSavedSheetInput, now: () => string, code: string, message: string): Promise<never> {
  try {
    await storeResult(input, {
      scheduledExport: { ranAt: now(), status: 'error', message: message.slice(0, MESSAGE_LIMIT), rows: null },
    });
  } catch {
    // The run still fails with the original reason when the status cannot be stored.
  }
  throw new ExportSheetError(code, message);
}

async function storeResult(
  input: ExportSavedSheetInput,
  patch: { lastRun?: QueryDocument['lastRun']; scheduledExport: ScheduledExport },
): Promise<void> {
  const latest = await input.collection.get(input.queryId);
  if (!latest) {
    throw new ExportSheetError('EXPORT_FAILED', 'The sheet was written, but the query could not store that result.');
  }
  const current = normalizeQuery(latest.document);
  await input.collection.put(
    input.queryId,
    storedQuery(
      {
        title: current.title,
        sql: current.sql,
        description: current.description,
        exportTarget: current.exportTarget,
        lastRun: patch.lastRun === undefined ? current.lastRun : patch.lastRun,
        sheetSchedule: current.sheetSchedule,
        scheduledExport: patch.scheduledExport,
        sqlOrigin: current.sqlOrigin,
      },
      current.versions,
    ),
  );
}

function failureCode(message: string): string {
  if (/scope/i.test(message) || /insufficient/i.test(message)) return 'CREDENTIAL_SCOPE';
  return 'EXPORT_FAILED';
}

function failureMessage(message: string): string {
  if (/scope/i.test(message) || /insufficient/i.test(message)) {
    return 'Select the Credential again for SQL-Console.';
  }
  return message;
}
