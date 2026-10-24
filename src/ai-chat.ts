export const CLAUDE_MODEL = 'claude-sonnet-4-5';
export const MAX_OUTPUT_TOKENS = 8192;

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const MAX_SQL_CHARS = 100000;
export const MAX_CHAT_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 30000;
const MAX_REPLY_CHARS = 60000;
const MAX_DESCRIPTION_CHARS = 2500;
const MAX_RESULT_COLUMNS = 200;
const MAX_RESULT_ROWS = 50;
const MAX_RESULT_CELL = 2000;
const MAX_SOURCES = 40;
const MAX_SOURCE_FIELDS = 150;
/** Cells are truncated to this many characters when the preview is rendered for Claude. */
const RESULT_CELL_RENDER = 80;

export const SYSTEM_PROMPT = `You are the AI assistant inside the SQL-Console plugin for OWOX Data Marts. You help the member write, understand, and fix BigQuery Standard SQL.

Rules:
- Answer in the same language the member writes in.
- The current editor SQL arrives with each request. Treat it as the query being worked on. A sample of the last run's result may arrive too: use its column names and values to understand the data, and keep proposed changes consistent with them. A list of BigQuery tables the member can reach may arrive as well; prefer those tables and their field names and types when you propose or fix SQL.
- When you change the SQL, output the complete updated query in a single \`\`\`sql code block so the member can apply it in one click. Never present a partial query as the proposed change.
- Keep explanations short and practical. Do not claim you ran or can run the query — you only change its text.
- If a request is ambiguous, ask one short clarifying question instead of guessing.
- Never ask for or mention credentials, tokens, or keys.`;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A sample of the last run's result: enough to understand columns, not the full table. */
export interface AiResultContext {
  columns: string[];
  rows: string[][];
  /** Total rows BigQuery reported, when known. */
  totalRows: number | null;
}

export interface AiSourceField {
  name: string;
  type: string;
  description: string;
}

/** A BigQuery table the member can reach, with a flattened, capped field list. */
export interface AiSourceContext {
  name: string;
  title: string;
  fields: AiSourceField[];
}

export interface AiChatInput {
  sql: string;
  description: string;
  result: AiResultContext | null;
  sources: AiSourceContext[];
  messages: AiChatMessage[];
}

export interface AiChatResult {
  reply: string;
}

/** An error with a machine-readable code, surfaced to the plugin page as a PluginActionError code. */
export class AiChatError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AiChatError';
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function capText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  return value.length <= max ? value : value.slice(0, max);
}

function cleanResultCell(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length <= MAX_RESULT_CELL ? value : value.slice(0, MAX_RESULT_CELL);
}

/** Parses the optional result sample. A malformed sample is dropped, not fatal. */
function normalizeResult(value: unknown): AiResultContext | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.columns)) return null;
  const columns = record.columns.flatMap(column => {
    if (typeof column !== 'string') return [];
    const name = column.trim();
    if (!name || name.length > 500) return [];
    return [name];
  });
  if (columns.length === 0 || columns.length > MAX_RESULT_COLUMNS) return null;
  let rows: string[][] = [];
  if (Array.isArray(record.rows)) {
    rows = record.rows.flatMap(row => {
      if (!Array.isArray(row)) return [];
      return [row.map(cleanResultCell)];
    });
    if (rows.length > MAX_RESULT_ROWS) rows = rows.slice(0, MAX_RESULT_ROWS);
  }
  const totalRows =
    typeof record.totalRows === 'number' && Number.isInteger(record.totalRows) && record.totalRows >= 0
      ? record.totalRows
      : null;
  return { columns, rows, totalRows };
}

/** Parses the optional schema sample. A malformed sample is dropped, not fatal. */
function normalizeSources(value: unknown): AiSourceContext[] {
  if (!Array.isArray(value)) return [];
  const sources: AiSourceContext[] = [];
  for (const entry of value.slice(0, MAX_SOURCES)) {
    const record = asRecord(entry);
    if (!record || typeof record.name !== 'string' || !record.name.trim()) continue;
    const fields: AiSourceField[] = [];
    if (Array.isArray(record.fields)) {
      for (const fieldEntry of record.fields.slice(0, MAX_SOURCE_FIELDS)) {
        const field = asRecord(fieldEntry);
        if (!field || typeof field.name !== 'string' || !field.name.trim()) continue;
        fields.push({
          name: field.name,
          type: typeof field.type === 'string' ? field.type : '',
          description: typeof field.description === 'string' ? field.description : '',
        });
      }
    }
    sources.push({
      name: record.name.trim(),
      title: typeof record.title === 'string' ? record.title : '',
      fields,
    });
  }
  return sources;
}

/** Validates raw action input even though plugin.json already schema-checks it. */
export function normalizeAiChatInput(value: unknown): AiChatInput | null {
  const record = asRecord(value);
  if (!record) return null;
  const sql = capText(record.sql, MAX_SQL_CHARS);
  if (sql === null) return null;
  const description = capText(record.description, MAX_DESCRIPTION_CHARS) ?? '';
  const result = normalizeResult(record.result);
  const sources = normalizeSources(record.sources);
  if (!Array.isArray(record.messages) || record.messages.length === 0) return null;
  const messages: AiChatMessage[] = [];
  for (const item of record.messages.slice(-MAX_CHAT_MESSAGES)) {
    const message = asRecord(item);
    if (!message) return null;
    if (message.role !== 'user' && message.role !== 'assistant') return null;
    const content = capText(message.content, MAX_MESSAGE_CHARS);
    if (content === null) return null;
    messages.push({ role: message.role, content });
  }
  if (messages.length === 0) return null;
  if (messages[messages.length - 1].role !== 'user') return null;
  return { sql, description, result, sources, messages };
}

