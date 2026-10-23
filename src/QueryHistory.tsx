import { useEffect, useRef } from 'react';
import { diffSideBySide, type DiffCell } from './diff.ts';
import { Hint } from './Hint.tsx';
import { formatVersionTime, type QueryVersion } from './queries.ts';

interface QueryHistoryProps {
  versions: readonly QueryVersion[];
  open: boolean;
  headIndex: number;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}

export function QueryHistory({ versions, open, headIndex, onOpenChange, onSelect }: QueryHistoryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const versionLabel = versions.length === 1 ? '1 version' : `${versions.length} versions`;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('.version-diff')) return;
      onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [onOpenChange, open]);

  return (
    <div className="history" ref={rootRef}>
      <span className="field-label">
        <button
          className="details-button"
          type="button"
          aria-expanded={open}
          aria-controls="query-versions"
          onClick={() => onOpenChange(!open)}
        >
          Versions
        </button>
        <Hint label="Versions" placement="above">
          Save, next to Run, keeps a copy of the SQL. Compare two versions, then load one into the editor. The editor text
          is kept as you type. Save does not change the data mart.
        </Hint>
      </span>
      {open ? (
        <div className="history-panel" id="query-versions" role="region" aria-label="Query versions">
          <p className="history-note">{versionLabel} · Last 100 saves</p>
          {versions.length === 0 ? (
            <p className="history-note">Press Save, next to Run, to keep a version.</p>
          ) : (
            <ul className="version-list">
              {versions.map((version, index) => (
                <li key={`${version.savedAt}-${index}`}>
                  <button
                    className="version-option"
                    type="button"
                    aria-current={index === headIndex ? 'true' : undefined}
                    onClick={() => onSelect(index)}
                  >
                    {formatVersionTime(version.savedAt)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface VersionDiffProps {
  versions: readonly QueryVersion[];
  baseIndex: number | null;
  headIndex: number;
  onBaseChange: (index: number | null) => void;
  onHeadChange: (index: number) => void;
  onUseVersion: (sql: string) => void;
}

export function VersionDiff({
  versions,
  baseIndex,
  headIndex,
  onBaseChange,
  onHeadChange,
  onUseVersion,
}: VersionDiffProps) {
  const head = versions[headIndex] ?? versions[0];
  const base = baseIndex === null ? undefined : versions[baseIndex];
  if (!head) return null;
  const rows = diffSideBySide(base?.sql ?? '', head.sql);
  const selectedBase = base ? String(baseIndex) : 'empty';

  return (
    <div className="version-diff" aria-label="Version diff">
      <div className="version-diff-head">
        <div className="version-diff-pane">
          <label>
            Base
            <select
              aria-label="Base version"
              value={selectedBase}
              onChange={event => onBaseChange(event.target.value === 'empty' ? null : Number(event.target.value))}
            >
              <option value="empty">Empty</option>
              {versions.map((version, index) => (
                <option key={`base-${version.savedAt}-${index}`} value={index}>
                  {formatVersionTime(version.savedAt)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="version-diff-pane">
          <label>
            Compare
            <select
              aria-label="Compare version"
              value={String(versions[headIndex] ? headIndex : 0)}
              onChange={event => onHeadChange(Number(event.target.value))}
            >
              {versions.map((version, index) => (
                <option key={`head-${version.savedAt}-${index}`} value={index}>
                  {formatVersionTime(version.savedAt)}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost" type="button" onClick={() => onUseVersion(head.sql)}>
            Use this version
          </button>
        </div>
      </div>
      <div className="version-diff-body">
        {rows.length === 0 ? (
          <p className="history-note">No changes.</p>
        ) : (
          rows.map((row, index) => (
            <div className="version-diff-row" key={`${row.left.kind}-${row.right.kind}-${index}`}>
              <DiffSide cell={row.left} />
              <DiffSide cell={row.right} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DiffSide({ cell }: { cell: DiffCell }) {
  return (
    <div className={`version-diff-side ${cell.kind}`}>
      <span className="version-diff-gutter" aria-hidden="true">
        {cell.line ?? ''}
      </span>
      <pre className="version-diff-cell">{cell.text || ' '}</pre>
    </div>
  );
}
