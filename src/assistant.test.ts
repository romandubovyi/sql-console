import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendChatMessage,
  buildAiChatInput,
  buildSourcesContext,
  emptyChatThread,
  MAX_CONTEXT_SOURCES,
  MAX_SOURCE_FIELDS,
  MAX_THREAD_MESSAGES,
  normalizeChatThread,
  segmentReply,
  toAiMessages,
} from './assistant.ts';
import type { SqlSource } from './sources.ts';

function source(fqn: string, title: string, fields: SqlSource['fields'] = []): SqlSource {
  return { id: fqn, title, fullyQualifiedName: fqn, fields };
}

describe('normalizeChatThread', () => {
  test('accepts a stored thread and drops malformed entries', () => {
    const thread = normalizeChatThread({
      messages: [
        { role: 'user', content: 'hi', at: '2026-10-23T10:00:00Z' },
        { role: 'assistant', content: 'hello', at: 'not-a-date' },
        { role: 'system', content: 'x', at: '2026-10-23T10:01:00Z' },
        { role: 'user', content: '  ', at: '2026-10-23T10:02:00Z' },
        'nope',
      ],
    });
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[0].role, 'user');
    assert.equal(thread.messages[1].at, '');
  });

  test('returns an empty thread for non-documents', () => {
    assert.deepEqual(normalizeChatThread(null), { messages: [] });
    assert.deepEqual(normalizeChatThread('x'), { messages: [] });
    assert.deepEqual(normalizeChatThread({}), { messages: [] });
  });

  test('keeps only the newest messages', () => {
    const messages = Array.from({ length: MAX_THREAD_MESSAGES + 5 }, (_, index) => ({
      role: 'user',
      content: `m${index}`,
      at: '2026-10-23T10:00:00Z',
    }));
    const thread = normalizeChatThread({ messages });
    assert.equal(thread.messages.length, MAX_THREAD_MESSAGES);
    assert.equal(thread.messages[0].content, 'm5');
  });
});

describe('appendChatMessage', () => {
  test('appends and trims to the limit', () => {
    let thread = emptyChatThread();
    for (let index = 0; index < MAX_THREAD_MESSAGES + 1; index += 1) {
      thread = appendChatMessage(thread, {
        role: 'user',
        content: `m${index}`,
        at: '2026-10-23T10:00:00Z',
      });
    }
    assert.equal(thread.messages.length, MAX_THREAD_MESSAGES);
    assert.equal(thread.messages[0].content, 'm1');
  });
});