/** A pipe table of the sample rows, with cells truncated so long values do not drown the prompt. */
function renderResultRows(columns: string[], rows: string[][]): string {
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const lines = rows.map(row => {
    const cells = columns.map((_, index) => {
      const cell = row[index] ?? '';
      const oneLine = cell.replace(/[\r\n]+/g, ' ');
      return oneLine.length > RESULT_CELL_RENDER ? `${oneLine.slice(0, RESULT_CELL_RENDER)}…` : oneLine;
    });
    return `| ${cells.join(' | ')} |`;
  });
  return [header, divider, ...lines].join('\n');
}

/** The editor SQL, the member's note, schema, and a result sample ride along with the latest question. */
function buildUserContext(input: AiChatInput): string {
  const parts = [`Current SQL in the editor:\n\`\`\`sql\n${input.sql}\n\`\`\``];
  if (input.description.trim()) {
    parts.push(`The member's note about this query:\n${input.description.trim()}`);
  }
  if (input.sources.length > 0) {
    const blocks = input.sources.map(source => {
      const header = source.title && source.title !== source.name ? `${source.name} — ${source.title}` : source.name;
      const lines = source.fields.map(field => {
        const typed = field.type ? `${field.name} (${field.type})` : field.name;
        return field.description ? `  - ${typed}: ${field.description}` : `  - ${typed}`;
      });
      return [`- ${header}`, ...lines].join('\n');
    });
    parts.push(`BigQuery tables the member can reach, most relevant first:\n${blocks.join('\n')}`);
  }
  if (input.result) {
    const { columns, rows, totalRows } = input.result;
    if (rows.length > 0) {
      const total = totalRows !== null ? ` of ${totalRows}` : '';
      parts.push(
        `Result of running the query: ${rows.length} sample row${rows.length === 1 ? '' : 's'}${total}.\n${renderResultRows(columns, rows)}`,
      );
    } else {
      parts.push(`The query returns these columns: ${columns.join(', ')}.`);
    }
  }
  parts.push(input.messages[input.messages.length - 1].content);
  return parts.join('\n\n');
}

interface AnthropicBody {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export function buildAnthropicBody(input: AiChatInput): AnthropicBody {
  const messages = input.messages.map((message, index) =>
    index === input.messages.length - 1 && message.role === 'user'
      ? { role: 'user' as const, content: buildUserContext(input) }
      : { role: message.role, content: message.content },
  );
  return { model: CLAUDE_MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, messages };
}

export function parseAnthropicReply(body: unknown): string {
  const record = asRecord(body);
  if (!Array.isArray(record?.content)) {
    throw new AiChatError('ANTHROPIC_FAILED', 'Claude answered in an unexpected format.');
  }
  const text = record.content
    .flatMap(block => {
      const item = asRecord(block);
      return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : [];
    })
    .join('');
  if (!text.trim()) {
    throw new AiChatError('ANTHROPIC_FAILED', 'Claude returned an empty answer.');
  }
  return text.length <= MAX_REPLY_CHARS ? text : text.slice(0, MAX_REPLY_CHARS);
}

/** Maps an Anthropic error response to a stable code and a member-readable message. */
export function anthropicErrorInfo(status: number, body: unknown): { code: string; message: string } {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const detail = typeof error?.message === 'string' ? error.message : '';
  if (status === 401 || status === 403) {
    return {
      code: 'ANTHROPIC_AUTH',
      message: 'The Anthropic Credential was rejected. Check the Claude token saved in OWOX.',
    };
  }
  if (status === 429) {
    return { code: 'ANTHROPIC_RATE_LIMIT', message: 'Claude is rate limited. Wait a moment and try again.' };
  }
  if (status === 529) {
    return { code: 'ANTHROPIC_OVERLOADED', message: 'Claude is overloaded. Try again shortly.' };
  }
  return {
    code: 'ANTHROPIC_FAILED',
    message: detail ? `Claude request failed: ${detail}` : `Claude request failed with status ${status}.`,
  };
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Calls the Anthropic Messages API with the installation's anthropic Credential. */
export async function runAiChat(input: {
  fetchImpl: FetchLike;
  signal?: AbortSignal;
  input: unknown;
}): Promise<AiChatResult> {
  const chat = normalizeAiChatInput(input.input);
  if (!chat) throw new AiChatError('INVALID_CHAT_INPUT', 'The chat request is malformed.');
  const response = await input.fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION },
    body: JSON.stringify(buildAnthropicBody(chat)),
    signal: input.signal,
  });
  if (!response.ok) {
    const info = anthropicErrorInfo(response.status, await readJsonSafe(response));
    throw new AiChatError(info.code, info.message);
  }
  return { reply: parseAnthropicReply(await response.json()) };
}
