import { useEffect, useState } from 'react';
import { describeError } from './errors.ts';
import { formatVersionTime, type ScheduledExport, type SheetSchedule } from './queries.ts';
import {
  dailyCron,
  deleteExportSchedule,
  EXPORT_SHEET_ACTION,
  getExportSchedule,
  listExportSchedules,
  parseScheduleCron,
  pauseExportSchedule,
  resumeExportSchedule,
  saveExportSchedule,
  scheduleForQuery,
  weeklyCron,
  type RemoteSchedule,
  type ScheduleHttp,
} from './schedule.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MINUTES = [0, 15, 30, 45] as const;

interface SheetActionRunner {
  start(name: string, input?: unknown): Promise<{ id: string }>;
  wait(id: string): Promise<unknown>;
}

interface ScheduleSectionProps {
  queryId: string;
  queryTitle: string;
  dirty: boolean;
  projectId: string;
  location: string;
  fileId: string;
  tabState: 'none' | 'loading' | 'create' | 'ready' | 'unknown';
  sheetSchedule: SheetSchedule | null;
  scheduledExport: ScheduledExport | null;
  http: ScheduleHttp;
  actions: SheetActionRunner | null;
  onSheetSchedule: (schedule: SheetSchedule | null) => Promise<void>;
  onRan: () => Promise<void>;
}

