import type { SqlOrigin } from './queries.ts';

const BIGQUERY_TYPES = new Set(['GOOGLE_BIGQUERY', 'LEGACY_GOOGLE_BIGQUERY']);
const DETAIL_BATCH = 8;

export interface ImportListItem {
  id: string;
  title: string;
  definitionType?: string | null;
  storage: { type: string };
  reportsCount?: number;
}

export interface ImportMartChoice {
  id: string;
  title: string;
}

export interface ImportReportChoice {
  id: string;
  title: string;
  dataMartId: string;
  dataMartTitle: string;
}

export interface ImportCatalog {
  marts: ImportMartChoice[];
  reports: ImportReportChoice[];
}

export interface ImportClient {
  dataMarts: { list(): Promise<ImportListItem[]> };
  getJson<T>(path: string): Promise<T>;
  putJson<T>(path: string, body: unknown): Promise<T>;
}

/** SQL data marts, plus reports on BigQuery marts the member can open. */
export async function loadImportCatalog(client: ImportClient): Promise<ImportCatalog> {
  const listed = await client.dataMarts.list();
  const marts = listed
    .filter(item => item.definitionType === 'SQL' && BIGQUERY_TYPES.has(item.storage.type) && item.id.trim() !== '')
    .map(item => ({ id: item.id, title: label(item.title, 'Untitled data mart') }));
  marts.sort((left, right) => left.title.localeCompare(right.title));

  const withReports = listed.filter(
    item => BIGQUERY_TYPES.has(item.storage.type) && item.id.trim() !== '' && item.reportsCount !== 0,
  );
  const groups = await mapInBatches(withReports, DETAIL_BATCH, async item => {
    try {
      const body = await client.getJson<unknown>(`/api/reports/data-mart/${encodeURIComponent(item.id)}`);
      return reportsFromList(item, body);
    } catch {
      return [];
    }
  });
  const reports = groups.flat();
  reports.sort(
    (left, right) => left.title.localeCompare(right.title) || left.dataMartTitle.localeCompare(right.dataMartTitle),
  );
  return { marts, reports };
}

/** The SQL stored on a SQL data mart. */
export async function readDataMartSql(client: ImportClient, dataMartId: string): Promise<string> {
  const detail = await client.getJson<unknown>(`/api/data-marts/${encodeURIComponent(dataMartId)}`);
  const record = asRecord(detail);
  const definition = asRecord(record?.definition);
  const sql = typeof definition?.sqlQuery === 'string' ? definition.sqlQuery : '';
  if (record?.definitionType !== 'SQL' || sql.trim() === '') {
    throw new Error('This data mart has no SQL to import.');
  }
  return sql;
}

/** The SQL the report will run, including its columns, filters, and limits. */
export async function readReportSql(client: ImportClient, reportId: string): Promise<string> {
  const detail = await client.getJson<unknown>(`/api/reports/${encodeURIComponent(reportId)}/generated-sql`);
  const sql = asRecord(detail)?.sql;
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error('This report has no SQL to import.');
  return sql;
}

/** Replaces the SQL on the data mart this query was imported from. */
export async function replaceDataMartSql(client: ImportClient, dataMartId: string, sql: string): Promise<void> {
  if (sql.trim() === '') throw new Error('Write a SQL query before updating the data mart.');
  await client.putJson(`/api/data-marts/${encodeURIComponent(dataMartId)}/definition`, {
    definitionType: 'SQL',
    definition: { sqlQuery: sql },
  });
}

export function dataMartOrigin(choice: ImportMartChoice): SqlOrigin {
  return { kind: 'data-mart', dataMartId: choice.id, title: choice.title };
}

export function reportOrigin(choice: ImportReportChoice): SqlOrigin {
  return { kind: 'report', reportId: choice.id, dataMartId: choice.dataMartId, title: choice.title };
}

function reportsFromList(item: ImportListItem, body: unknown): ImportReportChoice[] {
  if (!Array.isArray(body)) return [];
  const dataMartTitle = label(item.title, 'Untitled data mart');
  const reports: ImportReportChoice[] = [];
  for (const entry of body) {
    const record = asRecord(entry);
    const id = typeof record?.id === 'string' ? record.id.trim() : '';
    if (!record || !id) continue;
    reports.push({
      id,
      title: label(typeof record.title === 'string' ? record.title : '', 'Untitled report'),
      dataMartId: item.id,
      dataMartTitle,
    });
  }
  return reports;
}

function label(value: string, fallback: string): string {
  const title = value.trim();
  return title || fallback;
}

async function mapInBatches<T, R>(items: readonly T[], size: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    const batch = await Promise.all(items.slice(index, index + size).map(map));
    results.push(...batch);
  }
  return results;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
