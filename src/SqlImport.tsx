import { FileInput, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { describeError } from './errors.ts';
import type { SqlOrigin } from './queries.ts';
import {
  dataMartOrigin,
  loadImportCatalog,
  readDataMartSql,
  readReportSql,
  replaceDataMartSql,
  reportOrigin,
  type ImportCatalog,
  type ImportClient,
  type ImportMartChoice,
  type ImportReportChoice,
} from './sql-import.ts';

interface SqlImportProps {
  sql: string;
  origin: SqlOrigin | null;
  disabled: boolean;
  client: ImportClient;
  onImport: (sql: string, origin: SqlOrigin) => void;
  onUpdated: (message: string) => void;
}

type PendingImport = { sql: string; origin: SqlOrigin; label: string };

export function SqlImport({ sql, origin, disabled, client, onImport, onUpdated }: SqlImportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [catalog, setCatalog] = useState<ImportCatalog>({ marts: [], reports: [] });
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadImportCatalog(client)
      .then(next => {
        if (cancelled) return;
        setCatalog(next);
        setPhase('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describeError(cause));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client, open, reload]);

  useEffect(() => {
    if (!open && !confirmUpdate) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      if (busy) return;
      setOpen(false);
      setConfirmUpdate(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setOpen(false);
      setConfirmUpdate(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [busy, confirmUpdate, open]);

  function toggle() {
    if (disabled || busy) return;
    if (open) {
      setOpen(false);
      return;
    }
    setConfirmUpdate(false);
    setPending(null);
    setError(null);
    setFilter('');
    setPhase('loading');
    setOpen(true);
  }

  async function chooseMart(choice: ImportMartChoice) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextSql = await readDataMartSql(client, choice.id);
      const nextOrigin = dataMartOrigin(choice);
      if (sql.trim() !== '' && sql !== nextSql) {
        setPending({ sql: nextSql, origin: nextOrigin, label: choice.title });
        return;
      }
      onImport(nextSql, nextOrigin);
      setOpen(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function chooseReport(choice: ImportReportChoice) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const nextSql = await readReportSql(client, choice.id);
      const nextOrigin = reportOrigin(choice);
      if (sql.trim() !== '' && sql !== nextSql) {
        setPending({ sql: nextSql, origin: nextOrigin, label: choice.title });
        return;
      }
      onImport(nextSql, nextOrigin);
      setOpen(false);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function applyPending() {
    if (!pending) return;
    onImport(pending.sql, pending.origin);
    setPending(null);
    setOpen(false);
  }

  async function updateMart() {
    if (busy || origin?.kind !== 'data-mart' || sql.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await replaceDataMartSql(client, origin.dataMartId, sql);
      setConfirmUpdate(false);
      onUpdated(`Updated the SQL on “${origin.title}”.`);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const marts = catalog.marts.filter(choice => choice.title.toLowerCase().includes(needle));
  const reports = catalog.reports.filter(choice =>
    `${choice.title} ${choice.dataMartTitle}`.toLowerCase().includes(needle),
  );
  const empty = phase === 'ready' && catalog.marts.length === 0 && catalog.reports.length === 0;

  return (
    <div className="mart" ref={rootRef}>
      <button
        className="ghost tool"
        type="button"
        aria-label="Import SQL"
        title={origin ? `Import SQL. This query is from ${origin.title}` : 'Import SQL'}
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        <FileInput size={14} aria-hidden="true" />
      </button>
      {origin?.kind === 'data-mart' ? (
        <button
          className="ghost tool"
          type="button"
          aria-label={`Update data mart ${origin.title}`}
          disabled={disabled || sql.trim() === '' || busy}
          title={`Update the SQL on ${origin.title}`}
          onClick={() => {
            setOpen(false);
            setError(null);
            setConfirmUpdate(true);
          }}
        >
          <Upload size={14} aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <div className="mart-panel import-panel" id="import-sql" role="dialog" aria-label="Import SQL">
          <p className="mart-lead">
            Choose a SQL data mart, or a report. A report inserts the SQL that report will run.
          </p>
          {phase === 'loading' ? <p className="history-note">Loading data marts and reports…</p> : null}
          {phase === 'error' && error ? (
            <>
              <p className="banner" role="alert">
                {error}
              </p>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setError(null);
                  setPhase('loading');
                  setReload(current => current + 1);
                }}
              >
                Retry
              </button>
            </>
          ) : null}
          {phase === 'ready' && !pending ? (
            <>
              <input
                aria-label="Filter data marts and reports"
                placeholder="Filter"
                value={filter}
                onChange={event => setFilter(event.target.value)}
              />
              {empty ? <p className="history-note">No SQL data marts or reports are available.</p> : null}
              {!empty && marts.length === 0 && reports.length === 0 ? (
                <p className="history-note">Nothing matches.</p>
              ) : null}
              {marts.length > 0 ? (
                <div className="import-group">
                  <h3>SQL data marts</h3>
                  <div className="import-list">
                    {marts.map(choice => (
                      <button key={choice.id} type="button" disabled={busy} onClick={() => void chooseMart(choice)}>
                        {choice.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {reports.length > 0 ? (
                <div className="import-group">
                  <h3>Reports</h3>
                  <div className="import-list">
                    {reports.map(choice => (
                      <button key={choice.id} type="button" disabled={busy} onClick={() => void chooseReport(choice)}>
                        <span>{choice.title}</span>
                        <span className="dm-muted">{choice.dataMartTitle}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {error ? (
                <p className="banner" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
          {pending ? (
            <>
              <p className="mart-lead">Replace the SQL in the editor with “{pending.label}”?</p>
              <div className="mart-actions">
                <button className="ghost" type="button" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </button>
                <button className="primary" type="button" disabled={busy} onClick={applyPending}>
                  Replace
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {confirmUpdate && origin?.kind === 'data-mart' ? (
        <div className="mart-panel" role="dialog" aria-label="Update data mart">
          <p className="mart-lead">
            This replaces the SQL on “{origin.title}”. Reports that use this data mart will run the new query.
          </p>
          {error ? (
            <p className="banner" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mart-actions">
            <button className="ghost" type="button" disabled={busy} onClick={() => setConfirmUpdate(false)}>
              Cancel
            </button>
            <button className="primary" type="button" disabled={busy || sql.trim() === ''} onClick={() => void updateMart()}>
              {busy ? 'Updating…' : 'Replace SQL'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
