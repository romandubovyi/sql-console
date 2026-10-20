import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSqlDataMart, dataMartPath, dataMartTitle } from './data-mart.ts';

describe('dataMartTitle', () => {
  it('uses the query name and keeps a title inside the column limit', () => {
    assert.equal(dataMartTitle('  Revenue  '), 'Revenue');
    assert.equal(dataMartTitle('   '), 'Untitled query');
    assert.equal(dataMartTitle('a'.repeat(300)).length, 255);
  });
});

describe('dataMartPath', () => {
  it('opens the data setup page of the new data mart', () => {
    assert.equal(dataMartPath('project 1', 'mart/1'), '/ui/project%201/data-marts/mart%2F1/data-setup');
  });
});

describe('createSqlDataMart', () => {
  it('creates the data mart on the chosen storage and copies the SQL and description', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const created = await createSqlDataMart(client(calls, { id: 'mart-1' }), {
      title: 'Revenue',
      storageId: 'storage-1',
      sql: 'SELECT 1',
      description: '# Daily',
    });
    assert.deepEqual(created, { id: 'mart-1', title: 'Revenue', descriptionSaved: true });
    assert.deepEqual(calls, [
      { method: 'POST', path: '/api/data-marts', body: { title: 'Revenue', storageId: 'storage-1' } },
      {
        method: 'PUT',
        path: '/api/data-marts/mart-1/definition',
        body: { definitionType: 'SQL', definition: { sqlQuery: 'SELECT 1' } },
      },
      { method: 'PUT', path: '/api/data-marts/mart-1/description', body: { description: '# Daily' } },
    ]);
  });

  it('skips an empty description', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const created = await createSqlDataMart(client(calls, { id: 'mart-1' }), {
      title: 'Revenue',
      storageId: 'storage-1',
      sql: 'SELECT 1',
      description: '   ',
    });
    assert.equal(created.descriptionSaved, true);
    assert.equal(calls.some(call => call.path.endsWith('/description')), false);
  });

  it('removes the data mart when the SQL cannot be saved', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    await assert.rejects(
      createSqlDataMart(client(calls, { id: 'mart-1' }, true), {
        title: 'Revenue',
        storageId: 'storage-1',
        sql: 'SELECT 1',
        description: '',
      }),
      /definition failed/,
    );
    assert.deepEqual(
      calls.map(call => `${call.method} ${call.path}`),
      ['POST /api/data-marts', 'PUT /api/data-marts/mart-1/definition', 'DELETE /api/data-marts/mart-1'],
    );
  });

  it('requires a storage and a query before calling the API', async () => {
    const calls: { method: string; path: string }[] = [];
    await assert.rejects(
      createSqlDataMart(client(calls, { id: 'mart-1' }), {
        title: 'Revenue',
        storageId: '  ',
        sql: 'SELECT 1',
        description: '',
      }),
      /Choose a storage/,
    );
    await assert.rejects(
      createSqlDataMart(client(calls, { id: 'mart-1' }), {
        title: 'Revenue',
        storageId: 'storage-1',
        sql: '  ',
        description: '',
      }),
      /Write a SQL query/,
    );
    assert.equal(calls.length, 0);
  });

  it('keeps the data mart when only the description copy fails', async () => {
    const calls: { method: string; path: string }[] = [];
    const created = await createSqlDataMart(client(calls, { id: 'mart-1' }, false, true), {
      title: 'Revenue',
      storageId: 'storage-1',
      sql: 'SELECT 1',
      description: 'Notes',
    });
    assert.deepEqual(created, { id: 'mart-1', title: 'Revenue', descriptionSaved: false });
    assert.equal(calls.some(call => call.method === 'DELETE'), false);
  });
});

function client(
  calls: { method: string; path: string; body?: unknown }[],
  created: { id: string },
  failDefinition = false,
  failDescription = false,
) {
  return {
    async postJson<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'POST', path, body });
      return created as T;
    },
    async putJson<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'PUT', path, body });
      if (path.endsWith('/definition') && failDefinition) throw new Error('definition failed');
      if (path.endsWith('/description') && failDescription) throw new Error('description failed');
      return undefined as T;
    },
    async deleteJson<T>(path: string): Promise<T> {
      calls.push({ method: 'DELETE', path });
      return undefined as T;
    },
  };
}