export function ScheduleSection({
  queryId,
  queryTitle,
  dirty,
  projectId,
  location,
  fileId,
  tabState,
  sheetSchedule,
  scheduledExport,
  http,
  actions,
  onSheetSchedule,
  onRan,
}: ScheduleSectionProps) {
  const parsed = sheetSchedule ? parseScheduleCron(sheetSchedule.cron) : null;
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(parsed?.kind === 'weekly' ? 'weekly' : 'daily');
  const [hour, setHour] = useState(parsed && parsed.kind !== 'custom' ? parsed.hour : 9);
  const [minute, setMinute] = useState(parsed && parsed.kind !== 'custom' ? parsed.minute : 0);
  const [day, setDay] = useState(parsed?.kind === 'weekly' ? parsed.day : 1);
  const [remote, setRemote] = useState<RemoteSchedule | null>(null);
  const [phase, setPhase] = useState<'loading' | 'unavailable' | 'missing' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<null | 'save' | 'run' | 'other'>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listed = await listExportSchedules(http);
        if (cancelled) return;
        if (listed === 'unavailable') {
          setPhase('unavailable');
          setRemote(null);
          return;
        }
        let match = scheduleForQuery(listed, queryId, sheetSchedule?.scheduleId ?? null);
        if (!match && sheetSchedule) {
          match = await getExportSchedule(http, sheetSchedule.scheduleId);
          if (cancelled) return;
          if (!match) {
            setRemote(null);
            setPhase('missing');
            return;
          }
        }
        setRemote(match);
        setPhase('ready');
      } catch (cause) {
        if (cancelled) return;
        setNote(describeError(cause));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [http, queryId, reload, sheetSchedule]);

  const zone = sheetSchedule?.timeZone || timeZone;
  const adminPaused = remote?.disabledReason === 'PAUSED_BY_ADMIN';
  const tabBlocked = tabState === 'none' || tabState === 'loading' || tabState === 'create';
  const canSave = phase !== 'loading' && phase !== 'unavailable' && !dirty && Boolean(projectId.trim()) && Boolean(fileId) && !tabBlocked && !busy;

  async function onSave() {
    if (!canSave) return;
    setBusy('save');
    setNote(null);
    try {
      const cron = frequency === 'weekly' ? weeklyCron(minute, hour, day) : dailyCron(minute, hour);
      const saved = await saveExportSchedule(http, {
        existingId: phase === 'missing' ? null : (remote?.id ?? null),
        queryId,
        cron,
        timeZone: zone,
        name: queryTitle,
      });
      await onSheetSchedule({
        scheduleId: saved.id,
        projectId: projectId.trim(),
        location: location.trim(),
        cron: saved.cron,
        timeZone: saved.timeZone || zone,
      });
      setRemote(saved);
      setPhase('ready');
    } catch (cause) {
      setNote(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function onToggle() {
    if (!remote || busy || adminPaused) return;
    setBusy('other');
    setNote(null);
    try {
      const next = remote.enabled
        ? await pauseExportSchedule(http, remote.id)
        : await resumeExportSchedule(http, remote.id);
      setRemote(next);
    } catch (cause) {
      setNote(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    const id = remote?.id ?? sheetSchedule?.scheduleId;
    if (!id || busy) return;
    setBusy('other');
    setNote(null);
    try {
      await deleteExportSchedule(http, id);
      await onSheetSchedule(null);
      setRemote(null);
      setPhase('ready');
    } catch (cause) {
      setNote(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function onRun() {
    if (!actions || !sheetSchedule || busy) return;
    setBusy('run');
    setNote(null);
    try {
      const started = await actions.start(EXPORT_SHEET_ACTION, { queryId });
      await actions.wait(started.id);
      await onRan();
      setReload(current => current + 1);
    } catch (cause) {
      setNote(describeError(cause));
      await onRan().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="schedule-block" aria-label="Schedule">
      <h3>Schedule</h3>
      <p className="history-note">
        OWOX runs the saved SQL and replaces this sheet. The schedule keeps the GCP project and location from the
        moment you save it.
      </p>
      {phase === 'unavailable' ? <p className="history-note">This OWOX deployment has no schedules.</p> : null}
      {phase === 'loading' ? <p className="history-note">Loading the schedule…</p> : null}
      {phase === 'missing' ? <p className="history-note">This schedule is no longer in OWOX. Save it again.</p> : null}
      {adminPaused ? <p className="history-note">A project admin paused this schedule in Plugins → Schedules.</p> : null}
      {phase !== 'unavailable' && phase !== 'loading' ? (
        <>
          {sheetSchedule ? (
            <p className="history-note">
              Runs in {sheetSchedule.projectId} (
              {sheetSchedule.location || 'BigQuery chooses the location'}).
            </p>
          ) : (
            <p className="history-note">Saving the schedule uses the project and location currently in the editor.</p>
          )}
          {parsed?.kind === 'custom' ? (
            <p className="history-note">This schedule uses {parsed.cron}. Saving replaces it with the choices below.</p>
          ) : null}
          <div className="schedule-grid">
            <label>
              Repeat
              <select
                aria-label="Repeat"
                value={frequency}
                disabled={busy !== null}
                onChange={event => setFrequency(event.target.value === 'weekly' ? 'weekly' : 'daily')}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label>
              Time zone
              <input aria-label="Time zone" value={zone} readOnly />
            </label>
            <label>
              Hour
              <select
                aria-label="Hour"
                value={hour}
                disabled={busy !== null}
                onChange={event => setHour(Number(event.target.value))}
              >
                {Array.from({ length: 24 }, (_, value) => (
                  <option key={value} value={value}>
                    {String(value).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minute
              <select
                aria-label="Minute"
                value={minute}
                disabled={busy !== null}
                onChange={event => setMinute(Number(event.target.value))}
              >
                {MINUTES.map(value => (
                  <option key={value} value={value}>
                    {String(value).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </label>
            {frequency === 'weekly' ? (
              <label>
                Day
                <select
                  aria-label="Day"
                  value={day}
                  disabled={busy !== null}
                  onChange={event => setDay(Number(event.target.value))}
                >
                  {WEEKDAYS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {dirty ? <p className="history-note">Save the query before scheduling it.</p> : null}
          {!projectId.trim() ? <p className="history-note">Set a GCP project before saving the schedule.</p> : null}
          {!fileId ? <p className="history-note">Choose a spreadsheet before saving the schedule.</p> : null}
          {tabState === 'create' || tabState === 'unknown' ? (
            <p className="history-note">The schedule replaces this sheet. Export once so the tab exists.</p>
          ) : null}
          {remote?.enabled && remote.nextRunAt ? (
            <p className="history-note">Next run {formatVersionTime(remote.nextRunAt)}.</p>
          ) : null}
          {remote && !remote.enabled && !adminPaused ? <p className="history-note">Paused.</p> : null}
          {scheduledExport ? (
            <p className={scheduledExport.status === 'error' ? 'banner' : 'history-note'} role={scheduledExport.status === 'error' ? 'alert' : 'status'}>
              Last run {formatVersionTime(scheduledExport.ranAt)}. {scheduledExport.message}
            </p>
          ) : null}
          {note ? (
            <p className="banner" role="alert">
              {note}
            </p>
          ) : null}
          <div className="schedule-actions">
            <button className="primary" type="button" disabled={!canSave} onClick={() => void onSave()}>
              {busy === 'save' ? 'Saving…' : 'Save schedule'}
            </button>
            {remote && !adminPaused ? (
              <button className="ghost" type="button" disabled={busy !== null} onClick={() => void onToggle()}>
                {remote.enabled ? 'Pause' : 'Resume'}
              </button>
            ) : null}
            {remote || sheetSchedule ? (
              <button className="ghost" type="button" disabled={busy !== null} onClick={() => void onRemove()}>
                Remove
              </button>
            ) : null}
            {actions && sheetSchedule ? (
              <button className="ghost" type="button" disabled={busy !== null} onClick={() => void onRun()}>
                {busy === 'run' ? 'Running…' : 'Run now'}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