describe('buildAiChatInput', () => {
  test('maps the thread into action input and requires a trailing user message', () => {
    const thread = normalizeChatThread({
      messages: [
        { role: 'user', content: 'a', at: '2026-10-23T10:00:00Z' },
        { role: 'assistant', content: 'b', at: '2026-10-23T10:01:00Z' },
        { role: 'user', content: 'c', at: '2026-10-23T10:02:00Z' },
      ],
    });
    const input = buildAiChatInput('SELECT 1', thread);
    assert.deepEqual(input, {
      sql: 'SELECT 1',
      description: '',
      result: null,
      sources: [],
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    assert.equal(
      buildAiChatInput('SELECT 1', { messages: [{ role: 'assistant', content: 'b', at: '' }] }),
      null,
    );
  });

  test('carries the description and a result sample into the action input', () => {
    const thread = normalizeChatThread({
      messages: [{ role: 'user', content: 'a', at: '2026-10-23T10:00:00Z' }],
    });
    const result = { columns: ['d'], rows: [['2026-10-23']], totalRows: 1 };
    const input = buildAiChatInput('SELECT d FROM t', thread, { description: 'Note', result, sources: [] });
    assert.equal(input?.description, 'Note');
    assert.deepEqual(input?.result, result);
  });
});

describe('buildSourcesContext', () => {
  test('puts the tables the SQL touches first', () => {
    const sources = [
      source('proj.ds.other_table', 'Other'),
      source('proj.ds.events', 'Events'),
      source('proj.ds.sessions', 'Sessions'),
    ];
    const picked = buildSourcesContext('SELECT * FROM `proj.ds.events` e JOIN proj.ds.sessions s ON 1=1', sources);
    assert.deepEqual(
      picked.map(item => item.name),
      ['proj.ds.events', 'proj.ds.sessions', 'proj.ds.other_table'],
    );
  });

  test('matches a bare table name and flattens record fields', () => {
    const sources = [
      source('proj.ds.events', 'Events', [
        { name: 'd', type: 'DATE', description: '', fields: [] },
        {
          name: 'geo',
          type: 'RECORD',
          description: '',
          fields: [{ name: 'country', type: 'STRING', description: '', fields: [] }],
        },
      ]),
    ];
    const picked = buildSourcesContext('SELECT d FROM events', sources);
    assert.deepEqual(picked[0].fields, [
      { name: 'd', type: 'DATE', description: '' },
      { name: 'geo', type: 'RECORD', description: '' },
      { name: 'geo.country', type: 'STRING', description: '' },
    ]);
  });

  test('caps the source count and the fields per source', () => {
    const many = Array.from({ length: MAX_CONTEXT_SOURCES + 5 }, (_, index) =>
      source(`proj.ds.t${index}`, `T${index}`),
    );
    assert.equal(buildSourcesContext('SELECT 1 FROM proj.ds.t1', many).length, MAX_CONTEXT_SOURCES);
    const wide = source('proj.ds.wide', 'Wide', [
      ...Array.from({ length: MAX_SOURCE_FIELDS + 10 }, (_, index) => ({
        name: `f${index}`,
        type: 'STRING',
        description: '',
        fields: [],
      })),
    ]);
    assert.equal(buildSourcesContext('SELECT 1 FROM proj.ds.wide', [wide])[0].fields.length, MAX_SOURCE_FIELDS);
  });

  test('returns nothing for empty SQL or an empty catalog', () => {
    assert.deepEqual(buildSourcesContext('', [source('proj.ds.t', 'T')]), []);
    assert.deepEqual(buildSourcesContext('SELECT 1', []), []);
  });
});

describe('toAiMessages', () => {
  test('strips the timestamp', () => {
    const thread = normalizeChatThread({
      messages: [{ role: 'user', content: 'a', at: '2026-10-23T10:00:00Z' }],
    });
    assert.deepEqual(toAiMessages(thread), [{ role: 'user', content: 'a' }]);
  });
});

describe('segmentReply', () => {
  test('returns plain text as one segment', () => {
    assert.deepEqual(segmentReply('Just text.'), [{ kind: 'text', text: 'Just text.' }]);
    assert.deepEqual(segmentReply('  '), []);
  });

  test('splits a reply around a sql block', () => {
    const segments = segmentReply('Here is the fix:\n```sql\nSELECT 1\n```\nRun it.');
    assert.deepEqual(segments, [
      { kind: 'text', text: 'Here is the fix:' },
      { kind: 'sql', sql: 'SELECT 1' },
      { kind: 'text', text: 'Run it.' },
    ]);
  });

  test('handles multiple sql blocks and an unclosed trailing fence', () => {
    const segments = segmentReply('```sql\nSELECT 1\n```\nmid\n```sql\nSELECT 2');
    assert.deepEqual(segments, [
      { kind: 'sql', sql: 'SELECT 1' },
      { kind: 'text', text: 'mid' },
      { kind: 'sql', sql: 'SELECT 2' },
    ]);
  });

  test('keeps non-sql fences as text', () => {
    const segments = segmentReply('```json\n{"a":1}\n```');
    assert.deepEqual(segments, [{ kind: 'text', text: '{"a":1}' }]);
  });

  test('matches the sql language case-insensitively', () => {
    const segments = segmentReply('```SQL\nSELECT 3\n```');
    assert.deepEqual(segments, [{ kind: 'sql', sql: 'SELECT 3' }]);
  });
});
