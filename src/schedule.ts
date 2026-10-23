export const EXPORT_SHEET_ACTION = 'export-sheet';

const SCHEDULES_PATH = '/api/plugins/runtime/schedules';
const DAILY_CRON = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const WEEKLY_CRON = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/;

export type SchedulePreset =
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; day: number }
  | { kind: 'custom'; cron: string };

export interface ScheduleHttp {
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  patchJson<T>(path: string, body: unknown): Promise<T>;
  deleteJson<T = void>(path: string): Promise<T>;
}

export interface RemoteSchedule {
  id: string;
  name: string | null;
  action: string;
  parameters: unknown;
  cron: string;
  timeZone: string;
  enabled: boolean;
  disabledReason: 'ACTION_NOT_DECLARED' | 'INVALID_PARAMETERS' | 'PAUSED_BY_ADMIN' | null;
  nextRunAt: string | null;
}

export function dailyCron(minute: number, hour: number): string {
  return `${minute} ${hour} * * *`;
}

export function weeklyCron(minute: number, hour: number, day: number): string {
  return `${minute} ${hour} * * ${day}`;
}

export function parseScheduleCron(cron: string): SchedulePreset {
  const daily = DAILY_CRON.exec(cron);
  if (daily) {
    const minute = Number(daily[1]);
    const hour = Number(daily[2]);
    if (isQuarterHour(minute, hour)) return { kind: 'daily', minute, hour };
  }
  const weekly = WEEKLY_CRON.exec(cron);
  if (weekly) {
    const minute = Number(weekly[1]);
    const hour = Number(weekly[2]);
    const day = Number(weekly[3]);
    if (isQuarterHour(minute, hour) && day <= 6) return { kind: 'weekly', minute, hour, day };
  }
  return { kind: 'custom', cron };
}

export function parameterQueryId(parameters: unknown): string | null {
  if (typeof parameters !== 'object' || parameters === null || !('queryId' in parameters)) return null;
  const queryId = parameters.queryId;
  return typeof queryId === 'string' && queryId ? queryId : null;
}

export function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

export async function listExportSchedules(http: ScheduleHttp): Promise<RemoteSchedule[] | 'unavailable'> {
  try {
    const body = await http.getJson<{ schedules?: unknown }>(SCHEDULES_PATH);
    if (!Array.isArray(body?.schedules)) return 'unavailable';
    return body.schedules.flatMap(item => {
      const schedule = remoteSchedule(item);
      return schedule ? [schedule] : [];
    });
  } catch (error) {
    if (isNotFound(error)) return 'unavailable';
    throw error;
  }
}

export async function getExportSchedule(http: ScheduleHttp, id: string): Promise<RemoteSchedule | null> {
  try {
    return remoteSchedule(await http.getJson<unknown>(schedulePath(id)));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function saveExportSchedule(
  http: ScheduleHttp,
  input: { existingId: string | null; queryId: string; cron: string; timeZone: string; name: string },
): Promise<RemoteSchedule> {
  const body = {
    action: EXPORT_SHEET_ACTION,
    parameters: { queryId: input.queryId },
    cron: input.cron,
    timeZone: input.timeZone,
    name: input.name.trim().slice(0, 200),
  };
  const saved = input.existingId
    ? await http.patchJson<unknown>(schedulePath(input.existingId), body)
    : await http.postJson<unknown>(SCHEDULES_PATH, body);
  const schedule = remoteSchedule(saved);
  if (!schedule) throw new Error('OWOX did not return the schedule.');
  return schedule;
}

export async function pauseExportSchedule(http: ScheduleHttp, id: string): Promise<RemoteSchedule> {
  return requiredSchedule(await http.postJson<unknown>(`${schedulePath(id)}/pause`, {}));
}

export async function resumeExportSchedule(http: ScheduleHttp, id: string): Promise<RemoteSchedule> {
  return requiredSchedule(await http.postJson<unknown>(`${schedulePath(id)}/resume`, {}));
}

export async function deleteExportSchedule(http: ScheduleHttp, id: string): Promise<void> {
  try {
    await http.deleteJson(schedulePath(id));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

export function scheduleForQuery(schedules: readonly RemoteSchedule[], queryId: string, scheduleId: string | null): RemoteSchedule | null {
  const matches = schedules.filter(
    schedule => schedule.action === EXPORT_SHEET_ACTION && parameterQueryId(schedule.parameters) === queryId,
  );
  if (scheduleId) return matches.find(schedule => schedule.id === scheduleId) ?? matches[0] ?? null;
  return matches[0] ?? null;
}

function requiredSchedule(value: unknown): RemoteSchedule {
  const schedule = remoteSchedule(value);
  if (!schedule) throw new Error('OWOX did not return the schedule.');
  return schedule;
}

function remoteSchedule(value: unknown): RemoteSchedule | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.action !== 'string' || typeof record.cron !== 'string') return null;
  const reason = record.disabledReason;
  const disabledReason =
    reason === 'ACTION_NOT_DECLARED' || reason === 'INVALID_PARAMETERS' || reason === 'PAUSED_BY_ADMIN' ? reason : null;
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : null,
    action: record.action,
    parameters: record.parameters,
    cron: record.cron,
    timeZone: typeof record.timeZone === 'string' ? record.timeZone : '',
    enabled: record.enabled === true,
    disabledReason,
    nextRunAt: typeof record.nextRunAt === 'string' ? record.nextRunAt : null,
  };
}

function schedulePath(id: string): string {
  return `${SCHEDULES_PATH}/${encodeURIComponent(id)}`;
}

function isQuarterHour(minute: number, hour: number): boolean {
  return hour >= 0 && hour <= 23 && (minute === 0 || minute === 15 || minute === 30 || minute === 45);
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('payload' in error && typeof error.payload === 'object' && error.payload !== null && 'status' in error.payload) {
    const status = error.payload.status;
    if (typeof status === 'number') return status;
  }
  return null;
}
