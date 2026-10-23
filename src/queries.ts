import type { PluginCollection, PluginCollectionDocument } from '@owox/plugin-sdk';
import { normalizeExportTarget, sameExportTarget, type ExportTarget } from './export-target.ts';
import { normalizeFolders, type QueryFolder } from './folders.ts';

export const QUERIES_COLLECTION = 'queries';
export const PREFERENCES_COLLECTION = 'preferences';
export const UNTITLED_QUERY = 'Untitled query';
export const MAX_VERSIONS = 100;
export const MAX_DESCRIPTION = 2500;

export interface QueryVersion {
  sql: string;
  savedAt: string;
}

/** BigQuery keeps this job's rows for about 24 hours. */
export interface LastRun {
  jobId: string;
  projectId: string;
  /** Empty when the job did not report a location. */
  location: string;
  ranAt: string;
  sql: string;
}

/** GCP project and sheet cadence captured when the schedule was saved. */
export interface SheetSchedule {
  scheduleId: string;
  projectId: string;
  /** Empty lets BigQuery choose the location. */
  location: string;
  cron: string;
  timeZone: string;
}

/** Outcome of the last scheduled spreadsheet write, including a failed one. */
export interface ScheduledExport {
  ranAt: string;
  status: 'ok' | 'error';
  message: string;
  rows: number | null;
}

/** Where the editor SQL was imported from. A report is never written back. */
export type SqlOrigin =
  | { kind: 'data-mart'; dataMartId: string; title: string }
  | { kind: 'report'; reportId: string; dataMartId: string; title: string };

export interface QueryDocument {
  title: string;
  sql: string;
  description: string;
  versions: QueryVersion[];
  exportTarget: ExportTarget | null;
  lastRun: LastRun | null;
  sheetSchedule: SheetSchedule | null;
  scheduledExport: ScheduledExport | null;
  sqlOrigin: SqlOrigin | null;
}

export interface QueryItem {
  id: string;
  title: string;
  sql: string;
  description: string;
  versions: QueryVersion[];
  exportTarget: ExportTarget | null;
  lastRun: LastRun | null;
  sheetSchedule: SheetSchedule | null;
  scheduledExport: ScheduledExport | null;
  sqlOrigin: SqlOrigin | null;
  createdAt: string;
  updatedAt: string;
}

/** Pixel sizes the member chose for the queries pane and the editor pane. */
export interface LayoutSizes {
  /** Queries column width. */
  sidebar: number;
  /** Queries block height when the window is narrow. */
  stack: number;
  /** Editor block height. The preview fills the space that remains. */
  editor: number;
  /** AI assistant column width. */
  assistant: number;
}

export const DEFAULT_SIDEBAR_SIZE = 260;
export const DEFAULT_EDITOR_SIZE = 320;
export const DEFAULT_ASSISTANT_SIZE = 360;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const EDITOR_MIN = 160;
export const EDITOR_MAX = 1200;
export const ASSISTANT_MIN = 260;
export const ASSISTANT_MAX = 640;

export interface PreferencesDocument {
  projectId: string;
  location: string;
  folders: QueryFolder[];
  layout: LayoutSizes;
}

