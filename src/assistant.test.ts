import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendChatMessage,
  buildAiChatInput,
  emptyChatThread,
  MAX_THREAD_MESSAGES,
  normalizeChatThread,
  segmentReply,
  toAiMessages,
} from './assistant.ts';

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
    const input = buildAiChatInput('SELECT d FROM t', thread, { description: 'Note', result });
    assert.equal(input?.description, 'Note');
    assert.deepEqual(input?.result, result);
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
