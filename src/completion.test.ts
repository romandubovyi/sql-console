import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quoteSqlPath, sqlCompletions } from './completion.ts';
import type { SqlSource } from './sources.ts';

const events: SqlSource = {
  id: 'events',
  title: 'Revenue',
  fullyQualifiedName: 'owox-marketing.analytics.events',
  fields: [
    { name: 'name', type: 'STRING', description: 'Event name', fields: [] },
    { name: 'id', type: 'INT64', description: '', fields: [] },
    {
      name: 'address',
      type: 'RECORD',
      description: '',
      fields: [{ name: 'city', type: 'STRING', description: 'City', fields: [] }],
    },
  ],
};

const orders: SqlSource = {
  id: 'orders',
  title: 'Orders',
  fullyQualifiedName: 'billing.shop.orders',
  fields: [{ name: 'id', type: 'INT64', description: '', fields: [] }],
};

function labelsAt(sql: string, needle: string): string[] {
  const offset = sql.indexOf(needle) + needle.length;
  return sqlCompletions([events, orders], sql, offset).map(item => item.label);
}

describe('quoteSqlPath', () => {
  it('quotes a path segment that BigQuery would not accept bare', () => {
    assert.equal(quoteSqlPath('owox-marketing.analytics.events'), '`owox-marketing`.analytics.events');
    assert.equal(quoteSqlPath('billing.shop.orders'), 'billing.shop.orders');
  });
});

describe('sqlCompletions', () => {
  it('suggests tables after FROM and JOIN, including a partially typed path', () => {
    assert.deepEqual(labelsAt('SELECT * FROM ', 'FROM '), ['billing.shop.orders', 'owox-marketing.analytics.events']);

    const sql = 'SELECT * FROM owox-marketing.analytics.ev';
    const items = sqlCompletions([events, orders], sql, sql.length);
    assert.deepEqual(items.map(item => item.label), ['owox-marketing.analytics.events']);
    assert.equal(sql.slice(items[0]?.start, items[0]?.end), 'owox-marketing.analytics.ev');
    assert.equal(items[0]?.insertText, '`owox-marketing`.analytics.events');
    assert.equal(items[0]?.detail, 'Revenue');

    assert.deepEqual(labelsAt('SELECT * FROM billing.shop.orders JOIN ', 'JOIN '), ['billing.shop.orders', 'owox-marketing.analytics.events']);
  });

  it('suggests a data mart by its title', () => {
    assert.deepEqual(labelsAt('FROM Rev', 'Rev'), ['owox-marketing.analytics.events']);
  });

  it('suggests fields of tables already named in the query', () => {
    const sql = 'SELECT na FROM analytics.events';
    const items = sqlCompletions([events, orders], sql, sql.indexOf('na') + 2);
    assert.equal(items[0]?.label, 'name');
    assert.equal(items[0]?.detail, 'STRING · Revenue');
    assert.equal(items[0]?.documentation, 'Event name');
    assert.equal(sql.slice(items[0]?.start, items[0]?.end), 'na');
    assert.deepEqual(labelsAt('SELECT  FROM analytics.events', 'SELECT '), ['address', 'id', 'name']);
    assert.deepEqual(labelsAt('SELECT id,  FROM analytics.events', 'id, '), ['address', 'id', 'name']);
  });

  it('uses the table qualifier, alias, and nested fields', () => {
    assert.deepEqual(labelsAt('SELECT orders.id, events.na FROM analytics.events, shop.orders', 'events.na'), ['name']);
    assert.deepEqual(labelsAt('SELECT na FROM owox-marketing.analytics.events', 'SELECT na'), ['name']);
    assert.deepEqual(labelsAt('SELECT e.ci FROM analytics.events AS e', 'e.ci'), []);
    assert.deepEqual(labelsAt('SELECT e.address.ci FROM analytics.events AS e', 'e.address.ci'), ['city']);
    assert.deepEqual(labelsAt('SELECT address.ci FROM analytics.events', 'address.ci'), ['city']);
  });

  it('suggests fields in WHERE and after GROUP BY', () => {
    assert.deepEqual(labelsAt('SELECT id FROM analytics.events WHERE na', 'WHERE na'), ['name']);
    assert.deepEqual(labelsAt('SELECT id FROM analytics.events GROUP BY na', 'BY na'), ['name']);
  });

  it('does not suggest inside a string or comment, or before a table is named', () => {
    assert.deepEqual(labelsAt("SELECT 'FROM secret' ", 'secret'), []);
    assert.deepEqual(labelsAt('-- FROM analytics.events\nSELECT ', 'SELECT '), []);
    assert.deepEqual(labelsAt('SELECT na', 'SELECT na'), []);
    assert.deepEqual(labelsAt('SELECT id FROM analytics.events LIMIT ', 'LIMIT '), []);
  });
});
