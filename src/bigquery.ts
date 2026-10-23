import { DEFAULT_PAGE_SIZE } from './paging.ts';
import { prepareReadOnlyQuery } from './sql.ts';

const QUERY_WAIT_MS = 20_000;
const POLL_WAIT_MS = 8_000;
const MAX_POLLS = 2;

export interface PreviewTable {
  columns: string[];
  rows: string[][];
  totalRows: number | null;
  bytesProcessed: string | null;
  jobId: string | null;
  location: string | null;
  pageToken: string | null;
}

export type QueryOutcome =
  | { status: 'ok'; table: PreviewTable }
  | { status: 'error'; message: string }
  | { status: 'incomplete'; message: string };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface RunPreviewInput {
  fetchImpl: FetchLike;
  projectId: string;
  location: string | null;
  sql: string;
  pageSize?: number;
  signal?: AbortSignal;
}

interface FetchPageInput {
  fetchImpl: FetchLike;
  projectId: string;
  jobId: string;
  location: string | null;
  startIndex: number;
  pageSize: number;
  signal?: AbortSignal;
}

export function interpretQueryBody(body: unknown): QueryOutcome | { status: 'pending'; jobId: string; location: string | null } {
  const record = asRecord(body);
  const message = errorText(record);
  const jobComplete = record?.jobComplete;
  const job = asRecord(record?.jobReference);
  const jobId = typeof job?.jobId === 'string' ? job.jobId : null;
  const location = typeof job?.location === 'string' ? job.location : null;

  if (jobComplete === false && !message && jobId) {
    return { status: 'pending', jobId, location };
  }
  if (message) return { status: 'error', message };
  if (jobComplete === false) {
    return {
      status: 'incomplete',
      message: jobId
        ? `Query did not finish in time. BigQuery job ${jobId} may still be running.`
        : 'Query did not finish in time.',
    };
  }
  return { status: 'ok', table: toPreviewTable(record) };
}

export function toPreviewTable(body: Record<string, unknown> | null): PreviewTable {
  const schema = asRecord(body?.schema);
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const columns = fields.map((field, index) => {
    const name = asRecord(field)?.name;
    return typeof name === 'string' && name ? name : `column_${index + 1}`;
  });
  const rawRows = Array.isArray(body?.rows) ? body.rows : [];
  const rows = rawRows.map(row => {
    const cells = asRecord(row)?.f;
    const values = Array.isArray(cells) ? cells : [];
    return columns.map((_, index) => formatCell(asRecord(values[index])?.v));
  });
  return {
    columns,
    rows,
    totalRows: parseCount(body?.totalRows),
    bytesProcessed: typeof body?.totalBytesProcessed === 'string' ? body.totalBytesProcessed : null,
    jobId: jobIdOf(body),
    location: locationOf(body),
    pageToken: typeof body?.pageToken === 'string' ? body.pageToken : null,
  };
}

function jobIdOf(body: Record<string, unknown> | null): string | null {
  const jobId = asRecord(body?.jobReference)?.jobId;
  return typeof jobId === 'string' ? jobId : null;
}

function locationOf(body: Record<string, unknown> | null): string | null {
  const location = asRecord(body?.jobReference)?.location;
  return typeof location === 'string' ? location : null;
}

export function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function formatBytes(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function runBigQueryPreview(input: RunPreviewInput): Promise<QueryOutcome> {
  const prepared = prepareReadOnlyQuery(input.sql);
  if ('error' in prepared) return { status: 'error', message: prepared.error };

  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const projectId = encodeURIComponent(input.projectId);
  const queryUrl = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
  );
  if (input.location) queryUrl.searchParams.set('location', input.location);

  const response = await input.fetchImpl(queryUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: prepared.sql,
      useLegacySql: false,
      maxResults: pageSize,
      timeoutMs: QUERY_WAIT_MS,
    }),
    signal: input.signal,
  });
  let body = await readBody(response);
  if (!response.ok) return { status: 'error', message: errorText(asRecord(body)) ?? `BigQuery answered ${response.status}` };

  for (let poll = 0; poll <= MAX_POLLS; poll += 1) {
    const outcome = interpretQueryBody(body);
    if (outcome.status !== 'pending') return outcome;
    if (poll === MAX_POLLS) {
      await cancelJob(input, outcome.jobId, outcome.location);
      return {
        status: 'incomplete',
        message: `Query did not finish in time. BigQuery job ${outcome.jobId} may still be running.`,
      };
    }

    const resultsUrl = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${encodeURIComponent(outcome.jobId)}`,
    );
    resultsUrl.searchParams.set('maxResults', String(pageSize));
    resultsUrl.searchParams.set('timeoutMs', String(POLL_WAIT_MS));
    const location = outcome.location ?? input.location;
    if (location) resultsUrl.searchParams.set('location', location);

    const next = await input.fetchImpl(resultsUrl, {
      headers: { Accept: 'application/json' },
      signal: input.signal,
    });
    body = await readBody(next);
    if (!next.ok) {
      return { status: 'error', message: errorText(asRecord(body)) ?? `BigQuery answered ${next.status}` };
    }
  }

  return { status: 'incomplete', message: 'Query did not finish in time.' };
}

export type PageOutcome = QueryOutcome | { status: 'expired' };

/** A missing or expired query job. Anonymous results usually last about 24 hours. */
export function queryResultIsGone(status: number, message: string): boolean {
  if (status === 404) return true;
  return /not found: job|\bjob\b[^.]{0,80}\bexpired\b|\bhas expired\b/i.test(message);
}

export async function fetchResultPage(input: FetchPageInput): Promise<PageOutcome> {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(input.projectId)}/queries/${encodeURIComponent(input.jobId)}`,
  );
  url.searchParams.set('startIndex', String(input.startIndex));
  url.searchParams.set('maxResults', String(input.pageSize));
  url.searchParams.set('timeoutMs', String(POLL_WAIT_MS));
  if (input.location) url.searchParams.set('location', input.location);

  const response = await input.fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: input.signal,
  });
  const body = await readBody(response);
  if (!response.ok) {
    const message = errorText(asRecord(body)) ?? `BigQuery answered ${response.status}`;
    if (queryResultIsGone(response.status, message)) return { status: 'expired' };
    return { status: 'error', message };
  }
  const outcome = interpretQueryBody(body);
  if (outcome.status === 'pending') {
    return { status: 'incomplete', message: 'Query did not finish in time.' };
  }
  return outcome;
}

async function cancelJob(input: RunPreviewInput, jobId: string, location: string | null): Promise<void> {
  const url = new URL(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(input.projectId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
  );
  const resolvedLocation = location ?? input.location;
  if (resolvedLocation) url.searchParams.set('location', resolvedLocation);
  try {
    await input.fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      signal: input.signal,
    });
  } catch {
    // A read-only token may refuse cancellation. The member still sees the job id.
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text } };
  }
}

function errorText(body: Record<string, unknown> | null): string | null {
  const error = asRecord(body?.error);
  if (typeof error?.message === 'string' && error.message) return error.message;
  const errors = body?.errors;
  if (Array.isArray(errors)) {
    const first = asRecord(errors[0]);
    if (typeof first?.message === 'string' && first.message) return first.message;
  }
  return null;
}

function parseCount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
