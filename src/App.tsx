import { connect, exactCredential, type PluginContext } from '@owox/plugin-sdk';
import { Check, ChevronLeft, ChevronRight, Download, FolderPlus, Play, Plus, Save } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  fetchResultPage,
  formatBytes,
  runBigQueryPreview,
  type QueryOutcome,
} from './bigquery.ts';
import { csvFilename, downloadTextFile, toCsv } from './csv.ts';
import { GOOGLE_SERVICE_ACCOUNT, loadJobUserEmail, loadServiceAccountEmail } from './credential.ts';
import { CreateDataMart } from './CreateDataMart.tsx';
import { SqlImport } from './SqlImport.tsx';
import { ExportPanel } from './ExportPanel.tsx';
import { sameExportTarget, type ExportTarget } from './export-target.ts';
import { createSqlDataMart, dataMartPath } from './data-mart.ts';
import { loadSqlSources, type SqlSource } from './sources.ts';
import { describeError } from './errors.ts';
import {
  createFolder,
  folderIdFor,
  MAX_FOLDERS,
  moveQuery,
  pruneFolders,
  removeFolder,
  renameFolder,
  revealQuery,
  toggleFolder,
  type QueryFolder,
} from './folders.ts';
import { Hint } from './Hint.tsx';
import {
  canGoNext,
  DEFAULT_PAGE_SIZE,
  formatRowRange,
  isPageSize,
  pageCount,
  PAGE_SIZES,
  type PageSize,
} from './paging.ts';
import { MarkdownEditor } from './MarkdownEditor.tsx';
import { QueryDryRun } from './QueryDryRun.tsx';
import { QueryHistory, VersionDiff } from './QueryHistory.tsx';
import { QueryTree } from './QueryTree.tsx';
import { QuerySettings } from './QuerySettings.tsx';
import { Welcome } from './Welcome.tsx';
import {
  appendVersion,
  compareWithPrevious,
  DEFAULT_EDITOR_SIZE,
  DEFAULT_SIDEBAR_SIZE,
  EDITOR_MAX,
  EDITOR_MIN,
  emptyQuery,
  formatVersionTime,
  initialVersionPick,
  isBlankQuery,
  lastRunExpiredMessage,
  MAX_DESCRIPTION,
  listAllQueries,
  normalizeLayout,
  normalizePreferences,
  PREFERENCES_COLLECTION,
  QUERIES_COLLECTION,
  queryIsDirty,
  resumeQuery,
  sameLayout,
  sameSqlOrigin,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  storedQuery,
  toQueryItem,
  UNTITLED_QUERY,
  type LayoutSizes,
  type PreferencesDocument,
  type QueryDocument,
  type QueryItem,
  type SheetSchedule,
  type SqlOrigin,
} from './queries.ts';
import { deleteExportSchedule } from './schedule.ts';
import { SqlEditor } from './SqlEditor.tsx';
import { loadBigQueryStorages, type BigQueryStorageOption } from './storages.ts';

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
  description: string;
  exportTarget: ExportTarget | null;
  sqlOrigin: SqlOrigin | null;
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
  const savedPreferences = useRef<PreferencesDocument>({
    projectId: '',
    location: '',
    folders: [],
    layout: normalizeLayout(null),
  });
  const layoutLive = useRef<LayoutSizes>(normalizeLayout(null));
  const draggingRef = useRef(false);
  const preferenceWrite = useRef(Promise.resolve());
  const shownRun = useRef(0);
  const sessionRef = useRef<ResultSession | null>(null);
  const pageSizeRef = useRef<PageSize>(DEFAULT_PAGE_SIZE);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [sidebarSize, setSidebarSize] = useState(DEFAULT_SIDEBAR_SIZE);
  const [stackSize, setStackSize] = useState(DEFAULT_SIDEBAR_SIZE);
  const [editorSize, setEditorSize] = useState(DEFAULT_EDITOR_SIZE);
  const [dragging, setDragging] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const [queryState, setQueryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queries, setQueries] = useState<QueryItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [title, setTitle] = useState(UNTITLED_QUERY);
  const [sql, setSql] = useState('');
  const [description, setDescription] = useState('');
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const [editorMode, setEditorMode] = useState<'sql' | 'description'>('sql');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPick, setHistoryPick] = useState<{ signature: string; base: number | null; head: number }>({
    signature: '',
    base: null,
    head: 0,
  });
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('');
  const [storageOptions, setStorageOptions] = useState<readonly BigQueryStorageOption[]>([]);
  const [storageStatus, setStorageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageUnread, setStorageUnread] = useState(0);
  const [sqlSources, setSqlSources] = useState<readonly SqlSource[]>([]);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [folders, setFolders] = useState<QueryFolder[]>([]);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [paging, setPaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingMart, setCreatingMart] = useState(false);
  const [martError, setMartError] = useState<string | null>(null);
  const [createdMartId, setCreatedMartId] = useState<string | null>(null);
  const [sqlOrigin, setSqlOrigin] = useState<SqlOrigin | null>(null);
  const [session, setSession] = useState<ResultSession | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selected = queries.find(query => query.id === selectedId) ?? null;
  const versionCount = selected?.versions.length ?? 0;
  const versionSignature = (selected?.versions ?? []).map(version => `${version.savedAt}\n${version.sql}`).join('\n--\n');
  const versionPick =
    historyPick.signature === versionSignature
      ? historyPick
      : { signature: versionSignature, ...initialVersionPick(versionCount) };
  if (historyPick.signature !== versionSignature) setHistoryPick(versionPick);

  function selectVersion(index: number) {
    setHistoryPick(current => ({ ...current, ...compareWithPrevious(index, versionCount) }));
  }

  function showQuery(item: QueryItem) {
    shownRun.current += 1;
    setRestoring(false);
    setSelectedId(item.id);
    setTitle(item.title);
    setSql(item.sql);
    setDescription(item.description);
    setExportTarget(item.exportTarget);
    setSqlOrigin(item.sqlOrigin);
    setEditorMode('sql');
    setSession(null);
    setHistoryOpen(false);
    setNotice(null);
  }

  function showWelcome() {
    shownRun.current += 1;
    setRestoring(false);
    setSelectedId('');
    setTitle('');
    setSql('');
    setDescription('');
    setExportTarget(null);
    setSqlOrigin(null);
    setEditorMode('sql');
    setSession(null);
    setHistoryOpen(false);
    setNotice(null);
  }

  const persistPreferences = useCallback((next: PreferencesDocument) => {
    savedPreferences.current = next;
    setFolders(next.folders);
    const run = preferenceWrite.current.then(() =>
      ctx.collections<PreferencesDocument>(PREFERENCES_COLLECTION).put('current', savedPreferences.current),
    );
    preferenceWrite.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, [ctx]);

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
        setProjectId(prefs.projectId);
        setLocation(prefs.location);

        let items = stored.map(item => toQueryItem(item));
        const blanks = items.filter(isBlankQuery);
        if (blanks.length > 0) {
          const removed = new Set<string>();
          for (let index = 0; index < blanks.length; index += 8) {
            await Promise.all(
              blanks.slice(index, index + 8).map(async blank => {
                try {
                  await queryCollection.delete(blank.id);
                  removed.add(blank.id);
                } catch {
                  // A shell that cannot be deleted stays out of the list until a later visit.
                }
              }),
            );
            if (cancelled) return;
          }
          items = items.filter(item => !removed.has(item.id));
        }
        queriesRef.current = items;
        setQueries(items);
        const landing = resumeQuery(items);
        const kept = revealQuery(pruneFolders(prefs.folders, new Set(items.map(item => item.id))), landing?.id ?? '');
        savedPreferences.current = { ...prefs, folders: kept };
        layoutLive.current = savedPreferences.current.layout;
        setFolders(kept);
        setPreferencesReady(true);
        if (kept !== prefs.folders) await persistPreferences(savedPreferences.current);
        if (landing) {
          setSelectedId(landing.id);
          setTitle(landing.title);
          setSql(landing.sql);
          setDescription(landing.description);
          setExportTarget(landing.exportTarget);
          setSqlOrigin(landing.sqlOrigin);
        } else {
          setSelectedId('');
          setTitle('');
          setSql('');
          setDescription('');
          setExportTarget(null);
          setSqlOrigin(null);
        }
        setEditorMode('sql');
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
  }, [ctx, loadKey, persistPreferences]);

  useLayoutEffect(() => {
    if (!preferencesReady) return;
    const apply = () => {
      if (draggingRef.current) return;
      const layout = savedPreferences.current.layout;
      setSidebarSize(clamp(layout.sidebar, SIDEBAR_MIN, sidebarMax(shellRef.current, false)));
      setStackSize(clamp(layout.stack, SIDEBAR_MIN, sidebarMax(shellRef.current, true)));
      setEditorSize(clamp(layout.editor, EDITOR_MIN, editorMax(mainRef.current)));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [narrow, preferencesReady]);

  function commitLayout() {
    const layout = normalizeLayout(layoutLive.current);
    layoutLive.current = layout;
    if (sameLayout(layout, savedPreferences.current.layout)) return;
    void persistPreferences({ ...savedPreferences.current, layout }).catch((cause: unknown) =>
      setNotice({ message: describeError(cause) }),
    );
  }

  useEffect(() => {
    if (!preferencesReady) return;
    const project = projectId.trim();
    const place = location.trim();
    if (project === savedPreferences.current.projectId && place === savedPreferences.current.location) return;
    const handle = setTimeout(() => {
      void persistPreferences({
        ...savedPreferences.current,
        projectId: project,
        location: place,
      }).catch((cause: unknown) => setNotice({ message: describeError(cause) }));
    }, 600);
    return () => clearTimeout(handle);
  }, [location, persistPreferences, preferencesReady, projectId]);

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

  useEffect(() => {
    let cancelled = false;
    loadSqlSources(ctx.owox)
      .then(sources => {
        if (!cancelled) setSqlSources(sources);
      })
      .catch(() => {
        if (!cancelled) setSqlSources([]);
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

  const readKept = useCallback(async (id: string): Promise<QueryItem | null> => {
    const stored = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).get(id);
    return stored ? toQueryItem(stored) : null;
  }, [ctx]);

  const persistDraft = useCallback(
    async (draft: Draft) => {
      const current = queriesRef.current.find(query => query.id === draft.id);
      if (!current) return;
      const kept = await readKept(draft.id);
      if (!kept) return;
      const next = storedQuery(
        {
          ...draft,
          lastRun: kept.lastRun,
          sheetSchedule: kept.sheetSchedule,
          scheduledExport: kept.scheduledExport,
          sqlOrigin: draft.sqlOrigin,
        },
        kept.versions,
      );
      if (
        kept.title === next.title &&
        kept.sql === next.sql &&
        kept.description === next.description &&
        sameExportTarget(kept.exportTarget, next.exportTarget) &&
        sameSqlOrigin(kept.sqlOrigin, next.sqlOrigin) &&
        JSON.stringify(kept.lastRun) === JSON.stringify(next.lastRun) &&
        JSON.stringify(kept.sheetSchedule) === JSON.stringify(next.sheetSchedule) &&
        JSON.stringify(kept.scheduledExport) === JSON.stringify(next.scheduledExport)
      ) {
        return;
      }
      const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(draft.id, next);
      replaceQuery(toQueryItem(saved));
    },
    [ctx, readKept, replaceQuery],
  );

  useEffect(() => {
    if (queryState !== 'ready' || !selectedId) return;
    const draft = { id: selectedId, title, sql, description, exportTarget, sqlOrigin };
    const handle = setTimeout(() => {
      void enqueue(() => persistDraft(draft)).catch((cause: unknown) => {
        setNotice({ message: describeError(cause) });
      });
    }, 800);
    return () => clearTimeout(handle);
  }, [description, enqueue, exportTarget, persistDraft, queryState, selectedId, sql, sqlOrigin, title]);

  async function onSave() {
    const draft = { id: selectedId, title, sql, description, exportTarget, sqlOrigin };
    if (!draft.id) return;
    setSaving(true);
    try {
      await enqueue(async () => {
        const current = queriesRef.current.find(query => query.id === draft.id);
        if (!current) return;
        const kept = (await readKept(draft.id)) ?? current;
        const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(
          draft.id,
          storedQuery(
            {
              ...draft,
              lastRun: kept.lastRun,
              sheetSchedule: kept.sheetSchedule,
              scheduledExport: kept.scheduledExport,
              sqlOrigin: draft.sqlOrigin,
            },
            appendVersion(kept.versions, draft.sql, new Date().toISOString()),
          ),
        );
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
    const draft = { id: selectedId, title, sql, description, exportTarget, sqlOrigin };
    try {
      await enqueue(async () => {
        await persistDraft(draft);
        const next = queriesRef.current.find(query => query.id === id);
        if (!next) return;
        showQuery(next);
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  function addFolder() {
    const next = createFolder(savedPreferences.current.folders, folderName, crypto.randomUUID());
    if (!next) return;
    setFolderName('');
    setFolderOpen(false);
    void persistPreferences({ ...savedPreferences.current, folders: next }).catch((cause: unknown) =>
      setNotice({ message: describeError(cause) }),
    );
  }

  async function onCreate() {
    const draft = { id: selectedId, title, sql, description, exportTarget, sqlOrigin };
    try {
      await enqueue(async () => {
        if (draft.id) await persistDraft(draft);
        const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(crypto.randomUUID(), emptyQuery());
        const item = toQueryItem(saved);
        queriesRef.current = [item, ...queriesRef.current];
        setQueries(queriesRef.current);
        showQuery(item);
        const home = draft.id ? folderIdFor(savedPreferences.current.folders, draft.id) : null;
        if (home) {
          await persistPreferences({
            ...savedPreferences.current,
            folders: moveQuery(savedPreferences.current.folders, item.id, home),
          });
        }
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  async function onDelete(id: string) {
    const draft = { id: selectedId, title, sql, description, exportTarget, sqlOrigin };
    try {
      await enqueue(async () => {
        if (draft.id && draft.id !== id) await persistDraft(draft);
        const removed = queriesRef.current.find(query => query.id === id);
        let orphan = false;
        if (removed?.sheetSchedule) {
          try {
            await deleteExportSchedule(ctx.owox, removed.sheetSchedule.scheduleId);
          } catch {
            orphan = true;
          }
        }
        await ctx.collections<QueryDocument>(QUERIES_COLLECTION).delete(id);
        const items = queriesRef.current.filter(query => query.id !== id);
        queriesRef.current = items;
        setQueries(items);
        const pruned = pruneFolders(savedPreferences.current.folders, new Set(items.map(item => item.id)));
        if (pruned !== savedPreferences.current.folders) {
          await persistPreferences({ ...savedPreferences.current, folders: pruned });
        }
        if (selectedId === id) {
          const next = resumeQuery(items);
          if (next) showQuery(next);
          else showWelcome();
        }
        if (orphan) {
          setNotice({ message: 'The query was deleted. Remove its schedule in Plugins → Schedules.' });
        }
      });
    } catch (cause) {
      setNotice({ message: describeError(cause) });
    }
  }

  const showingDiff = historyOpen && versionCount > 0;
  const showingDescription = !showingDiff && editorMode === 'description';

  function showEditor(mode: 'sql' | 'description') {
    setHistoryOpen(false);
    setEditorMode(mode);
  }

  async function onCreateDataMart(input: { title: string; storageId: string }) {
    setCreatingMart(true);
    setMartError(null);
    setCreatedMartId(null);
    try {
      const created = await createSqlDataMart(ctx.owox, {
        title: input.title,
        storageId: input.storageId,
        sql,
        description,
      });
      if (!created.descriptionSaved) {
        setCreatedMartId(created.id);
        setMartError('The data mart was created, but its description could not be saved.');
        return;
      }
      ctx.ui.navigate(dataMartPath(ctx.projectId, created.id));
    } catch (cause) {
      setMartError(describeError(cause));
    } finally {
      setCreatingMart(false);
    }
  }

  const trimmedProject = projectId.trim();
  const runDisabled = running || paging || !trimmedProject || sql.trim().length === 0 || queryState !== 'ready';
  const unsaved = Boolean(selected) && queryIsDirty(selected, title, sql, description, exportTarget);

  async function rememberRun(input: {
    id: string;
    jobId: string;
    projectId: string;
    location: string;
    sql: string;
  }) {
    await enqueue(async () => {
      const current = queriesRef.current.find(query => query.id === input.id);
      if (!current) return;
      const kept = (await readKept(input.id)) ?? current;
      const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(
        input.id,
        storedQuery(
          {
            title: current.title,
            sql: current.sql,
            description: current.description,
            exportTarget: current.exportTarget,
            lastRun: {
              jobId: input.jobId,
              projectId: input.projectId,
              location: input.location,
              ranAt: new Date().toISOString(),
              sql: input.sql,
            },
            sheetSchedule: kept.sheetSchedule,
            scheduledExport: kept.scheduledExport,
            sqlOrigin: kept.sqlOrigin,
          },
          current.versions,
        ),
      );
      replaceQuery(toQueryItem(saved));
    });
  }

  async function clearCache() {
    const queryId = selectedId;
    if (!queryId || running || paging || restoring) return;
    const token = ++shownRun.current;
    setRestoring(false);
    try {
      await enqueue(async () => {
        const current = queriesRef.current.find(query => query.id === queryId);
        if (!current?.lastRun) return;
        const kept = (await readKept(queryId)) ?? current;
        const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(
          queryId,
          storedQuery(
            {
              title: current.title,
              sql: current.sql,
              description: current.description,
              exportTarget: current.exportTarget,
              lastRun: null,
              sheetSchedule: kept.sheetSchedule,
              scheduledExport: kept.scheduledExport,
              sqlOrigin: kept.sqlOrigin,
            },
            current.versions,
          ),
        );
        replaceQuery(toQueryItem(saved));
      });
      if (shownRun.current !== token) return;
      setSession(null);
      setNotice(null);
    } catch (cause) {
      if (shownRun.current === token) setNotice({ message: describeError(cause) });
    }
  }

  async function writeSheetSchedule(id: string, sheetSchedule: SheetSchedule | null) {
    await enqueue(async () => {
      const current = queriesRef.current.find(query => query.id === id);
      if (!current) return;
      const kept = (await readKept(id)) ?? current;
      const saved = await ctx.collections<QueryDocument>(QUERIES_COLLECTION).put(
        id,
        storedQuery(
          {
            title: current.title,
            sql: current.sql,
            description: current.description,
            exportTarget: current.exportTarget,
            lastRun: kept.lastRun,
            sheetSchedule,
            scheduledExport: kept.scheduledExport,
            sqlOrigin: kept.sqlOrigin,
          },
          kept.versions,
        ),
      );
      replaceQuery(toQueryItem(saved));
    });
  }

  async function reloadQuery(id: string) {
    await enqueue(async () => {
      const kept = await readKept(id);
      if (kept) replaceQuery(kept);
    });
  }

  async function onRun() {
    if (runDisabled) return;
    const fetchImpl = credentialFetch(ctx);
    if (!fetchImpl) {
      setSession(null);
      setNotice({
        message:
          'Google Service Account access is not granted. Select the Credential again for SQL-Console.',
      });
      return;
    }

    const token = ++shownRun.current;
    const queryId = selectedId;
    const ranSql = sql;
    const ranProject = trimmedProject;
    const ranLocation = location.trim();
    setRestoring(false);
    setRunning(true);
    setNotice(null);
    setSession(null);
    try {
      const outcome = await runBigQueryPreview({
        fetchImpl,
        projectId: ranProject,
        location: ranLocation || null,
        sql: ranSql,
        pageSize,
        signal: ctx.signal,
      });
      if (shownRun.current === token) {
        applyOutcome(outcome, {
          projectId: ranProject,
          location: ranLocation || null,
          pageIndex: 0,
          pageSize,
        });
      }
      if (outcome.status === 'ok' && outcome.table.jobId) {
        await rememberRun({
          id: queryId,
          jobId: outcome.table.jobId,
          projectId: ranProject,
          location: outcome.table.location ?? ranLocation,
          sql: ranSql,
        });
      }
    } catch (cause) {
      if (shownRun.current === token) setNotice({ message: describeError(cause) });
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
    if (!session || !jobId || running || paging || restoring) return;
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
      if (outcome.status === 'expired') {
        setSession(null);
        const ranAt = queriesRef.current.find(query => query.id === selectedId)?.lastRun?.ranAt;
        setNotice({
          message: ranAt
            ? lastRunExpiredMessage(ranAt)
            : 'BigQuery no longer has this result. Run the query again.',
        });
        return;
      }
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

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (queryState !== 'ready' || !selectedId) return;
    const saved = queriesRef.current.find(query => query.id === selectedId)?.lastRun ?? null;
    const visible = sessionRef.current;
    if (!saved) return;
    if (visible?.jobId === saved.jobId && visible.projectId === saved.projectId) return;

    const token = ++shownRun.current;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled || shownRun.current !== token) return;
      const fetchImpl = credentialFetch(ctx);
      if (!fetchImpl) {
        setNotice({
          message: `Last run ${formatVersionTime(saved.ranAt)}. Google Service Account access is not granted. Select the Credential again for SQL-Console.`,
        });
        return;
      }
      setRestoring(true);
      setNotice(null);
      setSession(null);
      try {
        const outcome = await fetchResultPage({
          fetchImpl,
          projectId: saved.projectId,
          jobId: saved.jobId,
          location: saved.location || null,
          startIndex: 0,
          pageSize: pageSizeRef.current,
          signal: ctx.signal,
        });
        if (cancelled || shownRun.current !== token) return;
        if (outcome.status === 'ok') {
          const table = outcome.table;
          setSession({
            columns: table.columns,
            rows: table.rows,
            totalRows: table.totalRows,
            bytesProcessed: table.bytesProcessed,
            jobId: table.jobId ?? saved.jobId,
            location: table.location ?? (saved.location || null),
            projectId: saved.projectId,
            pageIndex: 0,
            pageSize: pageSizeRef.current,
          });
          return;
        }
        setSession(null);
        setNotice({
          message: outcome.status === 'expired' ? lastRunExpiredMessage(saved.ranAt) : outcome.message,
        });
      } catch (cause) {
        if (cancelled || shownRun.current !== token) return;
        setNotice({ message: describeError(cause) });
      } finally {
        if (!cancelled && shownRun.current === token) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ctx, queryState, selected?.lastRun?.jobId, selected?.lastRun?.ranAt, selectedId]);

  const pages = session ? pageCount(session.totalRows, session.pageSize) : null;
  const savedRun = selected?.lastRun ?? null;
  const sqlChanged = Boolean(savedRun && session && savedRun.sql.trim() !== sql.trim());
  const nextEnabled = Boolean(
    session?.jobId &&
      !running &&
      !paging &&
      !restoring &&
      canGoNext(session.pageIndex, session.pageSize, session.totalRows, session.rows.length),
  );
  const bytes = formatBytes(session?.bytesProcessed ?? null);
  const visibleQueries = queries
    .filter(query => query.id === selectedId || !isBlankQuery(query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return (
    <div
      ref={shellRef}
      className={narrow ? 'shell narrow' : 'shell'}
      style={{
        ['--sidebar-size' as string]: `${narrow ? stackSize : sidebarSize}px`,
        ['--editor-size' as string]: `${editorSize}px`,
      }}
      data-dragging={dragging ? 'true' : undefined}
    >
      <aside className="sidebar" aria-label="Queries">
        <div className="sidebar-header">
          <strong>Queries</strong>
          <span className="toolbar-spacer" />
          <button
            className="icon-button"
            type="button"
            aria-label="New folder"
            title="New folder"
            aria-expanded={folderOpen}
            onClick={() => setFolderOpen(open => !open)}
          >
            <FolderPlus size={16} aria-hidden="true" />
          </button>
          <button className="icon-button" type="button" aria-label="New query" onClick={() => void onCreate()}>
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        {folderOpen ? (
          <div className="folder-create" role="group" aria-label="New folder">
            <input
              aria-label="Folder name"
              placeholder="Folder name"
              value={folderName}
              autoFocus
              onChange={event => setFolderName(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addFolder();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setFolderOpen(false);
                }
              }}
            />
            <button
              className="primary"
              type="button"
              disabled={!folderName.trim() || folders.length >= MAX_FOLDERS}
              onClick={addFolder}
            >
              Create
            </button>
          </div>
        ) : null}
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
          {queryState === 'ready' && visibleQueries.length === 0 && folders.length === 0 ? (
            <p className="empty-note">No queries yet.</p>
          ) : null}
          {queryState === 'ready' && (visibleQueries.length > 0 || folders.length > 0) ? (
            <QueryTree
              folders={folders}
              queries={visibleQueries}
              selectedId={selectedId}
              onOpen={id => {
                const opened = revealQuery(savedPreferences.current.folders, id);
                if (opened !== savedPreferences.current.folders) {
                  void persistPreferences({ ...savedPreferences.current, folders: opened }).catch((cause: unknown) =>
                    setNotice({ message: describeError(cause) }),
                  );
                }
                void openQuery(id);
              }}
              onDelete={id => void onDelete(id)}
              onToggle={id =>
                void persistPreferences({
                  ...savedPreferences.current,
                  folders: toggleFolder(savedPreferences.current.folders, id),
                }).catch((cause: unknown) => setNotice({ message: describeError(cause) }))
              }
              onRename={(id, name) => {
                const next = renameFolder(savedPreferences.current.folders, id, name);
                if (!next || next === savedPreferences.current.folders) return;
                void persistPreferences({ ...savedPreferences.current, folders: next }).catch((cause: unknown) =>
                  setNotice({ message: describeError(cause) }),
                );
              }}
              onRemoveFolder={id =>
                void persistPreferences({
                  ...savedPreferences.current,
                  folders: removeFolder(savedPreferences.current.folders, id),
                }).catch((cause: unknown) => setNotice({ message: describeError(cause) }))
              }
              onMove={(queryId, folderId) => {
                const next = moveQuery(savedPreferences.current.folders, queryId, folderId);
                if (next === savedPreferences.current.folders) return;
                void persistPreferences({ ...savedPreferences.current, folders: next }).catch((cause: unknown) =>
                  setNotice({ message: describeError(cause) }),
                );
              }}
            />
          ) : null}
        </div>
      </aside>

      <Splitter
        orientation={narrow ? 'horizontal' : 'vertical'}
        label="Resize queries"
        value={narrow ? stackSize : sidebarSize}
        min={SIDEBAR_MIN}
        max={SIDEBAR_MAX}
        onDragStart={() => {
          draggingRef.current = true;
          setDragging(true);
        }}
        onDragEnd={() => {
          draggingRef.current = false;
          setDragging(false);
          commitLayout();
        }}
        onResize={next => {
          const size = clamp(next, SIDEBAR_MIN, sidebarMax(shellRef.current, narrow));
          layoutLive.current = narrow ? { ...layoutLive.current, stack: size } : { ...layoutLive.current, sidebar: size };
          if (narrow) setStackSize(size);
          else setSidebarSize(size);
        }}
      />

      <div ref={mainRef} className={selected ? 'main-column' : 'main-column is-welcome'}>
        {queryState === 'ready' && !selected ? (
          <div className="welcome-wrap">
            {notice ? (
              <p className="banner" role="alert">
                {notice.message}
              </p>
            ) : null}
            <Welcome onNew={() => void onCreate()} />
          </div>
        ) : queryState !== 'ready' ? (
          <p className="welcome-waiting">{queryState === 'loading' ? 'Opening SQL-Console…' : ''}</p>
        ) : (
          <>
        <section className="editor-pane" aria-label={showingDescription ? 'Query description' : 'SQL editor'}>
          <div className="pane-toolbar editor-toolbar">
            <input
              className="title-input"
              aria-label="Query name"
              value={title}
              disabled={queryState !== 'ready'}
              onChange={event => setTitle(event.target.value)}
            />
            <div className="editor-mode" role="group" aria-label="Editor mode">
              <button type="button" aria-pressed={!showingDiff && editorMode === 'sql'} onClick={() => showEditor('sql')}>
                SQL
              </button>
              <button
                type="button"
                aria-pressed={showingDescription}
                onClick={() => showEditor('description')}
              >
                Description
              </button>
            </div>
            {showingDescription ? (
              <span className="description-count" data-full={description.length >= MAX_DESCRIPTION ? 'true' : undefined}>
                {description.length}/{MAX_DESCRIPTION}
              </span>
            ) : null}
            <div className="editor-actions">
              <QuerySettings
                projectId={projectId}
                location={location}
                options={storageOptions}
                status={storageStatus}
                unread={storageUnread}
                onProjectId={setProjectId}
                onLocation={setLocation}
              />
              <SqlImport
                sql={sql}
                origin={sqlOrigin}
                disabled={queryState !== 'ready'}
                client={ctx.owox}
                onImport={(nextSql, nextOrigin) => {
                  setSql(nextSql);
                  setSqlOrigin(nextOrigin);
                  showEditor('sql');
                  setNotice({
                    message:
                      nextOrigin.kind === 'report'
                        ? `Imported the SQL “${nextOrigin.title}” will run.`
                        : `Imported SQL from “${nextOrigin.title}”.`,
                  });
                }}
                onUpdated={message => setNotice({ message })}
              />
              <CreateDataMart
                queryTitle={title}
                sql={sql}
                storages={storageOptions}
                storageStatus={storageStatus}
                creating={creatingMart}
                error={martError}
                createdId={createdMartId}
                onCreate={input => void onCreateDataMart(input)}
                onOpenCreated={() => {
                  if (createdMartId) ctx.ui.navigate(dataMartPath(ctx.projectId, createdMartId));
                }}
              />
              <span className="toolbar-divider" aria-hidden="true" />
              {queryState === 'ready' && !unsaved && !saving ? (
                <span className="save-state" title="This SQL is already saved as a version">
                  <Check size={14} aria-hidden="true" />
                  Saved
                </span>
              ) : (
                <button
                  className="ghost save-query"
                  type="button"
                  aria-label={saving ? 'Saving…' : 'Save'}
                  title="Keep a version of this SQL. The editor text is kept as you type."
                  disabled={saving || !unsaved}
                  onClick={() => void onSave()}
                >
                  <Save size={14} aria-hidden="true" />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
              <button className="primary" type="button" disabled={runDisabled} onClick={() => void onRun()}>
                <Play size={14} aria-hidden="true" />
                {running ? 'Running…' : 'Run'}
              </button>
              <Hint label="these buttons">
                Settings chooses where the query runs. Pick a BigQuery storage to fill the GCP project and location, or
                type them. Jobs use the plugin service account, not the key saved on the storage. Import SQL puts a data
                mart's SQL, or the full SQL a report will run, into the editor. Update data mart appears after a data
                mart import and writes this SQL back; a report is never written back. Create data mart makes a new SQL
                data mart and does not change an existing one. The editor text is kept as you type. Save stores a
                version you can open under Versions, and does not change a data mart. Run executes the SQL and shows the
                rows.
              </Hint>
            </div>
          </div>
          <div className="editor-body">
            {showingDiff ? (
              <VersionDiff
                versions={selected?.versions ?? []}
                baseIndex={versionPick.base}
                headIndex={versionPick.head}
                onBaseChange={base => setHistoryPick(current => ({ ...current, base }))}
                onHeadChange={head => setHistoryPick(current => ({ ...current, head }))}
                onUseVersion={nextSql => {
                  setSql(nextSql);
                  showEditor('sql');
                }}
              />
            ) : editorMode === 'description' ? (
              <MarkdownEditor value={description} theme={ctx.theme} onChange={setDescription} />
            ) : (
              <SqlEditor value={sql} theme={ctx.theme} sources={sqlSources} onChange={setSql} onRun={() => void onRun()} />
            )}
          </div>
          <div className="editor-foot">
            <CredentialStatus
              ctx={ctx}
              projectId={session?.projectId ?? null}
              jobId={session?.jobId ?? null}
              location={session?.location ?? null}
            />
            {sqlOrigin ? (
              <span className="import-source">
                <span className="import-source-kind">
                  {sqlOrigin.kind === 'data-mart' ? 'Data mart' : 'Report'}
                </span>
                <span className="import-source-name" title={sqlOrigin.title}>
                  {sqlOrigin.title}
                </span>
                <Hint
                  label={sqlOrigin.kind === 'data-mart' ? 'imported data mart' : 'imported report'}
                  placement="above"
                >
                  {sqlOrigin.kind === 'data-mart'
                    ? 'This is the data mart the SQL was imported from. The editor is a separate copy. Update data mart is what writes it back, and reports on that data mart then run the new SQL.'
                    : 'This is the report the SQL was imported from. The editor has the full SQL that report will run, including columns, filters, and limits. That SQL is not written back to a data mart.'}
                </Hint>
              </span>
            ) : null}
            <QueryDryRun
              ctx={ctx}
              sql={sql}
              projectId={projectId}
              location={location}
              enabled={queryState === 'ready' && !showingDiff && editorMode === 'sql'}
            />
            <span className="editor-hint">{!showingDiff && editorMode === 'sql' ? 'Ctrl+Enter or Cmd+Enter' : ''}</span>
            <div className="editor-foot-actions">
              <QueryHistory
                versions={selected?.versions ?? []}
                open={historyOpen}
                headIndex={versionPick.head}
                onOpenChange={setHistoryOpen}
                onSelect={selectVersion}
              />
            </div>
          </div>
        </section>

        <Splitter
          orientation="horizontal"
          label="Resize editor and preview"
          value={editorSize}
          min={EDITOR_MIN}
          max={EDITOR_MAX}
          onDragStart={() => {
            draggingRef.current = true;
            setDragging(true);
          }}
          onDragEnd={() => {
            draggingRef.current = false;
            setDragging(false);
            commitLayout();
          }}
          onResize={next => {
            const size = clamp(next, EDITOR_MIN, editorMax(mainRef.current));
            layoutLive.current = { ...layoutLive.current, editor: size };
            setEditorSize(size);
          }}
        />

        <section
          className={paging || restoring ? 'preview-pane is-paging' : 'preview-pane'}
          aria-label="Query preview"
          aria-live="polite"
        >
          <div className="pane-toolbar preview-toolbar">
            <span className="pane-title">Preview</span>
            <label className="page-size preview-meta">
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
              className="ghost pager"
              type="button"
              aria-label="Previous page"
              disabled={!session || session.pageIndex === 0 || running || paging}
              onClick={() => {
                if (session) void showPage(session.pageIndex - 1, session.pageSize);
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <span className="preview-meta">
              {session ? `Page ${session.pageIndex + 1}${pages ? ` of ${pages}` : ''}` : 'Page'}
            </span>
            <button
              className="ghost pager"
              type="button"
              aria-label="Next page"
              disabled={!nextEnabled}
              onClick={() => {
                if (session) void showPage(session.pageIndex + 1, session.pageSize);
              }}
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <span className="toolbar-spacer" />
            <button
              className="ghost preview-action"
              type="button"
              disabled={!savedRun || running || paging || restoring}
              title="Forget the saved BigQuery job for this query"
              onClick={() => void clearCache()}
            >
              Clear cache
            </button>
            <button
              className="ghost preview-action"
              type="button"
              disabled={!session || session.columns.length === 0 || running || paging || restoring}
              title="Download the rows on this page as CSV"
              onClick={() => {
                if (!session || session.columns.length === 0) return;
                downloadTextFile(
                  csvFilename(title),
                  `\uFEFF${toCsv(session.columns, session.rows)}`,
                  'text/csv;charset=utf-8',
                );
              }}
            >
              <Download size={12} aria-hidden="true" />
              Download CSV
            </button>
            <ExportPanel
              key={selectedId}
              queryTitle={title}
              target={exportTarget}
              onTarget={setExportTarget}
              columns={session?.columns ?? []}
              rows={session?.rows ?? []}
              busy={running || paging}
              fetchImpl={credentialFetch(ctx)}
              openExternal={url => {
                void ctx.ui.openExternal(url);
              }}
              signal={ctx.signal}
              job={
                session?.jobId
                  ? { projectId: session.projectId, jobId: session.jobId, location: session.location }
                  : null
              }
              sheetRoot={shellRef}
              schedule={
                selected
                  ? {
                      queryId: selected.id,
                      dirty: unsaved,
                      projectId,
                      location,
                      sheetSchedule: selected.sheetSchedule,
                      scheduledExport: selected.scheduledExport,
                      http: ctx.owox,
                      actions: ctx.actions ?? null,
                      onSheetSchedule: next => writeSheetSchedule(selected.id, next),
                      onRan: () => reloadQuery(selected.id),
                    }
                  : null
              }
            />
            <span className="preview-meta">
              {restoring
                ? 'Loading the last run…'
                : session
                  ? [
                      savedRun ? `Last run ${formatVersionTime(savedRun.ranAt)}` : null,
                      formatRowRange(session.pageIndex, session.pageSize, session.rows.length, session.totalRows),
                      bytes ? `${bytes} processed` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : running
                    ? 'Running the query…'
                    : savedRun
                      ? `Last run ${formatVersionTime(savedRun.ranAt)}`
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
                Open settings and set the GCP project. Jobs run in that project.
              </p>
            ) : null}
            {sqlChanged ? (
              <p className="empty-note">These rows are from the last run. The SQL has changed since then.</p>
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
          </>
        )}
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
        if (event.key !== larger && event.key !== smaller) return;
        event.preventDefault();
        onResize(value + (event.key === larger ? step : -step));
        onDragEnd();
      }}
    />
  );
}

function credentialFetch(ctx: PluginContext): typeof fetch | null {
  const google = exactCredential(ctx.credentials, GOOGLE_SERVICE_ACCOUNT);
  return google ? google.asFetch() : null;
}

function CredentialStatus({
  ctx,
  projectId,
  jobId,
  location,
}: {
  ctx: PluginContext;
  projectId: string | null;
  jobId: string | null;
  location: string | null;
}) {
  const granted = exactCredential(ctx.credentials, GOOGLE_SERVICE_ACCOUNT) != null;
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!granted) return;
    const fetchImpl = credentialFetch(ctx);
    if (!fetchImpl) return;
    let cancelled = false;
    void loadServiceAccountEmail(fetchImpl, ctx.signal).then(next => {
      if (!cancelled && next) setEmail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, granted]);

  useEffect(() => {
    if (!granted || email || !projectId || !jobId) return;
    const fetchImpl = credentialFetch(ctx);
    if (!fetchImpl) return;
    let cancelled = false;
    void loadJobUserEmail(fetchImpl, { projectId, jobId, location }, ctx.signal).then(next => {
      if (!cancelled && next) setEmail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, email, granted, jobId, location, projectId]);

  const identity = !granted ? 'not granted' : (email ?? 'Google Service Account');
  const title = granted
    ? 'Queries run with this plugin Credential, the Google Service Account selected when SQL-Console was installed. The key saved on a Storage is not used.'
    : 'No Google Service Account Credential is granted. Select the Credential again for SQL-Console.';

  return (
    <span className="credential-status" title={email ? `${email}. ${title}` : title}>
      <span className="credential-name">Credential · {identity}</span>
      <Hint label="the service account" placement="above">
        {title}
      </Hint>
    </span>
  );
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
