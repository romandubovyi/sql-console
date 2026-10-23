import { ExternalLink, FileSpreadsheet, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { loadJobUserEmail, loadServiceAccountEmail, type CredentialJob } from './credential.ts';
import {
  googleFileUrl,
  parseGoogleFileLink,
  sheetTitle,
  storedSheetName,
  type ExportKind,
  type ExportTarget,
} from './export-target.ts';
import { listSharedFiles, listSheetTitles, writeDocument, writeSpreadsheet, type SharedFile } from './google-export.ts';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ExportPanelProps {
  queryTitle: string;
  target: ExportTarget | null;
  onTarget: (target: ExportTarget | null) => void;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  busy: boolean;
  fetchImpl: FetchLike | null;
  openExternal: (url: string) => void;
  signal: AbortSignal;
  job: CredentialJob | null;
  sheetRoot: RefObject<HTMLElement | null>;
}

function rowCount(rows: number): string {
  return rows === 1 ? '1 row' : `${rows} rows`;
}

const CREATE_SHEET = 'create:';

const SCOPE_TEXT =
  'This version added Google Sheets, Google Docs, and permission to list files already shared with the service account. Select the Credential again for SQL-Console.';

const NOT_GRANTED =
  'Google Service Account access is not granted. Select the Credential again for SQL-Console. This version also requests Sheets, Docs, and permission to list files already shared with that account.';

export function ExportPanel({
  queryTitle,
  target,
  onTarget,
  columns,
  rows,
  busy,
  fetchImpl,
  openExternal,
  signal,
  job,
  sheetRoot,
}: ExportPanelProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExportKind>(target?.kind ?? 'sheet');
  const [fileId, setFileId] = useState(target?.fileId ?? '');
  const [sheetName, setSheetName] = useState(target?.sheetName ?? '');
  const [wantsNew, setWantsNew] = useState(false);
  const [link, setLink] = useState('');
  const [linkChecked, setLinkChecked] = useState(false);
  const [reload, setReload] = useState(0);
  const [listed, setListed] = useState<{ request: number; files: SharedFile[]; note: string | null } | null>(null);
  const [titleState, setTitleState] = useState<{ fileId: string; titles: string[] | null } | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exporting) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [exporting, open]);

  useEffect(() => {
    if (!open || !fetchImpl) return;
    let cancelled = false;
    void loadServiceAccountEmail(fetchImpl, signal).then(next => {
      if (!cancelled && next) setEmail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl, open, signal]);

  useEffect(() => {
    if (!open || !fetchImpl || email || !job) return;
    let cancelled = false;
    void loadJobUserEmail(fetchImpl, job, signal).then(next => {
      if (!cancelled && next) setEmail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [email, fetchImpl, job, open, signal]);

  useEffect(() => {
    if (!open || !fetchImpl) return;
    const controller = new AbortController();
    const request = reload;
    void listSharedFiles(fetchImpl, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (result.status === 'ok') {
        setListed({ request, files: result.value, note: null });
        return;
      }
      const note =
        result.status === 'scope'
          ? SCOPE_TEXT
          : result.status === 'denied'
            ? 'Files shared with the service account could not be listed.'
            : result.message;
      setListed({ request, files: [], note });
    });
    return () => controller.abort();
  }, [fetchImpl, open, reload]);

  useEffect(() => {
    if (!open || kind !== 'sheet' || !fileId || !fetchImpl) return;
    const controller = new AbortController();
    const requested = fileId;
    void listSheetTitles(fetchImpl, requested, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setTitleState({ fileId: requested, titles: result.status === 'ok' ? result.value : null });
      if (result.status === 'scope') setMessage({ tone: 'error', text: SCOPE_TEXT });
    });
    return () => controller.abort();
  }, [fetchImpl, fileId, kind, open]);

  function publish(nextKind: ExportKind, nextFileId: string, nextSheet: string) {
    setKind(nextKind);
    setFileId(nextFileId);
    setSheetName(nextSheet);
    setMessage(null);
    if (!nextFileId) {
      onTarget(null);
      return;
    }
    onTarget({
      kind: nextKind,
      fileId: nextFileId,
      sheetName: nextKind === 'doc' ? '' : storedSheetName(nextSheet),
    });
  }

  function chooseKind(next: ExportKind) {
    if (next === kind) return;
    setLink('');
    setLinkChecked(false);
    publish(next, '', sheetName);
  }

  function onSheetPick(value: string) {
    if (value === CREATE_SHEET) {
      setWantsNew(true);
      const currentIsExisting = Array.isArray(titleLoad) && titleLoad.includes(sheetName);
      publish(kind, fileId, currentIsExisting ? '' : sheetName);
      return;
    }
    setWantsNew(false);
    publish(kind, fileId, value);
  }

  const files = fetchImpl && listed ? listed.files : [];
  const listNote = !fetchImpl ? NOT_GRANTED : listed?.request === reload ? listed.note : null;
  const loadingFiles = Boolean(open && fetchImpl && listed?.request !== reload);
  const titleLoad = titleState?.fileId === fileId ? titleState.titles : undefined;
  const knownTitles = Array.isArray(titleLoad) ? titleLoad : [];
  const creating =
    kind === 'sheet' && (wantsNew || (Array.isArray(titleLoad) && sheetName !== '' && !titleLoad.includes(sheetName)));
  const nextSheetTitle = sheetTitle(sheetName, queryTitle);
  const newNameTaken = creating && Array.isArray(titleLoad) && titleLoad.includes(nextSheetTitle);
  const loadingSheets = Boolean(open && fetchImpl && kind === 'sheet' && fileId && titleLoad === undefined);
  const sheetReady =
    kind !== 'sheet' ||
    (fileId !== '' &&
      titleLoad !== undefined &&
      (creating ? !newNameTaken : sheetName !== '' && (titleLoad === null || titleLoad.includes(sheetName))));
  const visible = files.filter(file => file.kind === kind);
  const known = visible.some(file => file.id === fileId);
  const canExport = Boolean(fetchImpl) && fileId !== '' && columns.length > 0 && !busy && !exporting && sheetReady;

  function closeSheet() {
    if (!exporting) setOpen(false);
  }
  const linkRejected = linkChecked && link.trim() !== '' && parseGoogleFileLink(link) == null;
  const destination = kind === 'doc' ? 'Document' : 'Spreadsheet';

  function reportExport(result: { status: 'ok'; text: string } | { status: 'scope' } | { status: 'denied' } | { status: 'error'; message: string }) {
    if (result.status === 'ok') {
      setMessage({ tone: 'ok', text: result.text });
      return;
    }
    if (result.status === 'scope') {
      setMessage({ tone: 'error', text: SCOPE_TEXT });
      return;
    }
    if (result.status === 'denied') {
      setMessage({
        tone: 'error',
        text: 'The service account cannot open this file. Share it as Editor, then export again.',
      });
      return;
    }
    setMessage({ tone: 'error', text: result.message });
  }

  async function runExport() {
    if (!fetchImpl || !canExport) return;
    setExporting(true);
    setMessage(null);
    if (kind === 'doc') {
      const result = await writeDocument(
        fetchImpl,
        { fileId, title: queryTitle.trim() || 'Results', columns, rows },
        signal,
      );
      setExporting(false);
      reportExport(result.status === 'ok' ? { status: 'ok', text: `Appended ${rowCount(result.value.rows)} to the document.` } : result);
      return;
    }
    const creatingSheet = creating;
    const result = await writeSpreadsheet(
      fetchImpl,
      { fileId, sheetName, fallbackSheetName: queryTitle, mode: creatingSheet ? 'create' : 'replace', columns, rows },
      signal,
    );
    setExporting(false);
    if (result.status === 'ok') {
      const writtenName = result.value.sheetName;
      setWantsNew(false);
      setTitleState(current => {
        const titles = current?.fileId === fileId && current.titles ? current.titles : [];
        return { fileId, titles: titles.includes(writtenName) ? titles : [...titles, writtenName] };
      });
      if (sheetName !== writtenName) publish('sheet', fileId, writtenName);
      reportExport({
        status: 'ok',
        text: creatingSheet
          ? `Created “${writtenName}” and wrote ${rowCount(result.value.rows)}.`
          : `Wrote ${rowCount(result.value.rows)} to “${writtenName}”.`,
      });
      return;
    }
    reportExport(result);
  }

  const sheet =
    open && sheetRoot.current
      ? createPortal(
          <div className="sheet-layer">
            <button className="sheet-backdrop" type="button" aria-label="Close export" disabled={exporting} onClick={closeSheet} />
            {/* The plugin frame has no allow-forms permission, so this sheet is not a form. */}
            <aside
              ref={sheetRef}
              className="side-sheet"
              id="export-results"
              role="dialog"
              aria-modal="true"
              aria-labelledby="export-sheet-title"
              tabIndex={-1}
            >
              <header className="side-sheet-header">
                <h2 id="export-sheet-title">Export this page</h2>
                <button className="icon-button" type="button" aria-label="Close export" disabled={exporting} onClick={closeSheet}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              <div className="side-sheet-body">
                <p className="sheet-lead">
                  The rows on this page go to a Google Sheet or Doc saved on this query. The plugin cannot share a file.
                  A service account only opens a file someone has already shared with it.
                </p>
                <div className="editor-mode" role="group" aria-label="Export destination">
                  <button type="button" aria-pressed={kind === 'sheet'} onClick={() => chooseKind('sheet')}>
                    Spreadsheet
                  </button>
                  <button type="button" aria-pressed={kind === 'doc'} onClick={() => chooseKind('doc')}>
                    Document
                  </button>
                </div>
                <label>
                  {destination}
                  <select
                    aria-label={destination}
                    value={fileId}
                    disabled={exporting}
                    onChange={event => {
                      setLink('');
                      setLinkChecked(false);
                      publish(kind, event.target.value, sheetName);
                    }}
                  >
                    <option value="">Select a file the service account can open</option>
                    {fileId && !known ? <option value={fileId}>Linked file</option> : null}
                    {visible.map(file => (
                      <option key={file.id} value={file.id}>
                        {file.name}
                      </option>
                    ))}
                  </select>
                </label>
                {loadingFiles ? <p className="history-note">Loading files…</p> : null}
                {!loadingFiles && listNote == null && visible.length === 0 ? (
                  <p className="history-note">
                    No {kind === 'doc' ? 'documents' : 'spreadsheets'} are shared with the service account yet.
                  </p>
                ) : null}
                {listNote ? <p className="history-note">{listNote}</p> : null}
                <label>
                  Or paste a link
                  <input
                    aria-label="Google file link"
                    value={link}
                    disabled={exporting}
                    placeholder="https://docs.google.com/…"
                    onBlur={() => setLinkChecked(true)}
                    onChange={event => {
                      const value = event.target.value;
                      setLink(value);
                      setLinkChecked(false);
                      const parsed = parseGoogleFileLink(value);
                      if (!parsed) return;
                      publish(parsed.kind ?? kind, parsed.fileId, sheetName);
                    }}
                  />
                </label>
                {linkRejected ? <p className="history-note">Paste a Google Sheets or Docs link, or the file id.</p> : null}
                {kind === 'sheet' ? (
                  <label>
                    Sheet
                    <select
                      aria-label="Sheet"
                      value={creating ? CREATE_SHEET : sheetName}
                      disabled={exporting || !fileId}
                      onChange={event => onSheetPick(event.target.value)}
                    >
                      <option value="">Choose a sheet</option>
                      {sheetName && !creating && !knownTitles.includes(sheetName) ? (
                        <option value={sheetName}>{sheetName}</option>
                      ) : null}
                      {knownTitles.map(title => (
                        <option key={title} value={title}>
                          {title}
                        </option>
                      ))}
                      <option value={CREATE_SHEET}>Create a new sheet</option>
                    </select>
                  </label>
                ) : null}
                {creating ? (
                  <label>
                    New sheet name
                    <input
                      aria-label="New sheet name"
                      value={sheetName}
                      disabled={exporting}
                      placeholder={queryTitle.trim() || 'Results'}
                      onChange={event => publish(kind, fileId, event.target.value)}
                    />
                  </label>
                ) : null}
                {loadingSheets ? <p className="history-note">Loading sheets…</p> : null}
                {kind === 'sheet' ? (
                  newNameTaken ? (
                    <p className="history-note">
                      This name is already a sheet. Select it to replace its rows, or type another name.
                    </p>
                  ) : creating ? (
                    <p className="history-note">
                      Export adds this sheet and does not change the other sheets. Leave the name empty to use the query
                      title.
                    </p>
                  ) : sheetName ? (
                    <p className="history-note">
                      Export replaces the rows on this sheet. Other queries can use this spreadsheet and a different
                      sheet.
                    </p>
                  ) : (
                    <p className="history-note">Choose a sheet to replace its rows, or create a new sheet.</p>
                  )
                ) : (
                  <p className="history-note">Each export adds a heading and a table at the end of this document.</p>
                )}
                <div className="export-share">
                  <p>Open the file, choose Share, and add this address as Editor. Then refresh the list.</p>
                  {email ? (
                    <code>{email}</code>
                  ) : (
                    <p>The address appears here after a query runs. It is also on the Credential in OWOX.</p>
                  )}
                  <p>Enable the Sheets, Docs, and Drive APIs on the GCP project that owns the key.</p>
                </div>
                {columns.length === 0 ? <p className="history-note">Run the query. Export sends the rows on this page.</p> : null}
                {message ? (
                  <p className={message.tone === 'error' ? 'banner' : 'history-note'} role={message.tone === 'error' ? 'alert' : 'status'}>
                    {message.text}
                  </p>
                ) : null}
              </div>
              <footer className="side-sheet-footer">
                <button className="ghost" type="button" disabled={loadingFiles || exporting || !fetchImpl} onClick={() => setReload(current => current + 1)}>
                  <RefreshCw size={14} aria-hidden="true" />
                  Refresh
                </button>
                <button
                  className="ghost"
                  type="button"
                  disabled={!fileId}
                  onClick={() => {
                    if (fileId) void openExternal(googleFileUrl(kind, fileId));
                  }}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Open
                </button>
                <button className="primary" type="button" disabled={!canExport} onClick={() => void runExport()}>
                  {exporting ? 'Exporting…' : 'Export'}
                </button>
              </footer>
            </aside>
          </div>,
          sheetRoot.current,
        )
      : null;

  return (
    <>
      <button
        className="ghost preview-action"
        type="button"
        aria-expanded={open}
        aria-controls="export-results"
        title="Export the rows on this page to a Google Sheet or Doc"
        onClick={() => setOpen(current => !current)}
      >
        <FileSpreadsheet size={12} aria-hidden="true" />
        Export this page
      </button>
      {sheet}
    </>
  );
}
