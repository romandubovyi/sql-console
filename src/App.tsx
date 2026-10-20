import { connect, exactCredential, type PluginContext } from '@owox/plugin-sdk';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  fetchResultPage,
  formatBytes,
  runBigQueryPreview,
  type QueryOutcome,
} from './bigquery.ts';
import { describeError } from './errors.ts';
import {
  canGoNext,
  DEFAULT_PAGE_SIZE,
  formatRowRange,
  isPageSize,
  pageCount,
  PAGE_SIZES,
  type PageSize,
} from './paging.ts';
import { SqlEditor } from './SqlEditor.tsx';
import { loadBigQueryStorages, type BigQueryStorageOption } from './storages.ts';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const EDITOR_MIN = 160;
const PANE_MIN = 140;

interface ResultSession {
  columns: string[];
  rows: string[][];
  totalRows: number | null;
  bytesProcessed: string | null;
  jobId: string | null;
  location: string | null;
  projectId: string;
  pageIndex: number;
  pageSize: PageSize;
}

interface Notice {
  message: string;
}

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
      <main className="setup">
        <h1>SQL-Console</h1>
        <p className="banner" role="alert">
          {error}
        </p>
        <p className="dm-muted">Open SQL-Console from inside OWOX Data Marts.</p>
      </main>
    );
  }

  if (!ctx) {
    return (
      <main className="setup">
        <h1>SQL-Console</h1>
        <p className="dm-muted">Opening SQL-Console…</p>
      </main>
    );
  }

  return <Console ctx={ctx} />;
}

