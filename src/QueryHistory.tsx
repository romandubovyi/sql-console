import { useEffect, useRef } from 'react';
import { diffSideBySide } from './diff.ts';
import { formatVersionTime, type QueryVersion } from './queries.ts';

interface QueryHistoryProps {
  versions: readonly QueryVersion[];
  open: boolean;
  olderIndex: number | null;
  newerIndex: number;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}

export function QueryHistory({
  versions,
  open,
  olderIndex,
  newerIndex,
  onOpenChange,
  onSelect,
}: QueryHistoryProps) {
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
      <button
        className="details-button"
        type="button"
        aria-expanded={open}
        aria-controls="query-details"
        onClick={() => onOpenChange(!open)}
      >
        Details
      </button>
      {open ? (
        <div className="history-panel" id="query-details" role="region" aria-label="Query details">
          <p className="history-note">{versionLabel} · Last 100 saves</p>
          {versions.length === 0 ? (
            <p className="history-note">Save the query to keep a version.</p>
          ) : (
            <ul className="version-list">
              {versions.map((version, index) => {
                const side = index === newerIndex ? 'newer' : index === olderIndex ? 'older' : undefined;
                return (
                  <li key={`${version.savedAt}-${index}`}>
                    <button
                      className="version-option"
                      type="button"
                      aria-current={side ? 'true' : undefined}
                      data-side={side}
                      onClick={() => onSelect(index)}
                    >
                      <span>{formatVersionTime(version.savedAt)}</span>
                      {side === 'newer' ? <span className="version-side">Right</span> : null}
                      {side === 'older' ? <span className="version-side">Left</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface VersionDiffProps {
  versions: readonly QueryVersion[];
  olderIndex: number | null;
  newerIndex: number;
  onUseVersion: (sql: string) => void;
}

export function VersionDiff({ versions, olderIndex, newerIndex, onUseVersion }: VersionDiffProps) {
  const newer = versions[newerIndex];
  const older = olderIndex === null ? undefined : versions[olderIndex];
  if (!newer) return null;
  const rows = diffSideBySide(older?.sql ?? '', newer.sql);

  return (
    <div className="version-diff" aria-label="Version diff">
      <div className="version-diff-head">
        <span>{older ? formatVersionTime(older.savedAt) : 'Empty'}</span>
        <span>
          {formatVersionTime(newer.savedAt)}
          <button className="ghost" type="button" onClick={() => onUseVersion(newer.sql)}>
            Use this version
          </button>
        </span>
      </div>
      <div className="version-diff-body">
        {rows.length === 0 ? (
          <p className="history-note">No changes.</p>
        ) : (
          rows.map((row, index) => (
            <div className="version-diff-row" key={`${row.left.kind}-${row.right.kind}-${index}`}>
              <pre className={`version-diff-cell ${row.left.kind}`}>{row.left.text || ' '}</pre>
              <pre className={`version-diff-cell ${row.right.kind}`}>{row.right.text || ' '}</pre>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

