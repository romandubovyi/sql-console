import type { PluginCollection, PluginCollectionDocument } from '@owox/plugin-sdk';

export const QUERIES_COLLECTION = 'queries';
export const PREFERENCES_COLLECTION = 'preferences';
export const UNTITLED_QUERY = 'Untitled query';
export const MAX_VERSIONS = 100;
export const MAX_DESCRIPTION = 2500;

export interface QueryVersion {
  sql: string;
  savedAt: string;
}

export interface QueryDocument {
  title: string;
  sql: string;
  description: string;
  versions: QueryVersion[];
}

export interface QueryItem {
  id: string;
  title: string;
  sql: string;
  description: string;
  versions: QueryVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface PreferencesDocument {
  projectId: string;
  location: string;
}

export function emptyQuery(): QueryDocument {
  return { title: UNTITLED_QUERY, sql: '', description: '', versions: [] };
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
  stored: Pick<QueryItem, 'title' | 'sql' | 'description' | 'versions'> | null,
  title: string,
  sql: string,
  description: string,
): boolean {
  if (!stored) return false;
  const nextTitle = title.trim() || UNTITLED_QUERY;
  if (stored.title !== nextTitle || stored.sql !== sql || stored.description !== limitDescription(description)) {
    return true;
  }
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
  const description = limitDescription(typeof record?.description === 'string' ? record.description : '');
  const versions = Array.isArray(record?.versions)
    ? record.versions.flatMap(version => {
        const item = asRecord(version);
        if (!item || typeof item.sql !== 'string' || typeof item.savedAt !== 'string') return [];
        return [{ sql: item.sql, savedAt: item.savedAt }];
      }).slice(0, MAX_VERSIONS)
    : [];
  return { title, sql, description, versions };
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
    description: document.description,
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
