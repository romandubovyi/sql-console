const SOURCE_TYPES = new Set(['TABLE', 'VIEW', 'CONNECTOR']);
const BIGQUERY_TYPES = new Set(['GOOGLE_BIGQUERY', 'LEGACY_GOOGLE_BIGQUERY']);
const DETAIL_BATCH = 8;
const MAX_FIELD_DEPTH = 6;

export interface SqlSourceField {
  name: string;
  type: string;
  description: string;
  fields: SqlSourceField[];
}

/** A BigQuery table the member can already reach through a data mart. */
export interface SqlSource {
  id: string;
  title: string;
  fullyQualifiedName: string;
  fields: SqlSourceField[];
}

export interface SqlSourceListItem {
  id: string;
  title: string;
  definitionType?: string | null;
  storage: { type: string };
}

export interface SqlSourceClient {
  dataMarts: { list(): Promise<SqlSourceListItem[]> };
  getJson<T>(path: string): Promise<T>;
}

export function sourceFromDetail(item: { id: string; title: string }, detail: unknown): SqlSource | null {
  const record = asRecord(detail);
  if (!record || typeof record.definitionType !== 'string') return null;
  const fullyQualifiedName = readFullyQualifiedName(record.definitionType, record.definition);
  if (!fullyQualifiedName) return null;
  const detailTitle = typeof record.title === 'string' ? record.title.trim() : '';
  const schema = asRecord(record.schema);
  return {
    id: item.id,
    title: detailTitle || item.title.trim() || fullyQualifiedName,
    fullyQualifiedName,
    fields: schema?.type === 'bigquery-data-mart-schema' ? readFields(schema.fields, 0) : [],
  };
}

/** Loads table, view, and connector sources for BigQuery data marts the member can open. */
export async function loadSqlSources(client: SqlSourceClient): Promise<SqlSource[]> {
  const listed = await client.dataMarts.list();
  const candidates = listed.filter(
    item =>
      typeof item.definitionType === 'string' &&
      SOURCE_TYPES.has(item.definitionType) &&
      BIGQUERY_TYPES.has(item.storage.type),
  );
  const loaded = await mapInBatches(candidates, DETAIL_BATCH, async item => {
    try {
      const detail = await client.getJson<unknown>(`/api/data-marts/${encodeURIComponent(item.id)}`);
      return sourceFromDetail(item, detail);
    } catch {
      return null;
    }
  });
  const sources = loaded.filter((source): source is SqlSource => source !== null);
  sources.sort((left, right) => left.title.localeCompare(right.title) || left.fullyQualifiedName.localeCompare(right.fullyQualifiedName));
  return sources;
}

function readFullyQualifiedName(definitionType: string, definition: unknown): string | null {
  const record = asRecord(definition);
  if (!record) return null;
  if (definitionType === 'TABLE' || definitionType === 'VIEW') return readName(record.fullyQualifiedName);
  if (definitionType === 'CONNECTOR') {
    const storage = asRecord(asRecord(record.connector)?.storage);
    return readName(storage?.fullyQualifiedName);
  }
  return null;
}

function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name || null;
}

function readFields(value: unknown, depth: number): SqlSourceField[] {
  if (depth > MAX_FIELD_DEPTH || !Array.isArray(value)) return [];
  const fields: SqlSourceField[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const name = record && typeof record.name === 'string' ? record.name.trim() : '';
    if (!record || !name || asRecord(record.calculated)) continue;
    fields.push({
      name,
      type: typeof record.type === 'string' ? record.type : '',
      description: typeof record.description === 'string' ? record.description.trim() : '',
      fields: readFields(record.fields, depth + 1),
    });
  }
  return fields;
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
