import { connect, exactCredential, type PluginContext } from '@owox/plugin-sdk';
import { useEffect, useId, useState } from 'react';
import { formatBytes, runBigQueryPreview, type PreviewTable, type QueryOutcome } from './bigquery.ts';
import { describeError } from './errors.ts';
import { PREVIEW_LIMIT } from './sql.ts';
import { loadBigQueryStorages, type BigQueryStorageOption } from './storages.ts';

export default function App() {
  const [ctx, setCtx] = useState<PluginContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    connect()
      .then(next => {
        if (cancelled) return;
        document.documentElement.classList.toggle('dark', next.theme === 'dark');
        setCtx(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="dm-page">
        <header className="dm-page-header">
          <h1 className="dm-page-header-title">SQL-Console</h1>
        </header>
        <main className="dm-page-content">
          <section className="dm-card">
            <p className="banner" role="alert">
              {error}
            </p>
            <p className="dm-muted">Open SQL-Console from inside OWOX Data Marts.</p>
          </section>
        </main>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="dm-page">
        <header className="dm-page-header">
          <h1 className="dm-page-header-title">SQL-Console</h1>
        </header>
        <main className="dm-page-content">
          <p className="dm-muted">Opening SQL-Console…</p>
        </main>
      </div>
    );
  }

  return <Console ctx={ctx} />;
}

function Console({ ctx }: { ctx: PluginContext }) {
  const storageFieldId = useId();
  const sqlFieldId = useId();
  const [storages, setStorages] = useState<BigQueryStorageOption[]>([]);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [sql, setSql] = useState('SELECT 1 AS example');
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBigQueryStorages(ctx.owox)
      .then(items => {
        if (cancelled) return;
        setStorages(items);
        setSelectedId(items.find(item => item.available && item.gcpProjectId)?.id ?? '');
        setStorageState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStorageError(describeError(error));
        setStorageState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const selected = storages.find(item => item.id === selectedId) ?? null;
  const runDisabled =
    running ||
    !selected ||
    !selected.available ||
    !selected.gcpProjectId ||
    sql.trim().length === 0;

  async function onRun() {
    if (!selected?.gcpProjectId || runDisabled) return;
    const google = exactCredential(ctx.credentials, 'google-service-account');
    if (!google) {
      setOutcome({
        status: 'error',
        message:
          'Google Service Account access is not granted. Reinstall SQL-Console and select a Credential with BigQuery read access.',
      });
      return;
    }

    setRunning(true);
    setOutcome(null);
    try {
      setOutcome(
        await runBigQueryPreview({
          fetchImpl: google.asFetch(),
          projectId: selected.gcpProjectId,
          location: selected.location,
          sql,
          signal: ctx.signal,
        }),
      );
    } catch (error) {
      setOutcome({ status: 'error', message: describeError(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="dm-page">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">SQL-Console</h1>
        <p className="lede dm-muted">
          Run one read-only query on a BigQuery storage in this project. The preview returns at most{' '}
          {PREVIEW_LIMIT} rows.
        </p>
      </header>
      <main className="dm-page-content">
        <section className="dm-card">
          {storageState === 'loading' ? <p className="dm-muted">Loading storages…</p> : null}
          {storageState === 'error' ? (
            <p className="banner" role="alert">
              {storageError}
            </p>
          ) : null}
          {storageState === 'ready' && storages.length === 0 ? (
            <p>No BigQuery storages are available in this project.</p>
          ) : null}
          {storageState === 'ready' && storages.length > 0 ? (
            <div className="storage-row">
              <label className="field" htmlFor={storageFieldId}>
                <span>Storage</span>
                <select
                  id={storageFieldId}
                  value={selectedId}
                  onChange={event => {
                    setSelectedId(event.target.value);
                    setOutcome(null);
                  }}
                >
                  <option value="">Select a storage</option>
                  {storages.map(storage => (
                    <option key={storage.id} value={storage.id} disabled={!storage.available}>
                      {storage.title}
                      {storage.available ? '' : ' (unavailable)'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="meta dm-muted">
                {selected
                  ? `Project ${selected.gcpProjectId ?? 'unknown'} · Location ${selected.location ?? 'autodetect'}`
                  : 'Choose the storage whose project the query should run in.'}
              </p>
            </div>
          ) : null}

          <label className="field" htmlFor={sqlFieldId}>
            <span>SQL</span>
            <textarea
              id={sqlFieldId}
              value={sql}
              spellCheck={false}
              onChange={event => setSql(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !runDisabled) {
                  event.preventDefault();
                  void onRun();
                }
              }}
            />
          </label>
          <div className="actions">
            <button className="primary" type="button" disabled={runDisabled} onClick={() => void onRun()}>
              {running ? 'Running…' : 'Run query'}
            </button>
            <p className="dm-muted">One SELECT or WITH query. Ctrl+Enter or Cmd+Enter runs it.</p>
          </div>
          {selected && !selected.gcpProjectId ? (
            <p className="banner" role="alert">
              This storage has no BigQuery project id.
            </p>
          ) : null}
        </section>

        <section className="dm-card" aria-live="polite">
          <h2 className="dm-page-header-title">Preview</h2>
          {running ? <p className="dm-muted">Running the query…</p> : null}
          {!running && !outcome ? <p className="dm-muted">Results appear here.</p> : null}
          {outcome?.status === 'error' || outcome?.status === 'incomplete' ? (
            <p className="banner" role="alert">
              {outcome.message}
            </p>
          ) : null}
          {outcome?.status === 'ok' ? <ResultTable table={outcome.table} /> : null}
        </section>
      </main>
    </div>
  );
}

function ResultTable({ table }: { table: PreviewTable }) {
  const bytes = formatBytes(table.bytesProcessed);
  const shown = table.rows.length;
  const summary = [
    shown === 1 ? '1 row' : `${shown} rows`,
    bytes ? `${bytes} processed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (table.columns.length === 0) {
    return <p>Query finished and returned no columns.</p>;
  }

  return (
    <>
      <p className="dm-muted">{summary}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {table.columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length}>No rows</td>
              </tr>
            ) : (
              table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${table.columns[cellIndex] ?? cellIndex}-${rowIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