function Console({ ctx }: { ctx: PluginContext }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [sidebarSize, setSidebarSize] = useState(260);
  const [editorSize, setEditorSize] = useState(320);
  const [dragging, setDragging] = useState(false);
  const [storages, setStorages] = useState<BigQueryStorageOption[]>([]);
  const [storageState, setStorageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [sql, setSql] = useState('SELECT 1 AS example');
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [running, setRunning] = useState(false);
  const [paging, setPaging] = useState(false);
  const [session, setSession] = useState<ResultSession | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const apply = () => setNarrow(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadBigQueryStorages(ctx.owox)
      .then(items => {
        if (cancelled) return;
        setStorages(items);
        setSelectedId(items.find(item => item.available && item.gcpProjectId)?.id ?? '');
        setStorageState('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStorageError(describeError(cause));
        setStorageState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const selected = storages.find(item => item.id === selectedId) ?? null;
  const runDisabled =
    running || paging || !selected?.available || !selected.gcpProjectId || sql.trim().length === 0;

  async function onRun() {
    if (!selected?.gcpProjectId || runDisabled) return;
    const fetchImpl = credentialFetch(ctx);
    if (!fetchImpl) {
      setSession(null);
      setNotice({
        message:
          'Google Service Account access is not granted. Reinstall SQL-Console and select a Credential with BigQuery read access.',
      });
      return;
    }

    setRunning(true);
    setNotice(null);
    setSession(null);
    try {
      const outcome = await runBigQueryPreview({
        fetchImpl,
        projectId: selected.gcpProjectId,
        location: selected.location,
        sql,
        pageSize,
        signal: ctx.signal,
      });
      applyOutcome(outcome, {
        projectId: selected.gcpProjectId,
        location: selected.location,
        pageIndex: 0,
        pageSize,
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    } finally {
      setRunning(false);
    }
  }

  function applyOutcome(
    outcome: QueryOutcome,
    page: { projectId: string; location: string | null; pageIndex: number; pageSize: PageSize },
  ) {
    if (outcome.status !== 'ok') {
      setNotice({ message: outcome.message });
      return;
    }
    const table = outcome.table;
    setNotice(null);
    setSession({
      columns: table.columns,
      rows: table.rows,
      totalRows: table.totalRows,
      bytesProcessed: table.bytesProcessed,
      jobId: table.jobId,
      location: table.location ?? page.location,
      projectId: page.projectId,
      pageIndex: page.pageIndex,
      pageSize: page.pageSize,
    });
  }

  async function showPage(nextIndex: number, nextSize: PageSize) {
    const jobId = session?.jobId;
    if (!session || !jobId || running || paging) return;
    const fetchImpl = credentialFetch(ctx);
    if (!fetchImpl) return;
    const current = session;
    setPaging(true);
    setNotice(null);
    try {
      const outcome = await fetchResultPage({
        fetchImpl,
        projectId: current.projectId,
        jobId,
        location: current.location,
        startIndex: nextIndex * nextSize,
        pageSize: nextSize,
        signal: ctx.signal,
      });
      if (outcome.status !== 'ok') {
        setNotice({ message: outcome.message });
        return;
      }
      if (outcome.table.rows.length === 0 && nextIndex > 0) {
        setSession({
          ...current,
          totalRows: current.pageIndex * current.pageSize + current.rows.length,
        });
        return;
      }
      setSession({
        ...current,
        columns: outcome.table.columns.length > 0 ? outcome.table.columns : current.columns,
        rows: outcome.table.rows,
        totalRows: outcome.table.totalRows ?? current.totalRows,
        bytesProcessed: outcome.table.bytesProcessed ?? current.bytesProcessed,
        pageIndex: nextIndex,
        pageSize: nextSize,
      });
      setPageSize(nextSize);
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    } finally {
      setPaging(false);
    }
  }

  const pages = session ? pageCount(session.totalRows, session.pageSize) : null;
  const nextEnabled = Boolean(
    session?.jobId &&
      !running &&
      !paging &&
      canGoNext(session.pageIndex, session.pageSize, session.totalRows, session.rows.length),
  );
  const bytes = formatBytes(session?.bytesProcessed ?? null);

  return (
    <div
      ref={shellRef}
      className={narrow ? 'shell narrow' : 'shell'}
      style={{ ['--sidebar-size' as string]: `${sidebarSize}px`, ['--editor-size' as string]: `${editorSize}px` }}
      data-dragging={dragging ? 'true' : undefined}
    >
      <aside className="sidebar" aria-label="Storages">
        <div className="sidebar-header">
          <strong>Storages</strong>
        </div>
        <div className="sidebar-body">
          {storageState === 'loading' ? <p className="empty-note dm-muted">Loading storages…</p> : null}
          {storageState === 'error' ? (
            <p className="banner" role="alert">
              {storageError}
            </p>
          ) : null}
          {storageState === 'ready' && storages.length === 0 ? (
            <p className="empty-note">No BigQuery storages are available in this project.</p>
          ) : null}
          {storageState === 'ready' && storages.length > 0 ? (
            <ul className="storage-list">
              {storages.map(storage => (
                <li key={storage.id}>
                  <button
                    type="button"
                    className="storage-item"
                    aria-current={storage.id === selectedId ? 'true' : undefined}
                    disabled={!storage.available}
                    onClick={() => {
                      setSelectedId(storage.id);
                      setSession(null);
                      setNotice(null);
                    }}
                  >
                    <span className="storage-title">
                      {storage.title}
                      {storage.available ? '' : ' (unavailable)'}
                    </span>
                    <span className="storage-meta">
                      {storage.gcpProjectId ?? 'No project id'} · {storage.location ?? 'autodetect'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>

      <Splitter
        orientation={narrow ? 'horizontal' : 'vertical'}
        label="Resize storages"
        value={sidebarSize}
        min={SIDEBAR_MIN}
        max={SIDEBAR_MAX}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
        onResize={next => setSidebarSize(clamp(next, SIDEBAR_MIN, sidebarMax(shellRef.current, narrow)))}
      />

      <div ref={mainRef} className="main-column">
        <section className="editor-pane" aria-label="SQL editor">
          <div className="pane-toolbar">
            <span className="pane-title">SQL</span>
            <button className="primary" type="button" disabled={runDisabled} onClick={() => void onRun()}>
              <Play size={14} aria-hidden="true" />
              {running ? 'Running…' : 'Run'}
            </button>
            <span className="dm-muted">{selected ? selected.title : 'Select a storage'}</span>
            <span className="toolbar-spacer" />
            <span className="dm-muted">Ctrl+Enter or Cmd+Enter</span>
          </div>
          <div className="editor-body">
            <SqlEditor value={sql} theme={ctx.theme} onChange={setSql} onRun={() => void onRun()} />
          </div>
        </section>

        <Splitter
          orientation="horizontal"
          label="Resize editor and preview"
          value={editorSize}
          min={EDITOR_MIN}
          max={1200}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => setDragging(false)}
          onResize={next => setEditorSize(clamp(next, EDITOR_MIN, editorMax(mainRef.current)))}
        />

        <section
          className={paging ? 'preview-pane is-paging' : 'preview-pane'}
          aria-label="Query preview"
          aria-live="polite"
        >
          <div className="pane-toolbar">
            <span className="pane-title">Preview</span>
            <label className="page-size">
              Rows
              <select
                value={session?.pageSize ?? pageSize}
                disabled={running || paging}
                onChange={event => {
                  const next = Number(event.target.value);
                  if (!isPageSize(next)) return;
                  if (session?.jobId) {
                    void showPage(0, next);
                    return;
                  }
                  setPageSize(next);
                }}
              >
                {PAGE_SIZES.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="ghost"
              type="button"
              aria-label="Previous page"
              disabled={!session || session.pageIndex === 0 || running || paging}
              onClick={() => {
                if (session) void showPage(session.pageIndex - 1, session.pageSize);
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="dm-muted">
              {session
                ? `Page ${session.pageIndex + 1}${pages ? ` of ${pages}` : ''}`
                : 'Page'}
            </span>
            <button
              className="ghost"
              type="button"
              aria-label="Next page"
              disabled={!nextEnabled}
              onClick={() => {
                if (session) void showPage(session.pageIndex + 1, session.pageSize);
              }}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <span className="toolbar-spacer" />
            <span className="dm-muted">
              {session
                ? [formatRowRange(session.pageIndex, session.pageSize, session.rows.length, session.totalRows), bytes ? `${bytes} processed` : null]
                    .filter(Boolean)
                    .join(' · ')
                : running
                  ? 'Running the query…'
                  : 'Results appear here'}
            </span>
          </div>
          <div className="preview-body">
            {notice ? (
              <p className="banner" role="alert">
                {notice.message}
              </p>
            ) : null}
            {selected && !selected.gcpProjectId ? (
              <p className="banner" role="alert">
                This storage has no BigQuery project id.
              </p>
            ) : null}
            {session && session.columns.length === 0 ? <p className="empty-note">Query finished and returned no columns.</p> : null}
            {session && session.columns.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {session.columns.map((column, index) => (
                        <th key={`${column}-${index}`} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {session.rows.length === 0 ? (
                      <tr>
                        <td colSpan={session.columns.length}>No rows</td>
                      </tr>
                    ) : (
                      session.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={`${session.columns[cellIndex] ?? cellIndex}-${rowIndex}`}>{cell}</td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Splitter({
  orientation,
  label,
  value,
  min,
  max,
  onResize,
  onDragStart,
  onDragEnd,
}: {
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  onResize: (next: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const axis = orientation === 'vertical' ? 'x' : 'y';

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      className={orientation === 'vertical' ? 'splitter vertical' : 'splitter horizontal'}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const start = axis === 'x' ? event.clientX : event.clientY;
        const startSize = value;
        handle.setPointerCapture(event.pointerId);
        onDragStart();
        const move = (ev: PointerEvent) => {
          const delta = (axis === 'x' ? ev.clientX : ev.clientY) - start;
          onResize(startSize + delta);
        };
        const end = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          onDragEnd();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      }}
      onKeyDown={event => {
        const step = event.shiftKey ? 32 : 16;
        const larger = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
        const smaller = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
        if (event.key === larger) onResize(value + step);
        if (event.key === smaller) onResize(value - step);
      }}
    />
  );
}

function credentialFetch(ctx: PluginContext): typeof fetch | null {
  const google = exactCredential(ctx.credentials, 'google-service-account');
  return google ? google.asFetch() : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sidebarMax(shell: HTMLDivElement | null, narrow: boolean): number {
  if (!shell) return SIDEBAR_MAX;
  const limit = narrow ? shell.clientHeight - 220 : shell.clientWidth - 320;
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, limit));
}

function editorMax(main: HTMLDivElement | null): number {
  if (!main) return 800;
  return Math.max(EDITOR_MIN, main.clientHeight - PANE_MIN);
}
