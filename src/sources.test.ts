import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadSqlSources, sourceFromDetail, type SqlSourceClient, type SqlSourceListItem } from './sources.ts';

const events = {
  id: 'events',
  title: 'Events',
  definitionType: 'TABLE',
  definition: { fullyQualifiedName: 'owox-marketing.analytics.events' },
  schema: {
    type: 'bigquery-data-mart-schema',
    fields: [
      { name: 'id', type: 'INT64', description: 'Event id' },
      { name: 'margin', type: 'FLOAT64', calculated: { formula: '1' } },
      { name: 'address', type: 'RECORD', fields: [{ name: 'city', type: 'STRING' }] },
    ],
  },
};

describe('sourceFromDetail', () => {
  it('reads a BigQuery table, keeps nested fields, and skips calculated fields', () => {
    const source = sourceFromDetail({ id: 'events', title: 'Events' }, events);
    assert.deepEqual(source, {
      id: 'events',
      title: 'Events',
      fullyQualifiedName: 'owox-marketing.analytics.events',
      fields: [
        { name: 'id', type: 'INT64', description: 'Event id', fields: [] },
        { name: 'address', type: 'RECORD', description: '', fields: [{ name: 'city', type: 'STRING', description: '', fields: [] }] },
      ],
    });
  });

  it('reads a view and a connector table', () => {
    assert.equal(
      sourceFromDetail({ id: 'view', title: 'View' }, { definitionType: 'VIEW', definition: { fullyQualifiedName: 'p.d.view' } })
        ?.fullyQualifiedName,
      'p.d.view',
    );
    assert.equal(
      sourceFromDetail(
        { id: 'connector', title: 'Ads' },
        { definitionType: 'CONNECTOR', definition: { connector: { storage: { fullyQualifiedName: 'p.d.ads' } } } },
      )?.fullyQualifiedName,
      'p.d.ads',
    );
  });

  it('ignores a SQL data mart and a table pattern', () => {
    assert.equal(sourceFromDetail({ id: 'sql', title: 'Query' }, { definitionType: 'SQL', definition: { sqlQuery: 'SELECT 1' } }), null);
    assert.equal(
      sourceFromDetail({ id: 'pattern', title: 'Shards' }, { definitionType: 'TABLE_PATTERN', definition: { pattern: 'p.d.events_' } }),
      null,
    );
  });

  it('keeps the table when the schema has not been saved', () => {
    const source = sourceFromDetail({ id: 'events', title: 'Events' }, { definitionType: 'TABLE', definition: { fullyQualifiedName: 'p.d.events' } });
    assert.deepEqual(source?.fields, []);
  });
});

describe('loadSqlSources', () => {
  it('loads BigQuery table, view, and connector details and skips the rest', async () => {
    const calls: string[] = [];
    const listed: SqlSourceListItem[] = [
      { id: 'events', title: 'Events', definitionType: 'TABLE', storage: { type: 'GOOGLE_BIGQUERY' } },
      { id: 'legacy', title: 'Legacy', definitionType: 'VIEW', storage: { type: 'LEGACY_GOOGLE_BIGQUERY' } },
      { id: 'ads', title: 'Ads', definitionType: 'CONNECTOR', storage: { type: 'GOOGLE_BIGQUERY' } },
      { id: 'query', title: 'Query', definitionType: 'SQL', storage: { type: 'GOOGLE_BIGQUERY' } },
      { id: 'athena', title: 'Athena', definitionType: 'TABLE', storage: { type: 'AWS_ATHENA' } },
      { id: 'broken', title: 'Broken', definitionType: 'TABLE', storage: { type: 'GOOGLE_BIGQUERY' } },
    ];
    const client: SqlSourceClient = {
      dataMarts: { list: async () => listed },
      getJson: async <T>(path: string): Promise<T> => {
        calls.push(path);
        if (path.endsWith('/broken')) throw new Error('missing');
        if (path.endsWith('/legacy')) return { definitionType: 'VIEW', definition: { fullyQualifiedName: 'p.d.legacy' } } as T;
        if (path.endsWith('/ads')) {
          return { definitionType: 'CONNECTOR', definition: { connector: { storage: { fullyQualifiedName: 'p.d.ads' } } } } as T;
        }
        return events as T;
      },
    };

    const sources = await loadSqlSources(client);
    assert.deepEqual(calls.sort(), [
      '/api/data-marts/ads',
      '/api/data-marts/broken',
      '/api/data-marts/events',
      '/api/data-marts/legacy',
    ]);
    assert.deepEqual(
      sources.map(source => source.fullyQualifiedName),
      ['p.d.ads', 'owox-marketing.analytics.events', 'p.d.legacy'],
    );
  });
});
