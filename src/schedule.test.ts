import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dailyCron,
  deleteExportSchedule,
  listExportSchedules,
  parseScheduleCron,
  saveExportSchedule,
  weeklyCron,
  type ScheduleHttp,
} from './schedule.ts';

function missing(): Error {
  return Object.assign(new Error('missing'), { payload: { status: 404, code: 'HTTP_ERROR', message: 'Cannot GET' } });
}

describe('parseScheduleCron', () => {
  it('reads a daily or weekly quarter-hour preset', () => {
    assert.deepEqual(parseScheduleCron(dailyCron(0, 9)), { kind: 'daily', minute: 0, hour: 9 });
    assert.deepEqual(parseScheduleCron(weeklyCron(15, 9, 1)), { kind: 'weekly', minute: 15, hour: 9, day: 1 });
    assert.equal(dailyCron(0, 9), '0 9 * * *');
    assert.equal(weeklyCron(15, 9, 1), '15 9 * * 1');
  });

  it('leaves any other expression unchanged', () => {
    assert.deepEqual(parseScheduleCron('5 9 * * *'), { kind: 'custom', cron: '5 9 * * *' });
    assert.deepEqual(parseScheduleCron('0 9 * * 7'), { kind: 'custom', cron: '0 9 * * 7' });
  });
});

describe('schedule http', () => {
  it('treats a missing schedules route as unavailable', async () => {
    const http = {
      getJson: async () => {
        throw missing();
      },
      postJson: async () => ({}),
      patchJson: async () => ({}),
      deleteJson: async () => undefined,
    } as ScheduleHttp;
    assert.equal(await listExportSchedules(http), 'unavailable');
  });

  it('creates a schedule whose only parameter is the query id', async () => {
    let body: unknown;
    const http = {
      getJson: async () => ({ schedules: [] }),
      postJson: async (_path, json) => {
        body = json;
        return { id: '11111111-1111-4111-8111-111111111111', action: 'export-sheet', parameters: json, cron: '0 9 * * *', timeZone: 'Europe/Kyiv', enabled: true, disabledReason: null, nextRunAt: null, name: 'Revenue' };
      },
      patchJson: async () => ({}),
      deleteJson: async () => undefined,
    } as ScheduleHttp;
    const saved = await saveExportSchedule(http, {
      existingId: null,
      queryId: 'query-1',
      cron: '0 9 * * *',
      timeZone: 'Europe/Kyiv',
      name: 'Revenue',
    });
    assert.equal(saved.id, '11111111-1111-4111-8111-111111111111');
    assert.deepEqual(body, {
      action: 'export-sheet',
      parameters: { queryId: 'query-1' },
      cron: '0 9 * * *',
      timeZone: 'Europe/Kyiv',
      name: 'Revenue',
    });
  });

  it('ignores a schedule that was already removed', async () => {
    const http = {
      getJson: async () => ({}),
      postJson: async () => ({}),
      patchJson: async () => ({}),
      deleteJson: async () => {
        throw missing();
      },
    } as ScheduleHttp;
    await deleteExportSchedule(http, '11111111-1111-4111-8111-111111111111');
  });
});
