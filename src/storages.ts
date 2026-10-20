import type { OWOXApiClient } from '@owox/api-client';

const BIGQUERY_TYPES = new Set(['GOOGLE_BIGQUERY', 'LEGACY_GOOGLE_BIGQUERY']);
const DETAIL_BATCH = 8;

export interface BigQueryStorageOption {
  id: string;
  title: string;
  gcpProjectId: string | null;
  /** Null means the storage leaves the BigQuery location to autodetect. */
  location: string | null;
  available: boolean;
}

export async function loadBigQueryStorages(owox: OWOXApiClient): Promise<BigQueryStorageOption[]> {
  const list = await owox.storages.list();
  const bigQuery = list.filter(
    storage => typeof storage.type === 'string' && BIGQUERY_TYPES.has(storage.type),
  );

  const options = await mapInBatches(bigQuery, DETAIL_BATCH, async storage => {
    const detail = await owox.getJson<unknown>(`/api/data-storages/${encodeURIComponent(storage.id)}`);
    const config = asRecord(asRecord(detail)?.config);
    const projectId = config?.projectId;
    const location = config?.location;
    const legacy = storage.type === 'LEGACY_GOOGLE_BIGQUERY';
    const title = storage.title.trim() ? storage.title.trim() : 'Untitled storage';
    return {
      id: storage.id,
      title: legacy ? `${title} (legacy)` : title,
      gcpProjectId: typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null,
      location:
        typeof location === 'string' && location.trim() && location !== 'AUTODETECT'
          ? location.trim()
          : null,
      available: storage.availableForUse !== false,
    };
  });

  return options.sort((left, right) => left.title.localeCompare(right.title));
}

async function mapInBatches<T, R>(items: T[], size: number, map: (item: T) => Promise<R>): Promise<R[]> {
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
