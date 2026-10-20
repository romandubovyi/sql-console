import { History } from 'lucide-react';
import { useState } from 'react';
import { diffLines } from './diff.ts';
import { formatVersionTime, type QueryVersion } from './queries.ts';

type VersionSide = number | 'empty';

interface QueryHistoryProps {
  versions: readonly QueryVersion[];
  open: boolean;
  onToggle: () => void;
  onUseVersion: (sql: string) => void;
}

export function QueryHistory({ versions, open, onToggle, onUseVersion }: QueryHistoryProps) {
  const signature = versions.map(version => `${version.savedAt}\n${version.sql}`).join('\n--\n');
  const [pair, setPair] = useState(() => ({ signature, ...defaultPair(versions) }));
  if (pair.signature !== signature) {
    setPair({ signature, ...defaultPair(versions) });
  }

  const fromSql = versionSql(versions, pair.from);
  const toSql = versionSql(versions, pair.to);
  const diff = versions.length > 0 ? diffLines(fromSql, toSql) : [];

  return (
    <div className="history">
      <div className="history-bar">
        <button
          className="ghost"
          type="button"
          aria-expanded={open}
          onClick={onToggle}
        >
          <History size={14} aria-hidden="true" />
          {versions.length === 1 ? '1 version' : `${versions.length} versions`}
        </button>
        <span className="dm-muted">Last 10 saves</span>
      </div>
      {open ? (
        <div className="history-panel">
          {versions.length === 0 ? (
            <p className="empty-note">Save the query to keep a version.</p>
          ) : (
            <>
              <div className="history-controls">
                <label>
                  From
                  <select
                    value={String(pair.from)}
                    onChange={event => setPair(current => ({ ...current, from: parseSide(event.target.value) }))}
                  >
                    <option value="empty">Empty</option>
                    {versions.map((version, index) => (
                      <option key={`${version.savedAt}-${index}`} value={index}>
                        {formatVersionTime(version.savedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select
                    value={String(pair.to)}
                    onChange={event => setPair(current => ({ ...current, to: parseSide(event.target.value) }))}
                  >
                    <option value="empty">Empty</option>
                    {versions.map((version, index) => (
                      <option key={`${version.savedAt}-${index}`} value={index}>
                        {formatVersionTime(version.savedAt)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="ghost"
                  type="button"
                  disabled={pair.to === 'empty'}
                  onClick={() => onUseVersion(toSql)}
                >
                  Open this version
                </button>
              </div>
              <pre className="diff" aria-label="Version diff">
                {diff.length === 0 ? (
                  <span className="diff-line same">No changes</span>
                ) : (
                  diff.map((line, index) => (
                    <span key={`${line.kind}-${index}`} className={`diff-line ${line.kind}`}>
                      {line.kind === 'add' ? '+ ' : line.kind === 'remove' ? '- ' : '  '}
                      {line.text || ' '}
                    </span>
                  ))
                )}
              </pre>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function defaultPair(versions: readonly QueryVersion[]): { from: VersionSide; to: VersionSide } {
  if (versions.length === 0) return { from: 'empty', to: 'empty' };
  if (versions.length === 1) return { from: 'empty', to: 0 };
  return { from: 1, to: 0 };
}

function parseSide(value: string): VersionSide {
  if (value === 'empty') return 'empty';
  const index = Number(value);
  return Number.isInteger(index) ? index : 'empty';
}

function versionSql(versions: readonly QueryVersion[], side: VersionSide): string {
  if (side === 'empty') return '';
  return versions[side]?.sql ?? '';
}
