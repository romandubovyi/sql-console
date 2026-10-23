import { Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { StorageFields } from './StorageFields.tsx';
import type { BigQueryStorageOption } from './storages.ts';

interface QuerySettingsProps {
  projectId: string;
  location: string;
  options: readonly BigQueryStorageOption[];
  status: 'loading' | 'ready' | 'error';
  unread: number;
  onProjectId: (value: string) => void;
  onLocation: (value: string) => void;
}

export function QuerySettings({
  projectId,
  location,
  options,
  status,
  unread,
  onProjectId,
  onLocation,
}: QuerySettingsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const project = projectId.trim();
  const place = location.trim();
  const summary = project
    ? `Project ${project}${place ? `, location ${place}` : ', location autodetect'}`
    : 'Set the GCP project and location';

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mart" ref={rootRef}>
      <button
        className="ghost tool"
        type="button"
        aria-expanded={open}
        aria-controls="query-settings"
        aria-label={summary}
        title={summary}
        data-empty={project ? undefined : 'true'}
        onClick={() => setOpen(current => !current)}
      >
        <Settings size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mart-panel settings-panel" id="query-settings" role="dialog" aria-label="Project and location">
          <p className="mart-lead">Jobs run in this GCP project.</p>
          <StorageFields
            projectId={projectId}
            location={location}
            options={options}
            status={status}
            unread={unread}
            autoFocusProject
            onProjectId={onProjectId}
            onLocation={onLocation}
          />
        </div>
      ) : null}
    </div>
  );
}
