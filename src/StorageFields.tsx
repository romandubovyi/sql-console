import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import {
  filterStorageOptions,
  firstSelectableIndex,
  stepSelectable,
  storageSuggestionDetail,
  type BigQueryStorageOption,
} from './storages.ts';

interface StorageFieldsProps {
  projectId: string;
  location: string;
  options: readonly BigQueryStorageOption[];
  status: 'loading' | 'ready' | 'error';
  unread: number;
  autoFocusProject?: boolean;
  onProjectId: (value: string) => void;
  onLocation: (value: string) => void;
}

type FieldName = 'project' | 'location';

export function StorageFields({
  projectId,
  location,
  options,
  status,
  unread,
  autoFocusProject = false,
  onProjectId,
  onLocation,
}: StorageFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openField, setOpenField] = useState<FieldName | null>(null);
  // Focus shows every storage. Typing then filters that list.
  const [filter, setFilter] = useState('');
  const matches = useMemo(
    () => filterStorageOptions(options, openField ? filter : ''),
    [filter, openField, options],
  );
  const signature = `${openField ?? ''}\0${filter}\0${matches.map(option => option.id).join('\0')}`;
  const [view, setView] = useState(() => ({ signature, activeIndex: firstSelectableIndex(matches) }));
  if (view.signature !== signature) {
    setView({ signature, activeIndex: firstSelectableIndex(matches) });
  }

  useEffect(() => {
    if (!openField) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenField(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openField]);

  useEffect(() => {
    const id = matches[view.activeIndex]?.id;
    if (!openField || !id) return;
    document.getElementById(`storage-option-${id}`)?.scrollIntoView({ block: 'nearest' });
  }, [matches, openField, view.activeIndex]);

  function open(field: FieldName) {
    setOpenField(field);
    setFilter('');
  }

  function choose(option: BigQueryStorageOption) {
    if (!option.gcpProjectId) return;
    onProjectId(option.gcpProjectId);
    onLocation(option.location ?? '');
    setOpenField(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (openField) event.stopPropagation();
      setOpenField(null);
      return;
    }
    if (!openField) {
      if (event.key === 'ArrowDown') open(event.currentTarget.name === 'location' ? 'location' : 'project');
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setView(current => ({ ...current, activeIndex: stepSelectable(matches, current.activeIndex, direction) }));
      return;
    }
    const chosen = matches[view.activeIndex];
    if (event.key === 'Enter' && chosen?.gcpProjectId) {
      event.preventDefault();
      choose(chosen);
    }
  }

  function onBlur(event: FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && rootRef.current?.contains(next)) return;
    setOpenField(null);
  }

  const activeId = matches[view.activeIndex]?.id;

  return (
    <div className="storage-fields" ref={rootRef}>
      <label className="page-size">
        Project
        <input
          className="project-input"
          name="project"
          role="combobox"
          aria-label="GCP project id"
          aria-autocomplete="list"
          aria-expanded={openField === 'project'}
          aria-controls={openField === 'project' ? 'storage-suggest' : undefined}
          aria-activedescendant={openField === 'project' && activeId ? `storage-option-${activeId}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={projectId}
          placeholder="GCP project"
          autoFocus={autoFocusProject}
          onFocus={() => open('project')}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onChange={event => {
            onProjectId(event.target.value);
            setOpenField('project');
            setFilter(event.target.value);
          }}
        />
      </label>
      <label className="page-size">
        Location
        <input
          className="location-input"
          name="location"
          role="combobox"
          aria-label="BigQuery location"
          aria-autocomplete="list"
          aria-expanded={openField === 'location'}
          aria-controls={openField === 'location' ? 'storage-suggest' : undefined}
          aria-activedescendant={openField === 'location' && activeId ? `storage-option-${activeId}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={location}
          placeholder="autodetect"
          onFocus={() => open('location')}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onChange={event => {
            onLocation(event.target.value);
            setOpenField('location');
            setFilter(event.target.value);
          }}
        />
      </label>
      {openField ? (
        <div className="storage-suggest" id="storage-suggest" role="listbox" aria-label="BigQuery storages">
          <p className="storage-suggest-caption">Choosing a storage fills Project and Location.</p>
          {status === 'loading' ? <p className="storage-suggest-note">Loading storages…</p> : null}
          {status === 'error' ? (
            <p className="storage-suggest-note">Storages could not be loaded. Type a project id and location.</p>
          ) : null}
          {status === 'ready' && matches.length === 0 ? (
            <p className="storage-suggest-note">
              {options.length === 0
                ? unread > 0
                  ? 'BigQuery storages could not be read. Type a project id and location.'
                  : 'No BigQuery storages in this project.'
                : 'No storages match what you typed.'}
            </p>
          ) : null}
          {matches.map(option => {
            const selectable = Boolean(option.gcpProjectId);
            const selected = option.id === activeId && selectable;
            return (
              <button
                key={option.id}
                id={`storage-option-${option.id}`}
                className={selected ? 'storage-suggest-option is-active' : 'storage-suggest-option'}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={!selectable}
                disabled={!selectable}
                onPointerDown={event => event.preventDefault()}
                onMouseEnter={() => {
                  if (!selectable) return;
                  const index = matches.findIndex(item => item.id === option.id);
                  setView(current => ({ ...current, activeIndex: index }));
                }}
                onClick={() => choose(option)}
              >
                <span className="storage-suggest-title">{option.title}</span>
                <span className="storage-suggest-detail">{storageSuggestionDetail(option)}</span>
              </button>
            );
          })}
          {status === 'ready' && unread > 0 && options.length > 0 ? (
            <p className="storage-suggest-note">Some storages could not be read.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
