import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadImportCatalog, readDataMartSql, readReportSql, replaceDataMartSql, type ImportClient, type ImportListItem } from './sql-import.ts';

const MART = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';

function item(patch: Partial<ImportListItem> & Pick<ImportListItem, 'id' | 'title'>): ImportListItem {
  return {
    definitionType: 'SQL',
    storage: { type: 'GOOGLE_BIGQUERY' },
    reportsCount: 0,
    ...patch,
  };
}

describe('loadImportCatalog', () => {
  it('lists SQL data marts and the reports on BigQuery marts', async () => {
    const calls: string[] = [];
    const client = {
      dataMarts: {
        async list() {
          return [
            item({ id: 'table-mart', title: 'Events', definitionType: 'TABLE', reportsCount: 1 }),
            item({ id: MART, title: 'Revenue' }),
            item({ id: 'athena', title: 'Athena', storage: { type: 'AWS_ATHENA' }, reportsCount: 2 }),
            item({ id: 'empty-sql', title: 'Draft', reportsCount: 0 }),
          ];
        },
      },
      async getJson(path: string) {
        calls.push(path);
        if (path.includes('table-mart')) return [{ id: REPORT, title: 'Weekly' }];
        throw new Error(`unexpected ${path}`);
      },
      async putJson() {
        throw new Error('unused');
      },
    } as ImportClient;
    const catalog = await loadImportCatalog(client);
    assert.deepEqual(
      catalog.marts.map(mart => mart.title),
      ['Draft', 'Revenue'],
    );
    assert.deepEqual(catalog.reports, [
      { id: REPORT, title: 'Weekly', dataMartId: 'table-mart', dataMartTitle: 'Events' },
    ]);
    assert.deepEqual(calls, ['/api/reports/data-mart/table-mart']);
  });
});

describe('read and replace SQL', () => {
  it('reads a data mart query and the SQL a report will run', async () => {
    const client = {
      dataMarts: { async list() { return []; } },
      async getJson(path: string) {
        if (path.includes('/generated-sql')) return { sql: 'SELECT 2', canModifySource: false };
        return { definitionType: 'SQL', definition: { sqlQuery: 'SELECT 1' } };
      },
      async putJson() {
        throw new Error('unused');
      },
    } as ImportClient;
    assert.equal(await readDataMartSql(client, MART), 'SELECT 1');
    assert.equal(await readReportSql(client, REPORT), 'SELECT 2');
    const tableMart = {
      ...client,
      async getJson() {
        return { definitionType: 'TABLE', definition: {} };
      },
    } as ImportClient;
    await assert.rejects(() => readDataMartSql(tableMart, MART), /no SQL to import/);
  });

  it('replaces only the SQL definition of the imported data mart', async () => {
    let body: unknown;
    const client = {
      dataMarts: { async list() { return []; } },
      async getJson() {
        throw new Error('unused');
      },
      async putJson(_path: string, next: unknown) {
        body = next;
        return {};
      },
    } as ImportClient;
    await replaceDataMartSql(client, MART, 'SELECT 3');
    assert.deepEqual(body, { definitionType: 'SQL', definition: { sqlQuery: 'SELECT 3' } });
    await assert.rejects(() => replaceDataMartSql(client, MART, '  '), /Write a SQL query/);
  });
});