export function emptyQuery(): QueryDocument {
  return {
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
}

export function storedQuery(
  input: Pick<
    QueryDocument,
    'title' | 'sql' | 'description' | 'exportTarget' | 'lastRun' | 'sheetSchedule' | 'scheduledExport' | 'sqlOrigin'
  >,
  versions: QueryVersion[],
): QueryDocument {
  return {
    title: input.title.trim() || UNTITLED_QUERY,
    sql: input.sql,
    description: limitDescription(input.description),
    versions,
    exportTarget: normalizeExportTarget(input.exportTarget),
    lastRun: normalizeLastRun(input.lastRun),
    sheetSchedule: normalizeSheetSchedule(input.sheetSchedule),
    scheduledExport: normalizeScheduledExport(input.scheduledExport),
    sqlOrigin: normalizeSqlOrigin(input.sqlOrigin),
  };
}

export function limitDescription(value: string): string {
  return value.length <= MAX_DESCRIPTION ? value : value.slice(0, MAX_DESCRIPTION);
}

/** Newest save on the right, the save before it on the left. One save compares with empty. */
export function initialVersionPick(count: number): { base: number | null; head: number } {
  if (count <= 1) return { base: null, head: 0 };
  return { base: 1, head: 0 };
}

/** Compare `index` with the save immediately before it. The oldest save compares with empty. */
export function compareWithPrevious(index: number, count: number): { base: number | null; head: number } {
  if (count <= 0) return { base: null, head: 0 };
  const head = clampIndex(index, count);
  return { base: head + 1 < count ? head + 1 : null, head };
}

function clampIndex(index: number, count: number): number {
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function appendVersion(versions: QueryVersion[], sql: string, savedAt: string): QueryVersion[] {
  if (versions.length === 0 && sql.trim() === '') return versions;
  if (versions[0]?.sql === sql) return versions;
  return [{ sql, savedAt }, ...versions].slice(0, MAX_VERSIONS);
}

export function queryIsDirty(
  stored: Pick<QueryItem, 'title' | 'sql' | 'description' | 'versions' | 'exportTarget'> | null,
  title: string,
  sql: string,
  description: string,
  exportTarget: ExportTarget | null,
): boolean {
  if (!stored) return false;
  const nextTitle = title.trim() || UNTITLED_QUERY;
  if (
    stored.title !== nextTitle ||
    stored.sql !== sql ||
    stored.description !== limitDescription(description) ||
    !sameExportTarget(stored.exportTarget, exportTarget)
  ) {
    return true;
  }
  if (sql.trim() === '') return false;
  return stored.versions[0]?.sql !== sql;
}

type BlankQuery = Pick<
  QueryItem,
  | 'title'
  | 'sql'
  | 'description'
  | 'versions'
  | 'exportTarget'
  | 'lastRun'
  | 'sheetSchedule'
  | 'scheduledExport'
  | 'sqlOrigin'
>;

/** An Untitled query the editor used to create on every open, with nothing stored on it. */
export function isBlankQuery(query: BlankQuery): boolean {
  return (
    query.title === UNTITLED_QUERY &&
    query.sql.trim() === '' &&
    query.description.trim() === '' &&
    query.versions.length === 0 &&
    query.exportTarget === null &&
    query.lastRun === null &&
    query.sheetSchedule === null &&
    query.scheduledExport === null &&
    query.sqlOrigin === null
  );
}

/** The query to open on a visit. A blank shell is not one. */
export function resumeQuery<T extends BlankQuery & Pick<QueryItem, 'updatedAt'>>(queries: readonly T[]): T | null {
  const real = queries.filter(query => !isBlankQuery(query));
  return [...real].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

export function normalizeQuery(document: unknown): QueryDocument {
  const record = asRecord(document);
  const title = typeof record?.title === 'string' && record.title.trim() ? record.title.trim() : UNTITLED_QUERY;
  const sql = typeof record?.sql === 'string' ? record.sql : '';
  const description = limitDescription(typeof record?.description === 'string' ? record.description : '');
  const versions = Array.isArray(record?.versions)
    ? record.versions.flatMap(version => {
        const item = asRecord(version);
        if (!item || typeof item.sql !== 'string' || typeof item.savedAt !== 'string') return [];
        return [{ sql: item.sql, savedAt: item.savedAt }];
      }).slice(0, MAX_VERSIONS)
    : [];
  return {
    title,
    sql,
    description,
    versions,
    exportTarget: normalizeExportTarget(record?.exportTarget),
    lastRun: normalizeLastRun(record?.lastRun),
    sheetSchedule: normalizeSheetSchedule(record?.sheetSchedule),
    scheduledExport: normalizeScheduledExport(record?.scheduledExport),
    sqlOrigin: normalizeSqlOrigin(record?.sqlOrigin),
  };
}

export function normalizeSqlOrigin(value: unknown): SqlOrigin | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = originTitle(record.title);
  if (!title) return null;
  if (record.kind === 'data-mart') {
    const dataMartId = cleanToken(record.dataMartId, 64);
    return dataMartId ? { kind: 'data-mart', dataMartId, title } : null;
  }
  if (record.kind === 'report') {
    const reportId = cleanToken(record.reportId, 64);
    const dataMartId = cleanToken(record.dataMartId, 64) ?? '';
    return reportId ? { kind: 'report', reportId, dataMartId, title } : null;
  }
  return null;
}

export function sameSqlOrigin(left: SqlOrigin | null, right: SqlOrigin | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function originTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (!title) return null;
  return title.length <= 255 ? title : title.slice(0, 255);
}

export function normalizeSheetSchedule(value: unknown): SheetSchedule | null {
  const record = asRecord(value);
  if (!record) return null;
  const scheduleId = cleanToken(record.scheduleId, 64);
  const projectId = cleanToken(record.projectId, 200);
  const location = typeof record.location === 'string' ? record.location.trim() : '';
  const cronRaw = typeof record.cron === 'string' ? record.cron : '';
  const cron = cronRaw.trim();
  const timeZone = typeof record.timeZone === 'string' ? record.timeZone.trim() : '';
  if (!scheduleId || !projectId) return null;
  if (location && !cleanToken(location, 64)) return null;
  if (!cron || cron.length > 255 || /[\r\n]/.test(cronRaw)) return null;
  if (!timeZone || timeZone.length > 64 || !/^[A-Za-z0-9_/+-]+$/.test(timeZone)) return null;
  return { scheduleId, projectId, location, cron, timeZone };
}

export function normalizeScheduledExport(value: unknown): ScheduledExport | null {
  const record = asRecord(value);
  if (!record) return null;
  const ranAt = typeof record.ranAt === 'string' ? record.ranAt : '';
  const status = record.status === 'ok' || record.status === 'error' ? record.status : null;
  const message = typeof record.message === 'string' ? record.message.slice(0, 500) : '';
  const rows = record.rows === null ? null : typeof record.rows === 'number' ? record.rows : Number.NaN;
  if (!status || !message || Number.isNaN(Date.parse(ranAt))) return null;
  if (rows !== null && (!Number.isInteger(rows) || rows < 0)) return null;
  return { ranAt, status, message, rows };
}

export function normalizeLastRun(value: unknown): LastRun | null {
  const record = asRecord(value);
  if (!record) return null;
  const jobId = cleanToken(record.jobId, 1024);
  const projectId = cleanToken(record.projectId, 200);
  const location = typeof record.location === 'string' ? record.location.trim() : '';
  const ranAt = typeof record.ranAt === 'string' ? record.ranAt : '';
  const sql = typeof record.sql === 'string' ? record.sql : '';
  if (!jobId || !projectId || Number.isNaN(Date.parse(ranAt))) return null;
  if (location && !cleanToken(location, 64)) return null;
  return { jobId, projectId, location, ranAt, sql };
}

function cleanToken(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\s/\\]/.test(trimmed)) return null;
  return trimmed;
}

