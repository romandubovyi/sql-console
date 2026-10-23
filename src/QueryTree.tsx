import { ChevronDown, ChevronRight, FolderInput, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { folderIdFor, type QueryFolder } from './folders.ts';
import type { QueryItem } from './queries.ts';

interface QueryTreeProps {
  folders: readonly QueryFolder[];
  queries: readonly QueryItem[];
  selectedId: string;
  deleteArmedId: string | null;
  onOpen: (id: string) => void;
  onArmDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
  onToggle: (folderId: string) => void;
  onRename: (folderId: string, title: string) => void;
  onRemoveFolder: (folderId: string) => void;
  onMove: (queryId: string, folderId: string | null) => void;
}

export function QueryTree({
  folders,
  queries,
  selectedId,
  deleteArmedId,
  onOpen,
  onArmDelete,
  onDelete,
  onToggle,
  onRename,
  onRemoveFolder,
  onMove,
}: QueryTreeProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const skipRename = useRef(false);
  const [removeArmedId, setRemoveArmedId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const byId = new Map(queries.map(query => [query.id, query]));
  const placed = new Set(folders.flatMap(folder => folder.queryIds));
  const loose = queries.filter(query => !placed.has(query.id));

  function startRename(folder: QueryFolder) {
    setRemoveArmedId(null);
    setRenamingId(folder.id);
    setRenameValue(folder.title);
  }

  function commitRename() {
    if (skipRename.current) {
      skipRename.current = false;
      return;
    }
    if (!renamingId) return;
    onRename(renamingId, renameValue);
    setRenamingId(null);
  }

  return (
    <ul className="storage-list query-tree">
      {folders.map(folder => (
        <li key={folder.id} className="folder-block">
          <div className="folder-head">
            {renamingId === folder.id ? (
              <input
                className="folder-rename"
                aria-label={`Rename ${folder.title}`}
                value={renameValue}
                autoFocus
                onChange={event => setRenameValue(event.target.value)}
                onBlur={commitRename}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    skipRename.current = true;
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <button
                className="folder-toggle"
                type="button"
                aria-expanded={!folder.collapsed}
                onClick={() => onToggle(folder.id)}
              >
                {folder.collapsed ? (
                  <ChevronRight size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )}
                <span className="folder-name">{folder.title}</span>
              </button>
            )}
            <button
              className="icon-button"
              type="button"
              aria-label={`Rename ${folder.title}`}
              onClick={() => startRename(folder)}
            >
              <Pencil size={14} aria-hidden="true" />
            </button>
            {removeArmedId === folder.id ? (
              <button className="danger-text" type="button" onClick={() => onRemoveFolder(folder.id)}>
                Remove
              </button>
            ) : (
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove folder ${folder.title}`}
                title="Remove the folder. Queries stay in the list."
                onClick={() => {
                  setRenamingId(null);
                  setRemoveArmedId(folder.id);
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {folder.collapsed ? null : (
            <ul className="folder-queries">
              {folder.queryIds.length === 0 ? <li className="folder-empty">No queries</li> : null}
              {folder.queryIds.map(id => {
                const query = byId.get(id);
                return query ? (
                  <QueryRow
                    key={query.id}
                    query={query}
                    selected={query.id === selectedId}
                    deleteArmed={deleteArmedId === query.id}
                    moving={movingId === query.id}
                    folders={folders}
                    onOpen={onOpen}
                    onArmDelete={onArmDelete}
                    onDelete={onDelete}
                    onMove={onMove}
                    onMoving={setMovingId}
                  />
                ) : null;
              })}
            </ul>
          )}
        </li>
      ))}
      {loose.map(query => (
        <QueryRow
          key={query.id}
          query={query}
          selected={query.id === selectedId}
          deleteArmed={deleteArmedId === query.id}
          moving={movingId === query.id}
          folders={folders}
          onOpen={onOpen}
          onArmDelete={onArmDelete}
          onDelete={onDelete}
          onMove={onMove}
          onMoving={setMovingId}
        />
      ))}
    </ul>
  );
}

function QueryRow({
  query,
  selected,
  deleteArmed,
  moving,
  folders,
  onOpen,
  onArmDelete,
  onDelete,
  onMove,
  onMoving,
}: {
  query: QueryItem;
  selected: boolean;
  deleteArmed: boolean;
  moving: boolean;
  folders: readonly QueryFolder[];
  onOpen: (id: string) => void;
  onArmDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
  onMove: (queryId: string, folderId: string | null) => void;
  onMoving: (id: string | null) => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const home = folderIdFor(folders, query.id);

  useEffect(() => {
    if (!moving) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rowRef.current?.contains(target)) return;
      onMoving(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMoving(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [moving, onMoving]);

  return (
    <li className="query-row" id={`query-${query.id}`} ref={rowRef}>
      <button
        type="button"
        className="storage-item"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(query.id)}
      >
        <span className="storage-title">{query.title}</span>
      </button>
      {folders.length > 0 ? (
        <button
          className="icon-button"
          type="button"
          aria-expanded={moving}
          aria-label={`Move ${query.title}`}
          title="Move to a folder"
          onClick={() => {
            onArmDelete(null);
            onMoving(moving ? null : query.id);
          }}
        >
          <FolderInput size={14} aria-hidden="true" />
        </button>
      ) : null}
      {deleteArmed ? (
        <button className="danger-text" type="button" onClick={() => onDelete(query.id)}>
          Delete
        </button>
      ) : (
        <button
          className="icon-button"
          type="button"
          aria-label={`Delete ${query.title}`}
          onClick={() => {
            onMoving(null);
            onArmDelete(query.id);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
      {moving ? (
        <ul className="move-list" aria-label={`Folders for ${query.title}`}>
          <li>
            <button
              type="button"
              aria-current={home ? undefined : 'true'}
              onClick={() => {
                onMove(query.id, null);
                onMoving(null);
              }}
            >
              No folder
            </button>
          </li>
          {folders.map(folder => (
            <li key={folder.id}>
              <button
                type="button"
                aria-current={home === folder.id ? 'true' : undefined}
                onClick={() => {
                  onMove(query.id, folder.id);
                  onMoving(null);
                }}
              >
                {folder.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
