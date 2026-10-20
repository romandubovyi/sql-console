import { connect, exactCredential, type PluginContext } from '@owox/plugin-sdk';
import { ChevronLeft, ChevronRight, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { QueryHistory } from './QueryHistory.tsx';
import { StorageFields } from './StorageFields.tsx';
import {
  emptyQuery,
  landingQuery,
  listAllQueries,
  normalizePreferences,
  PREFERENCES_COLLECTION,
  QUERIES_COLLECTION,
  queryIsDirty,
  toQueryItem,
  UNTITLED_QUERY,
  appendVersion,
  type PreferencesDocument,
  type QueryDocument,
  type QueryItem,
} from './queries.ts';
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

interface Draft {
  id: string;
  title: string;
  sql: string;
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
  const queriesRef = useRef<QueryItem[]>([]);
  const writeRef = useRef(Promise.resolve());
  const savedPreferences = useRef({ projectId: '', location: '' });
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [sidebarSize, setSidebarSize] = useState(260);
  const [editorSize, setEditorSize] = useState(320);
  const [dragging, setDragging] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [queryState, setQueryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState(UNTITLED_QUERY);
  const [sql, setSql] = useState('');
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('');
  const [storageOptions, setStorageOptions] = useState<readonly BigQueryStorageOption[]>([]);
  const [storageStatus, setStorageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageUnread, setStorageUnread] = useState(0);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [running, setRunning] = useState(false);
  const [paging, setPaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<ResultSession | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selected = queries.find(query => query.id === selectedId) ?? null;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const apply = () => setNarrow(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const queryCollection = ctx.collections<QueryDocument>(QUERIES_COLLECTION);
    const preferenceCollection = ctx.collections<PreferencesDocument>(PREFERENCES_COLLECTION);
    void (async () => {
      try {
        const [stored, preferences] = await Promise.all([
          listAllQueries(queryCollection),
          preferenceCollection.get('current'),
        ]);
        if (cancelled) return;
        const prefs = normalizePreferences(preferences?.document);
        savedPreferences.current = prefs;
        setProjectId(prefs.projectId);
        setLocation(prefs.location);
        setPreferencesReady(true);

        let items = stored.map(item => toQueryItem(item));
        let landing = landingQuery(items);
        if (!landing) {
          const created = await queryCollection.put(crypto.randomUUID(), emptyQuery());
          if (cancelled) return;
          landing = toQueryItem(created);
          items = [...items, landing];
        }
        queriesRef.current = items;
        setQueries(items);
        setSelectedId(landing.id);
        setTitle(landing.title);
        setSql(landing.sql);
        setQueryState('ready');
      } catch (cause) {
        if (cancelled) return;
        setQueryError(describeError(cause));
        setQueryState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, loadKey]);

  useEffect(() => {
    if (!preferencesReady) return;
    const next = { projectId: projectId.trim(), location: location.trim() };
    if (next.projectId === savedPreferences.current.projectId && next.location === savedPreferences.current.location) {
      return;
    }
    const handle = setTimeout(() => {
      void ctx
        .collections<PreferencesDocument>(PREFERENCES_COLLECTION)
        .put('current', next)
        .then(() => {
          savedPreferences.current = next;
        })
        .catch((cause: unknown) => setNotice({ message: describeError(cause) }));
    }, 600);
    return () => clearTimeout(handle);
  }, [ctx, location, preferencesReady, projectId]);

  useEffect(() => {
    document.getElementById(`query-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, queryState]);

  useEffect(() => {
    let cancelled = false;
    loadBigQueryStorages(ctx.owox)
      .then(catalog => {
        if (cancelled) return;
        setStorageOptions(catalog.options);
        setStorageUnread(catalog.unread);
        setStorageStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStorageStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const replaceQuery = useCallback((item: QueryItem) => {
    queriesRef.current = queriesRef.current.map(query => (query.id === item.id ? item : query));
    setQueries(queriesRef.current);
  }, []);

  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const run = writeRef.current.then(task, task);
    writeRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const persistDraft = useCallback(
    async (draft: Draft) => {
      const current = queriesRef.current.find(query => query.id === draft.id);
      if (!current) return;
      const nextTitle = draft.title.trim() || UNTITLED_QUERY;
      if (current.title === nextTitle && current.sql === draft.sql) return;
      const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(draft.id, {
        title: nextTitle,
        sql: draft.sql,
        versions: current.versions,
      });
      replaceQuery(toQueryItem(saved));
    },
    [ctx, replaceQuery],
  );

  useEffect(() => {
    if (queryState !== 'ready' || !selectedId) return;
    const draft = { id: selectedId, title, sql };
    const handle = setTimeout(() => {
      void enqueue(() => persistDraft(draft)).catch((cause: unknown) => {
        setNotice({ message: describeError(cause) });
      });
    }, 800);
    return () => clearTimeout(handle);
  }, [enqueue, persistDraft, queryState, selectedId, sql, title]);

  async function onSave() {
    const draft = { id: selectedId, title, sql };
    if (!draft.id) return;
    setSaving(true);
    try {
      await enqueue(async () => {
        const current = queriesRef.current.find(query => query.id === draft.id);
        if (!current) return;
        const nextTitle = draft.title.trim() || UNTITLED_QUERY;
        const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(draft.id, {
          title: nextTitle,
          sql: draft.sql,
          versions: appendVersion(current.versions, draft.sql, new Date().toISOString()),
        });
        const item = toQueryItem(saved);
        replaceQuery(item);
        if (draft.id === selectedId) setTitle(item.title);
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    } finally {
      setSaving(false);
    }
  }

  async function openQuery(id: string) {
    if (id === selectedId) return;
    const draft = { id: selectedId, title, sql };
    setDeleteArmedId(null);
    setHistoryOpen(false);
    try {
      await enqueue(async () => {
        await persistDraft(draft);
        const next = queriesRef.current.find(query => query.id === id);
        if (!next) return;
        setSelectedId(next.id);
        setTitle(next.title);
        setSql(next.sql);
        setSession(null);
        setNotice(null);
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  async function onCreate() {
    const draft = { id: selectedId, title, sql };
    setDeleteArmedId(null);
    setHistoryOpen(false);
    try {
      await enqueue(async () => {
        if (draft.id) await persistDraft(draft);
        const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(crypto.randomUUID(), emptyQuery());
        const item = toQueryItem(saved);
        queriesRef.current = [item, ...queriesRef.current];
        setQueries(queriesRef.current);
        setSelectedId(item.id);
        setTitle(item.title);
        setSql(item.sql);
        setSession(null);
        setNotice(null);
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  async function onDelete(id: string) {
    const draft = { id: selectedId, title, sql };
    setDeleteArmedId(null);
    try {
      await enqueue(async () => {
        if (draft.id && draft.id !== id) await persistDraft(draft);
        await ctx.collections<QueryDocument>(QUERIES_COLLECTION).delete(id);
        let items = queriesRef.current.filter(query => query.id !== id);
        if (items.length === 0) {
          const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(crypto.randomUUID(), emptyQuery());
          items = [toQueryItem(saved)];
        }
        queriesRef.current = items;
        setQueries(items);
        if (selectedId !== id) return;
        const next = landingQuery(items) ?? items[0];
        if (!next) return;
        setSelectedId(next.id);
        setTitle(next.title);
        setSql(next.sql);
        setSession(null);
        setHistoryOpen(false);
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  const trimmedProject = projectId.trim();
  const runDisabled = running || paging || !trimmedProject || sql.trim().length === 0 || queryState !== 'ready';
  const saveDisabled = saving || !selected || !queryIsDirty(selected, title, sql);

  async function onRun() {
    if (runDisabled) return;
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
        projectId: trimmedProject,
        location: location.trim() || null,
        sql,
        pageSize,
        signal: ctx.signal,
      });
      applyOutcome(outcome, {
        projectId: trimmedProject,
        location: location.trim() || null,
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
  const visibleQueries = [...queries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return (
    <div
      ref={shellRef}
      className={narrow ? 'shell narrow' : 'shell'}
      style={{ ['--sidebar-size' as string]: `${sidebarSize}px`, ['--editor-size' as string]: `${editorSize}px` }}
      data-dragging={dragging ? 'true' : undefined}
    >
      <aside className="sidebar" aria-label="Queries">
        <div className="sidebar-header">
          <strong>Queries</strong>
          <span className="toolbar-spacer" />
          <button className="icon-button" type="button" aria-label="New query" onClick={() => void onCreate()}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="sidebar-body">
          {queryState === 'loading' ? <p className="empty-note dm-muted">Loading queries…</p> : null}
          {queryState === 'error' ? (
            <>
              <p className="banner" role="alert">
                {queryError}
              </p>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  setQueryState('loading');
                  setLoadKey(key => key + 1);
                }}
              >
                Retry
              </button>
            </>
          ) : null}
          {queryState === 'ready' ? (
            <ul className="storage-list">
              {visibleQueries.map(query => (
                <li key={query.id} className="query-row" id={`query-${query.id}`}>
                  <button
                    type="button"
                    className="storage-item"
                    aria-current={query.id === selectedId ? 'true' : undefined}
                    onClick={() => void openQuery(query.id)}
                  >
                    <span className="storage-title">{query.title}</span>
                    <span className="storage-meta">
                      {query.versions.length === 1 ? '1 version' : `${query.versions.length} versions`}
                    </span>
                  </button>
                  {deleteArmedId === query.id ? (
                    <button className="danger-text" type="button" onClick={() => void onDelete(query.id)}>
                      Delete
                    </button>
                  ) : (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Delete ${query.title}`}
                      onClick={() => setDeleteArmedId(query.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>

      <Splitter
        orientation={narrow ? 'horizontal' : 'vertical'}
        label="Resize queries"
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
            <input
              className="title-input"
              aria-label="Query name"
              value={title}
              disabled={queryState !== 'ready'}
              onChange={event => setTitle(event.target.value)}
            />
            <button className="ghost" type="button" disabled={saveDisabled} onClick={() => void onSave()}>
              <Save size={14} aria-hidden="true" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="primary" type="button" disabled={runDisabled} onClick={() => void onRun()}>
              <Play size={14} aria-hidden="true" />
              {running ? 'Running…' : 'Run'}
            </button>
            <StorageFields
              projectId={projectId}
              location={location}
              options={storageOptions}
              status={storageStatus}
              unread={storageUnread}
              onProjectId={setProjectId}
              onLocation={setLocation}
            />
            <span className="toolbar-spacer" />
            <span className="dm-muted">Ctrl+Enter or Cmd+Enter</span>
          </div>
          <QueryHistory
            versions={selected?.versions ?? []}
            open={historyOpen}
            onToggle={() => setHistoryOpen(open => !open)}
            onUseVersion={nextSql => {
              setSql(nextSql);
              setHistoryOpen(false);
            }}
          />
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
              {session ? `Page ${session.pageIndex + 1}${pages ? ` of ${pages}` : ''}` : 'Page'}
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
            {!trimmedProject && queryState === 'ready' ? (
              <p className="empty-note">
                Choose a BigQuery storage from Project or Location, or type the GCP project id. Jobs run in that
                project.
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
