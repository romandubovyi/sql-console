import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AiChatError,
  anthropicErrorInfo,
  buildAnthropicBody,
  CLAUDE_MODEL,
  MAX_CHAT_MESSAGES,
  MAX_OUTPUT_TOKENS,
  MAX_SQL_CHARS,
  normalizeAiChatInput,
  parseAnthropicReply,
  runAiChat,
  SYSTEM_PROMPT,
} from './ai-chat.ts';

describe('normalizeAiChatInput', () => {
  test('accepts a well-formed request', () => {
    const input = normalizeAiChatInput({
      sql: 'SELECT 1',
      description: 'Daily revenue note',
      result: { columns: ['d', 'revenue'], rows: [['2026-10-23', '42']], totalRows: 1 },
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'add a limit' },
      ],
    });
    assert.deepEqual(input, {
      sql: 'SELECT 1',
      description: 'Daily revenue note',
      result: { columns: ['d', 'revenue'], rows: [['2026-10-23', '42']], totalRows: 1 },
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'add a limit' },
      ],
    });
  });

  test('defaults the optional context fields', () => {
    const input = normalizeAiChatInput({ sql: 'SELECT 1', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(input?.description, '');
    assert.equal(input?.result, null);
  });

  test('drops a malformed result sample instead of failing the request', () => {
    const input = normalizeAiChatInput({
      sql: 'SELECT 1',
      result: { columns: [] },
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(input?.result, null);
    const withoutColumns = normalizeAiChatInput({
      sql: 'SELECT 1',
      result: { rows: [['a']] },
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(withoutColumns?.result, null);
  });

  test('rejects malformed requests', () => {
    assert.equal(normalizeAiChatInput(null), null);
    assert.equal(normalizeAiChatInput('nope'), null);
    assert.equal(normalizeAiChatInput({ sql: 1, messages: [] }), null);
    assert.equal(normalizeAiChatInput({ sql: 'SELECT 1', messages: [] }), null);
    assert.equal(
      normalizeAiChatInput({ sql: 'SELECT 1', messages: [{ role: 'system', content: 'x' }] }),
      null,
    );
    assert.equal(
      normalizeAiChatInput({ sql: 'SELECT 1', messages: [{ role: 'assistant', content: 'x' }] }),
      null,
    );
    assert.equal(
      normalizeAiChatInput({ sql: 'SELECT 1', messages: [{ role: 'user', content: 5 }] }),
      null,
    );
  });

  test('caps the sql and keeps the newest messages', () => {
    const many = Array.from({ length: MAX_CHAT_MESSAGES + 11 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `m${index}`,
    }));
    const input = normalizeAiChatInput({ sql: 'x'.repeat(MAX_SQL_CHARS + 1), messages: many });
    assert.equal(input?.sql.length, MAX_SQL_CHARS);
    assert.equal(input?.messages.length, MAX_CHAT_MESSAGES);
    assert.equal(input?.messages[0].content, 'm11');
  });
});

describe('buildAnthropicBody', () => {
  test('puts the current SQL into the latest user message and keeps the model settings', () => {
    const body = buildAnthropicBody({
      sql: 'SELECT 1',
      description: '',
      result: null,
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'now add a filter' },
      ],
    });
    assert.equal(body.model, CLAUDE_MODEL);
    assert.equal(body.max_tokens, MAX_OUTPUT_TOKENS);
    assert.equal(body.system, SYSTEM_PROMPT);
    assert.deepEqual(body.messages.map(message => message.role), ['user', 'assistant', 'user']);
    assert.equal(body.messages[0].content, 'first');
    assert.equal(body.messages[1].content, 'answer');
    assert.ok(body.messages[2].content.includes('```sql\nSELECT 1\n```'));
    assert.ok(body.messages[2].content.endsWith('now add a filter'));
  });

  test('handles a single-message thread', () => {
    const body = buildAnthropicBody({
      sql: 'SELECT 2',
      description: '',
      result: null,
      messages: [{ role: 'user', content: 'explain' }],
    });
    assert.equal(body.messages.length, 1);
    assert.ok(body.messages[0].content.startsWith('Current SQL in the editor:'));
  });

  test('adds the note and a result sample for the assistant to read', () => {
    const body = buildAnthropicBody({
      sql: 'SELECT d, revenue FROM t',
      description: 'Revenue per day',
      result: {
        columns: ['d', 'revenue'],
        rows: [
          ['2026-10-22', '10'],
          ['2026-10-23', '42'],
        ],
        totalRows: 120,
      },
      messages: [{ role: 'user', content: 'what changed on the 23rd?' }],
    });
    const content = body.messages[0].content;
    assert.ok(content.includes("The member's note about this query:\nRevenue per day"));
    assert.ok(content.includes('2 sample rows of 120.'));
    assert.ok(content.includes('| d | revenue |'));
    assert.ok(content.includes('| 2026-10-23 | 42 |'));
    assert.ok(content.endsWith('what changed on the 23rd?'));
  });

  test('lists the columns when no sample rows are available', () => {
    const body = buildAnthropicBody({
      sql: 'SELECT 1',
      description: '',
      result: { columns: ['a', 'b'], rows: [], totalRows: null },
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.ok(body.messages[0].content.includes('returns these columns: a, b.'));
  });

  test('truncates long cell values in the rendered table', () => {
    const body = buildAnthropicBody({
      sql: 'SELECT 1',
      description: '',
      result: { columns: ['txt'], rows: [['x'.repeat(500)]], totalRows: null },
      messages: [{ role: 'user', content: 'hi' }],
    });
    const content = body.messages[0].content;
    assert.ok(content.includes(`${'x'.repeat(80)}…`));
    assert.ok(!content.includes('x'.repeat(200)));
  });
});

describe('parseAnthropicReply', () => {
  test('joins text blocks', () => {
    assert.equal(
      parseAnthropicReply({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
      'ab',
    );
  });

  test('throws on empty or unexpected content', () => {
    assert.throws(() => parseAnthropicReply({ content: [] }), AiChatError);
    assert.throws(() => parseAnthropicReply({ content: [{ type: 'tool_use' }] }), AiChatError);
    assert.throws(() => parseAnthropicReply({}), AiChatError);
  });
});

describe('anthropicErrorInfo', () => {
  test('maps status codes to stable codes', () => {
    assert.equal(anthropicErrorInfo(401, {}).code, 'ANTHROPIC_AUTH');
    assert.equal(anthropicErrorInfo(403, {}).code, 'ANTHROPIC_AUTH');
    assert.equal(anthropicErrorInfo(429, {}).code, 'ANTHROPIC_RATE_LIMIT');
    assert.equal(anthropicErrorInfo(529, {}).code, 'ANTHROPIC_OVERLOADED');
    assert.equal(anthropicErrorInfo(500, {}).code, 'ANTHROPIC_FAILED');
  });

  test('surfaces the provider message when present', () => {
    const info = anthropicErrorInfo(400, { error: { type: 'invalid_request_error', message: 'too long' } });
    assert.equal(info.code, 'ANTHROPIC_FAILED');
    assert.ok(info.message.includes('too long'));
  });
});

describe('runAiChat', () => {
  const validInput = { sql: 'SELECT 1', messages: [{ role: 'user', content: 'hi' }] };

  test('posts the messages request and returns the reply', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello!' }] }), { status: 200 });
    };
    const result = await runAiChat({ fetchImpl, input: validInput });
    assert.deepEqual(result, { reply: 'Hello!' });
    assert.equal(calls[0].method, 'POST');
    const headers = calls[0].headers as Record<string, string>;
    assert.equal(headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(String(calls[0].body));
    assert.equal(body.model, CLAUDE_MODEL);
  });

  test('throws a coded error when Anthropic rejects the request', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'invalid' } }), { status: 401 });
    const error = await runAiChat({ fetchImpl, input: validInput }).catch(cause => cause);
    assert.ok(error instanceof AiChatError);
    assert.equal(error.code, 'ANTHROPIC_AUTH');
  });

  test('rejects malformed input before calling Anthropic', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response('{}');
    };
    await assert.rejects(() => runAiChat({ fetchImpl, input: { sql: 1 } }), AiChatError);
    assert.equal(called, false);
  });
});