export function normalizeLayout(value: unknown): LayoutSizes {
  const record = asRecord(value);
  return {
    sidebar: layoutSize(record?.sidebar, DEFAULT_SIDEBAR_SIZE, SIDEBAR_MIN, SIDEBAR_MAX),
    stack: layoutSize(record?.stack, DEFAULT_SIDEBAR_SIZE, SIDEBAR_MIN, SIDEBAR_MAX),
    editor: layoutSize(record?.editor, DEFAULT_EDITOR_SIZE, EDITOR_MIN, EDITOR_MAX),
    assistant: layoutSize(record?.assistant, DEFAULT_ASSISTANT_SIZE, ASSISTANT_MIN, ASSISTANT_MAX),
  };
}

export function sameLayout(left: LayoutSizes, right: LayoutSizes): boolean {
  return (
    left.sidebar === right.sidebar &&
    left.stack === right.stack &&
    left.editor === right.editor &&
    left.assistant === right.assistant
  );
}

function layoutSize(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function normalizePreferences(document: unknown): PreferencesDocument {
  const record = asRecord(document);
  return {
    projectId: typeof record?.projectId === 'string' ? record.projectId : '',
    location: typeof record?.location === 'string' ? record.location : '',
    folders: normalizeFolders(record?.folders),
    layout: normalizeLayout(record?.layout),
  };
}

export function toQueryItem(stored: PluginCollectionDocument<unknown>): QueryItem {
  const document = normalizeQuery(stored.document);
  return {
    id: stored.id,
    title: document.title,
    sql: document.sql,
    description: document.description,
    versions: document.versions,
    exportTarget: document.exportTarget,
    lastRun: document.lastRun,
    sheetSchedule: document.sheetSchedule,
    scheduledExport: document.scheduledExport,
    sqlOrigin: document.sqlOrigin,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

export async function listAllQueries(
  collection: Pick<PluginCollection<QueryDocument>, 'list'>,
): Promise<PluginCollectionDocument<QueryDocument>[]> {
  const items: PluginCollectionDocument<QueryDocument>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await collection.list(cursor ? { limit: 100, cursor } : { limit: 100 });
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }
  return items;
}

export function formatVersionTime(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function lastRunExpiredMessage(ranAt: string): string {
  return `Last run ${formatVersionTime(ranAt)}. BigQuery no longer has this result. Run the query again.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
