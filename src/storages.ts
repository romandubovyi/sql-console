import type { OWOXApiClient } from '@owox/api-client';

const BIGQUERY_TYPES = new Set(['GOOGLE_BIGQUERY', 'LEGACY_GOOGLE_BIGQUERY']);
const DETAIL_BATCH = 8;

export interface StorageListItem {
  id: string;
  title: string;
  type: string;
  availableForUse?: boolean;
}

export interface BigQueryStorageOption {
  id: string;
  title: string;
  gcpProjectId: string | null;
  /** Null means the storage leaves the BigQuery location to autodetect. */
  location: string | null;
}

export interface StorageCatalog {
  options: BigQueryStorageOption[];
  unread: number;
}

export function storageOptionFromDetail(storage: StorageListItem, detail: unknown): BigQueryStorageOption | null {
  if (!BIGQUERY_TYPES.has(storage.type)) return null;
  if (storage.availableForUse === false) return null;
  const config = asRecord(asRecord(detail)?.config);
  const projectId = config?.projectId;
  const gcpProjectId = typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
  if (!gcpProjectId) return null;
  const legacy = storage.type === 'LEGACY_GOOGLE_BIGQUERY';
  let title = storage.title.trim() ? storage.title.trim() : 'Untitled storage';
  if (legacy) title = `${title} (legacy)`;
  return {
    id: storage.id,
    title,
    gcpProjectId,
    location: normalizeLocation(config?.location),
  };
}

export function storageSuggestionDetail(option: BigQueryStorageOption): string {
  return `Project ${option.gcpProjectId ?? 'missing'} · Location ${option.location ?? 'autodetect'}`;
}

export function filterStorageOptions(
  options: readonly BigQueryStorageOption[],
  query: string,
): BigQueryStorageOption[] {
  const fillable = options.filter(option => option.gcpProjectId);
  const needle = query.trim().toLowerCase();
  if (!needle) return fillable;
  return fillable.filter(option => {
    const haystack = [option.title, option.gcpProjectId ?? '', option.location ?? 'autodetect'].join('\n');
    return haystack.toLowerCase().includes(needle);
  });
}

export function firstSelectableIndex(options: readonly BigQueryStorageOption[]): number {
  return options.findIndex(option => option.gcpProjectId);
}

export function stepSelectable(
  options: readonly BigQueryStorageOption[],
  activeIndex: number,
  direction: 1 | -1,
): number {
  const start = activeIndex < 0 ? (direction === 1 ? -1 : options.length) : activeIndex;
  for (let index = start + direction; index >= 0 && index < options.length; index += direction) {
    if (options[index]?.gcpProjectId) return index;
  }
  return activeIndex;
}

export async function loadBigQueryStorages(owox: OWOXApiClient): Promise<StorageCatalog> {
  const list = await owox.storages.list();
  const bigQuery = list.filter(storage => BIGQUERY_TYPES.has(storage.type));
  const loaded = await mapInBatches(bigQuery, DETAIL_BATCH, async storage => {
    try {
      const detail = await owox.getJson<unknown>(`/api/data-storages/${encodeURIComponent(storage.id)}`);
      return { option: storageOptionFromDetail(storage, detail), failed: false };
    } catch {
      return { option: null, failed: true };
    }
  });
  const options = loaded.flatMap(item => (item.option ? [item.option] : []));
  options.sort((left, right) => left.title.localeCompare(right.title));
  return { options, unread: loaded.filter(item => item.failed).length };
}

function normalizeLocation(location: unknown): string | null {
  if (typeof location !== 'string') return null;
  const trimmed = location.trim();
  if (!trimmed || trimmed.toUpperCase() === 'AUTODETECT') return null;
  return trimmed;
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
