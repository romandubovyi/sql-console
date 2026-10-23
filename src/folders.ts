export const MAX_FOLDERS = 100;
export const MAX_FOLDER_TITLE = 80;

export interface QueryFolder {
  id: string;
  title: string;
  queryIds: string[];
  collapsed: boolean;
}

export function normalizeFolders(value: unknown): QueryFolder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const usedQueries = new Set<string>();
  const folders: QueryFolder[] = [];
  for (const item of value) {
    if (folders.length >= MAX_FOLDERS) break;
    const record = asRecord(item);
    const id = cleanId(record?.id);
    const title = folderTitle(typeof record?.title === 'string' ? record.title : '');
    if (!record || !id || !title || seen.has(id)) continue;
    seen.add(id);
    const queryIds: string[] = [];
    if (Array.isArray(record.queryIds)) {
      for (const queryId of record.queryIds) {
        const cleaned = cleanId(queryId);
        if (!cleaned || usedQueries.has(cleaned)) continue;
        usedQueries.add(cleaned);
        queryIds.push(cleaned);
      }
    }
    folders.push({ id, title, queryIds, collapsed: record.collapsed === true });
  }
  return folders;
}

export function folderTitle(value: string): string | null {
  const title = value.trim().replace(/\s+/g, ' ');
  if (!title) return null;
  return title.length <= MAX_FOLDER_TITLE ? title : title.slice(0, MAX_FOLDER_TITLE);
}

export function createFolder(folders: readonly QueryFolder[], title: string, id: string): QueryFolder[] | null {
  const cleaned = folderTitle(title);
  const folderId = cleanId(id);
  if (!cleaned || !folderId || folders.length >= MAX_FOLDERS) return null;
  if (folders.some(folder => folder.id === folderId)) return null;
  return [...folders, { id: folderId, title: cleaned, queryIds: [], collapsed: false }];
}

export function renameFolder(folders: readonly QueryFolder[], id: string, title: string): QueryFolder[] | null {
  const cleaned = folderTitle(title);
  if (!cleaned) return null;
  const index = folders.findIndex(folder => folder.id === id);
  const current = folders[index];
  if (!current) return null;
  if (current.title === cleaned) return folders as QueryFolder[];
  const next = [...folders];
  next[index] = { ...current, title: cleaned };
  return next;
}

export function removeFolder(folders: readonly QueryFolder[], id: string): QueryFolder[] {
  return folders.filter(folder => folder.id !== id);
}

export function toggleFolder(folders: readonly QueryFolder[], id: string): QueryFolder[] {
  return folders.map(folder => (folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder));
}

/** Open the folder that holds this query. The same array comes back when it is already open. */
export function revealQuery(folders: readonly QueryFolder[], queryId: string): QueryFolder[] {
  const index = folders.findIndex(folder => folder.collapsed && folder.queryIds.includes(queryId));
  if (index < 0) return folders as QueryFolder[];
  const next = [...folders];
  const folder = next[index];
  if (!folder) return folders as QueryFolder[];
  next[index] = { ...folder, collapsed: false };
  return next;
}

export function folderIdFor(folders: readonly QueryFolder[], queryId: string): string | null {
  return folders.find(folder => folder.queryIds.includes(queryId))?.id ?? null;
}

/** `folderId` null leaves the query outside every folder. */
export function moveQuery(
  folders: readonly QueryFolder[],
  queryId: string,
  folderId: string | null,
): QueryFolder[] {
  const cleaned = cleanId(queryId);
  if (!cleaned) return folders as QueryFolder[];
  const currentId = folders.find(folder => folder.queryIds.includes(cleaned))?.id ?? null;
  if (currentId === folderId) return revealQuery(folders, cleaned);
  if (folderId && !folders.some(folder => folder.id === folderId)) return folders as QueryFolder[];
  let changed = false;
  const next = folders.map(folder => {
    const queryIds = folder.queryIds.filter(id => id !== cleaned);
    const removed = queryIds.length !== folder.queryIds.length;
    if (removed) changed = true;
    if (folder.id !== folderId) return removed ? { ...folder, queryIds } : folder;
    changed = true;
    return { ...folder, queryIds: [...queryIds, cleaned], collapsed: false };
  });
  return changed ? next : (folders as QueryFolder[]);
}

/** Drop query ids that no longer exist. The same array comes back when nothing was dropped. */
export function pruneFolders(folders: readonly QueryFolder[], ids: ReadonlySet<string>): QueryFolder[] {
  let changed = false;
  const next = folders.map(folder => {
    const queryIds = folder.queryIds.filter(id => ids.has(id));
    if (queryIds.length === folder.queryIds.length) return folder;
    changed = true;
    return { ...folder, queryIds };
  });
  return changed ? next : (folders as QueryFolder[]);
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64 || /[\s/\\]/.test(trimmed)) return null;
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
