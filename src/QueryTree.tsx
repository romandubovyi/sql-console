import { Check, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { folderIdFor, type QueryFolder } from './folders.ts';
import type { QueryItem } from './queries.ts';

const QUERY_DRAG_TYPE = 'application/x-sql-console-query';

interface OpenMenu {
  kind: 'folder' | 'query';
  id: string;
  confirm: boolean;
}

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
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const draggingRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const byId = new Map(queries.map(query => [query.id, query]));
  const placed = new Set(folders.flatMap(folder => folder.queryIds));
  const loose = queries.filter(query => !placed.has(query.id));

  function beginDrag(id: string) {
    draggingRef.current = id;
    setDraggingId(id);
    setMenu(null);
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
    setMenu(null);
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

  function openMenu(kind: OpenMenu['kind'], id: string) {
    setMenu({ kind, id, confirm: false });
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
      {folders.map(folder => {
        const folderMenu = menu?.kind === 'folder' && menu.id === folder.id ? menu : null;
        return (
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
                <RowMenu
                  label={`Actions for ${folder.title}`}
                  open={Boolean(folderMenu)}
                  onOpen={() => openMenu('folder', folder.id)}
                  onClose={() => setMenu(null)}
                >
                  {folderMenu?.confirm ? (
                    <>
                      <p className="row-menu-note">Queries stay in the list.</p>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        autoFocus
                        onClick={() => {
                          onRemoveFolder(folder.id);
                          setMenu(null);
                        }}
                      >
                        Remove folder
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" role="menuitem" onClick={() => startRename(folder)}>
                        Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => setMenu({ kind: 'folder', id: folder.id, confirm: true })}
                      >
                        Remove folder
                      </button>
                    </>
                  )}
                </RowMenu>
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
                      menu={menu?.kind === 'query' && menu.id === query.id ? menu : null}
                      dragging={draggingId === query.id}
                      canDrag={folders.length > 0}
                      folders={folders}
                      onOpen={onOpen}
                      onOpenMenu={() => openMenu('query', query.id)}
                      onCloseMenu={() => setMenu(null)}
                      onConfirmDelete={() => setMenu({ kind: 'query', id: query.id, confirm: true })}
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
        );
      })}
      {loose.map(query => (
        <QueryRow
          key={query.id}
          query={query}
          selected={query.id === selectedId}
          menu={menu?.kind === 'query' && menu.id === query.id ? menu : null}
          dragging={draggingId === query.id}
          canDrag={folders.length > 0}
          folders={folders}
          onOpen={onOpen}
          onOpenMenu={() => openMenu('query', query.id)}
          onCloseMenu={() => setMenu(null)}
          onConfirmDelete={() => setMenu({ kind: 'query', id: query.id, confirm: true })}
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
  menu,
  dragging,
  canDrag,
  folders,
  onOpen,
  onOpenMenu,
  onCloseMenu,
  onConfirmDelete,
  onDelete,
  onMove,
  onDragQuery,
  onDragQueryEnd,
}: {
  query: QueryItem;
  selected: boolean;
  menu: OpenMenu | null;
  dragging: boolean;
  canDrag: boolean;
  folders: readonly QueryFolder[];
  onOpen: (id: string) => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onConfirmDelete: () => void;
  onDelete: (id: string) => void;
  onMove: (queryId: string, folderId: string | null) => void;
  onDragQuery: (id: string) => void;
  onDragQueryEnd: () => void;
}) {
  const suppressClick = useRef(false);
  const home = folderIdFor(folders, query.id);
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
      <RowMenu label={`Actions for ${query.title}`} open={Boolean(menu)} onOpen={onOpenMenu} onClose={onCloseMenu}>
        {menu?.confirm ? (
          <>
            <p className="row-menu-note">The saved query is removed.</p>
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              autoFocus
              onClick={() => {
                onDelete(query.id);
                onCloseMenu();
              }}
            >
              Delete query
            </button>
          </>
        ) : (
          <>
            {folders.length > 0 ? (
              <>
                <p className="row-menu-label">Move to</p>
                <button
                  type="button"
                  role="menuitem"
                  aria-current={home ? undefined : 'true'}
                  onClick={() => {
                    onMove(query.id, null);
                    onCloseMenu();
                  }}
                >
                  <span>No folder</span>
                  {home ? null : <Check size={14} aria-hidden="true" />}
                </button>
                {folders.map(folder => (
                  <button
                    key={folder.id}
                    type="button"
                    role="menuitem"
                    aria-current={home === folder.id ? 'true' : undefined}
                    onClick={() => {
                      onMove(query.id, folder.id);
                      onCloseMenu();
                    }}
                  >
                    <span>{folder.title}</span>
                    {home === folder.id ? <Check size={14} aria-hidden="true" /> : null}
                  </button>
                ))}
                <div className="row-menu-rule" />
              </>
            ) : null}
            <button type="button" role="menuitem" className="is-danger" onClick={onConfirmDelete}>
              Delete
            </button>
          </>
        )}
      </RowMenu>
    </li>
  );
}

function RowMenu({
  label,
  open,
  onOpen,
  onClose,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const panelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('button')?.focus();
    panelRef.current?.scrollIntoView({ block: 'nearest' });
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCloseRef.current();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onPanelKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(panelRef.current?.querySelectorAll('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (buttons.length === 0) return;
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="icon-button row-menu"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? onClose() : onOpen())}
      >
        <MoreHorizontal size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="row-menu-panel"
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKey}
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
