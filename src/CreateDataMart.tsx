import { Database } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { storageSuggestionDetail, type BigQueryStorageOption } from './storages.ts';

interface CreateDataMartProps {
  queryTitle: string;
  sql: string;
  storages: readonly BigQueryStorageOption[];
  storageStatus: 'loading' | 'ready' | 'error';
  creating: boolean;
  error: string | null;
  onCreate: (input: { title: string; storageId: string }) => void;
  onOpenCreated: () => void;
  createdId: string | null;
}

export function CreateDataMart({
  queryTitle,
  sql,
  storages,
  storageStatus,
  creating,
  error,
  onCreate,
  onOpenCreated,
  createdId,
}: CreateDataMartProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(queryTitle);
  const [storageId, setStorageId] = useState('');
  const sqlReady = sql.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      if (!creating) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [creating, open]);

  function toggle() {
    setOpen(current => {
      const next = !current;
      if (next) {
        setTitle(queryTitle.trim() || 'Untitled query');
        setStorageId('');
      }
      return next;
    });
  }

  return (
    <div className="mart" ref={rootRef}>
      <button
        className="ghost"
        type="button"
        aria-expanded={open}
        aria-controls="create-data-mart"
        disabled={!sqlReady}
        onClick={toggle}
      >
        <Database size={14} aria-hidden="true" />
        Create data mart
      </button>
      {open ? (
        <form
          className="mart-panel"
          id="create-data-mart"
          onSubmit={event => {
            event.preventDefault();
            if (!storageId || creating) return;
            onCreate({ title, storageId });
          }}
        >
          <p className="mart-lead">Create a SQL data mart with this query.</p>
          <label>
            Title
            <input aria-label="Data mart title" value={title} disabled={creating} onChange={event => setTitle(event.target.value)} />
          </label>
          <label>
            Storage
            <select
              aria-label="Data mart storage"
              value={storageId}
              disabled={creating || storageStatus !== 'ready'}
              onChange={event => setStorageId(event.target.value)}
            >
              <option value="">Select a storage</option>
              {storages.map(storage => (
                <option key={storage.id} value={storage.id}>
                  {storage.title} · {storageSuggestionDetail(storage)}
                </option>
              ))}
            </select>
          </label>
          {storageStatus === 'loading' ? <p className="history-note">Loading storages…</p> : null}
          {storageStatus === 'error' ? <p className="history-note">Storages could not be loaded.</p> : null}
          {storageStatus === 'ready' && storages.length === 0 ? (
            <p className="history-note">No BigQuery storage is available.</p>
          ) : null}
          {error ? (
            <p className="banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mart-actions">
            {createdId ? (
              <button className="ghost" type="button" onClick={onOpenCreated}>
                Open data mart
              </button>
            ) : null}
            <button className="primary" type="submit" disabled={creating || !storageId || title.trim() === ''}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
