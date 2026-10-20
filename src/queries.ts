import type { PluginCollection, PluginCollectionDocument } from '@owox/plugin-sdk';

export const QUERIES_COLLECTION = 'queries';
export const PREFERENCES_COLLECTION = 'preferences';
export const UNTITLED_QUERY = 'Untitled query';
export const MAX_VERSIONS = 100;

export interface QueryVersion {
  sql: string;
  savedAt: string;
}

export interface QueryDocument {
  title: string;
  sql: string;
  versions: QueryVersion[];
}

export interface QueryItem {
  id: string;
  title: string;
  sql: string;
  versions: QueryVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface PreferencesDocument {
  projectId: string;
  location: string;
}

export function emptyQuery(): QueryDocument {
  return { title: UNTITLED_QUERY, sql: '', versions: [] };
}

export function initialVersionPick(count: number): { focus: number; anchor: number | null } {
  if (count <= 1) return { focus: 0, anchor: null };
  return { focus: 0, anchor: 1 };
}

/** Left is the older save. Right is the newer save. A missing anchor compares against empty. */
export function versionSides(
  focus: number,
  anchor: number | null,
  count: number,
): { olderIndex: number | null; newerIndex: number } {
  if (count <= 0) return { olderIndex: null, newerIndex: 0 };
  const safeFocus = clampIndex(focus, count);
  if (anchor === null || anchor === safeFocus) return { olderIndex: null, newerIndex: safeFocus };
  const safeAnchor = clampIndex(anchor, count);
  return {
    olderIndex: Math.max(safeFocus, safeAnchor),
    newerIndex: Math.min(safeFocus, safeAnchor),
  };
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

export function queryIsDirty(stored: Pick<QueryItem, 'title' | 'sql' | 'versions'> | null, title: string, sql: string): boolean {
  if (!stored) return false;
  const nextTitle = title.trim() || UNTITLED_QUERY;
  if (stored.title !== nextTitle || stored.sql !== sql) return true;
  if (sql.trim() === '') return false;
  return stored.versions[0]?.sql !== sql;
}

/** Oldest empty Untitled query, which is the editor opened on each visit. */
export function landingQuery<T extends Pick<QueryItem, 'id' | 'title' | 'sql' | 'createdAt'>>(
  queries: readonly T[],
): T | null {
  const matches = queries.filter(query => query.title === UNTITLED_QUERY && query.sql.trim() === '');
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] ?? null;
}

export function normalizeQuery(document: unknown): QueryDocument {
  const record = asRecord(document);
  const title = typeof record?.title === 'string' && record.title.trim() ? record.title.trim() : UNTITLED_QUERY;
  const sql = typeof record?.sql === 'string' ? record.sql : '';
  const versions = Array.isArray(record?.versions)
    ? record.versions.flatMap(version => {
        const item = asRecord(version);
        if (!item || typeof item.sql !== 'string' || typeof item.savedAt !== 'string') return [];
        return [{ sql: item.sql, savedAt: item.savedAt }];
      }).slice(0, MAX_VERSIONS)
    : [];
  return { title, sql, versions };
}

export function normalizePreferences(document: unknown): PreferencesDocument {
  const record = asRecord(document);
  return {
    projectId: typeof record?.projectId === 'string' ? record.projectId : '',
    location: typeof record?.location === 'string' ? record.location : '',
  };
}

export function toQueryItem(stored: PluginCollectionDocument<unknown>): QueryItem {
  const document = normalizeQuery(stored.document);
  return {
    id: stored.id,
    title: document.title,
    sql: document.sql,
    versions: document.versions,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
