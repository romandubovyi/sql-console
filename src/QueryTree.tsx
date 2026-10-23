import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { folderIdFor, type QueryFolder } from './folders.ts';
import type { QueryItem } from './queries.ts';

const QUERY_DRAG_TYPE = 'application/x-sql-console-query';
const ROOT_FOLDER = 'root';

function dropFolderId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId ?? null;
}

interface QueryTreeProps {
  folders: readonly QueryFolder[];
  queries: readonly QueryItem[];
  selectedId: string;
  onOpen: (id: string) => void;
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
  onOpen,
  onDelete,
  onToggle,
  onRename,
  onRemoveFolder,
  onMove,
}: QueryTreeProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const skipRename = useRef(false);
  const draggingRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byId = new Map(queries.map(query => [query.id, query]));
  const placed = new Set(folders.flatMap(folder => folder.queryIds));
  const loose = queries.filter(query => !placed.has(query.id));

  function beginDrag(id: string) {
    draggingRef.current = id;
    setDraggingId(id);
  }

  function endDrag() {
    draggingRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }

  function dragOver(event: DragEvent<HTMLElement>) {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const next = dropFolderId(event.target) ?? 'root';
    setDropTarget(current => (current === next ? current : next));
  }

  function drop(event: DragEvent<HTMLElement>) {
    const queryId = draggingRef.current;
    if (!queryId) return;
    event.preventDefault();
    onMove(queryId, dropFolderId(event.target));
    endDrag();
  }

  function startRename(folder: QueryFolder) {
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
    <ul
      className="storage-list query-tree"
      onDragOver={dragOver}
      onDrop={drop}
      onDragLeave={event => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDropTarget(null);
      }}
    >
      {folders.map(folder => (
        <li
          key={folder.id}
          className={dropTarget === folder.id ? 'folder-block is-drop' : 'folder-block'}
          data-folder-id={folder.id}
        >
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
            {renamingId === folder.id ? null : (
              <FolderActions
                title={folder.title}
                onRename={() => startRename(folder)}
                onRemove={() => onRemoveFolder(folder.id)}
              />
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
                    dragging={draggingId === query.id}
                    canDrag={folders.length > 0}
                    folders={folders}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onMove={onMove}
                    onDragQuery={beginDrag}
                    onDragQueryEnd={endDrag}
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
          dragging={draggingId === query.id}
          canDrag={folders.length > 0}
          folders={folders}
          onOpen={onOpen}
          onDelete={onDelete}
          onMove={onMove}
          onDragQuery={beginDrag}
          onDragQueryEnd={endDrag}
        />
      ))}
      {draggingId ? (
        <li className={dropTarget === 'root' ? 'root-drop is-drop' : 'root-drop'}>Outside folders</li>
      ) : null}
    </ul>
  );
}

function QueryRow({
  query,
  selected,
  dragging,
  canDrag,
  folders,
  onOpen,
  onDelete,
  onMove,
  onDragQuery,
  onDragQueryEnd,
}: {
  query: QueryItem;
  selected: boolean;
  dragging: boolean;
  canDrag: boolean;
  folders: readonly QueryFolder[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (queryId: string, folderId: string | null) => void;
  onDragQuery: (id: string) => void;
  onDragQueryEnd: () => void;
}) {
  const suppressClick = useRef(false);
  const className = [dragging ? 'is-dragging' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');

  return (
    <li className={className ? `query-row ${className}` : 'query-row'} id={`query-${query.id}`}>
      <button
        type="button"
        className="storage-item"
        draggable={canDrag}
        aria-current={selected ? 'true' : undefined}
        onDragStart={event => {
          suppressClick.current = true;
          event.dataTransfer.setData(QUERY_DRAG_TYPE, query.id);
          event.dataTransfer.effectAllowed = 'move';
          onDragQuery(query.id);
        }}
        onDragEnd={() => {
          setTimeout(onDragQueryEnd, 0);
          setTimeout(() => {
            suppressClick.current = false;
          }, 0);
        }}
        onClick={() => {
          if (suppressClick.current) return;
          onOpen(query.id);
        }}
      >
        <span className="storage-title">{query.title}</span>
      </button>
      <QueryActions
        query={query}
        folders={folders}
        onDelete={() => onDelete(query.id)}
        onMove={folderId => onMove(query.id, folderId)}
      />
    </li>
  );
}

function FolderActions({
  title,
  onRename,
  onRemove,
}: {
  title: string;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirm) return;
    contentRef.current?.querySelector<HTMLElement>('.is-danger')?.focus();
  }, [confirm]);

  return (
    <DropdownMenu.Root
      // A modal menu locks scroll and drops the page padding, which shifts the list.
      modal={false}
      onOpenChange={open => {
        if (!open) setConfirm(false);
      }}
    >
      <DropdownMenu.Trigger className="icon-button row-menu" aria-label={`Actions for ${title}`}>
        <MoreHorizontal size={15} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={contentRef}
          className="row-menu-panel"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label={`Actions for ${title}`}
        >
          {confirm ? (
            <>
              <DropdownMenu.Label className="row-menu-note">Queries stay in the list.</DropdownMenu.Label>
              <DropdownMenu.Item className="is-danger" onSelect={onRemove}>
                Remove folder
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              <DropdownMenu.Item onSelect={onRename}>Rename</DropdownMenu.Item>
              <DropdownMenu.Item
                className="is-danger"
                onSelect={event => {
                  event.preventDefault();
                  setConfirm(true);
                }}
              >
                Remove folder
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function QueryActions({
  query,
  folders,
  onDelete,
  onMove,
}: {
  query: QueryItem;
  folders: readonly QueryFolder[];
  onDelete: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const home = folderIdFor(folders, query.id);

  useEffect(() => {
    if (!confirm) return;
    contentRef.current?.querySelector<HTMLElement>('.is-danger')?.focus();
  }, [confirm]);

  return (
    <DropdownMenu.Root
      // A modal menu locks scroll and drops the page padding, which shifts the list.
      modal={false}
      onOpenChange={open => {
        if (!open) setConfirm(false);
      }}
    >
      <DropdownMenu.Trigger className="icon-button row-menu" aria-label={`Actions for ${query.title}`}>
        <MoreHorizontal size={15} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          ref={contentRef}
          className="row-menu-panel"
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          aria-label={`Actions for ${query.title}`}
        >
          {confirm ? (
            <>
              <DropdownMenu.Label className="row-menu-note">The saved query is removed.</DropdownMenu.Label>
              <DropdownMenu.Item className="is-danger" onSelect={onDelete}>
                Delete query
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              {folders.length > 0 ? (
                <DropdownMenu.RadioGroup
                  value={home ?? ROOT_FOLDER}
                  onValueChange={value => onMove(value === ROOT_FOLDER ? null : value)}
                >
                  <DropdownMenu.Label className="row-menu-label">Move to</DropdownMenu.Label>
                  <DropdownMenu.RadioItem value={ROOT_FOLDER}>
                    No folder
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} aria-hidden="true" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                  {folders.map(folder => (
                    <DropdownMenu.RadioItem key={folder.id} value={folder.id}>
                      {folder.title}
                      <DropdownMenu.ItemIndicator>
                        <Check size={14} aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              ) : null}
              {folders.length > 0 ? <DropdownMenu.Separator className="row-menu-rule" /> : null}
              <DropdownMenu.Item
                className="is-danger"
                onSelect={event => {
                  event.preventDefault();
                  setConfirm(true);
                }}
              >
                Delete
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
