import {
  MAX_CHAT_MESSAGES,
  MAX_MESSAGE_CHARS,
  normalizeAiChatInput,
  type AiChatMessage,
  type AiResultContext,
} from './ai-chat.ts';
import type { SqlSource, SqlSourceField } from './sources.ts';

export const CHATS_COLLECTION = 'chats';
export const MAX_THREAD_MESSAGES = 100;
/** How many preview rows are sent to the assistant so it can see the data shape. */
export const RESULT_SAMPLE_ROWS = 30;
/** How many BigQuery sources and fields per source are sent as schema context. */
export const MAX_CONTEXT_SOURCES = 25;
export const MAX_SOURCE_FIELDS = 60;
const SOURCE_FIELD_DEPTH = 2;
const SOURCE_NAME_MAX = 120;
const SOURCE_TITLE_MAX = 200;
const FIELD_NAME_MAX = 120;
const FIELD_TYPE_MAX = 60;
const FIELD_DESCRIPTION_MAX = 300;

export interface AiSourceField {
  /** Dot path for nested record fields, e.g. "geo.country". */
  name: string;
  type: string;
  description: string;
}

export interface AiSourceContext {
  /** The table's fully qualified BigQuery name. */
  name: string;
  title: string;
  fields: AiSourceField[];
}

/** Dotted paths and identifiers that appear in the SQL, lowercased. */
function sqlReferences(sql: string): string[] {
  const refs = new Set<string>();
  const pattern = /`?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3})`?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    refs.add(match[1].toLowerCase());
  }
  return [...refs];
}

function sourceIsReferenced(sqlLower: string, refs: readonly string[], source: SqlSource): boolean {
  const fqn = source.fullyQualifiedName.toLowerCase();
  if (sqlLower.includes(fqn)) return true;
  return refs.some(ref => fqn === ref || fqn.endsWith(`.${ref}`) || fqn.split('.').pop() === ref);
}

function flattenFields(
  fields: readonly SqlSourceField[],
  prefix: string,
  depth: number,
  out: AiSourceField[],
): void {
  if (depth > SOURCE_FIELD_DEPTH) return;
  for (const field of fields) {
    if (out.length >= MAX_SOURCE_FIELDS) return;
    const name = prefix ? `${prefix}.${field.name}` : field.name;
    out.push({
      name: name.length <= FIELD_NAME_MAX ? name : name.slice(0, FIELD_NAME_MAX),
      type: field.type.length <= FIELD_TYPE_MAX ? field.type : field.type.slice(0, FIELD_TYPE_MAX),
      description:
        field.description.length <= FIELD_DESCRIPTION_MAX
          ? field.description
          : field.description.slice(0, FIELD_DESCRIPTION_MAX),
    });
    flattenFields(field.fields, name, depth + 1, out);
  }
}

/**
 * Picks the sources the SQL touches, then fills up to the cap with the rest.
 * Field lists are flattened to dot paths and capped so the context stays small.
 */
export function buildSourcesContext(sql: string, sources: readonly SqlSource[]): AiSourceContext[] {
  if (sql.trim() === '' || sources.length === 0) return [];
  const refs = sqlReferences(sql);
  const sqlLower = sql.toLowerCase();
  const referenced: SqlSource[] = [];
  const rest: SqlSource[] = [];
  for (const source of sources) {
    (sourceIsReferenced(sqlLower, refs, source) ? referenced : rest).push(source);
  }
  return [...referenced, ...rest].slice(0, MAX_CONTEXT_SOURCES).map(source => {
    const fields: AiSourceField[] = [];
    flattenFields(source.fields, '', 1, fields);
    return {
      name:
        source.fullyQualifiedName.length <= SOURCE_NAME_MAX
          ? source.fullyQualifiedName
          : source.fullyQualifiedName.slice(0, SOURCE_NAME_MAX),
      title: source.title.length <= SOURCE_TITLE_MAX ? source.title : source.title.slice(0, SOURCE_TITLE_MAX),
      fields,
    };
  });
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO timestamp of when the message was stored. */
  at: string;
}

export interface ChatThread {
  messages: ChatMessage[];
}

export function emptyChatThread(): ChatThread {
  return { messages: [] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanMessage(value: unknown): ChatMessage | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.role !== 'user' && record.role !== 'assistant') return null;
  if (typeof record.content !== 'string' || !record.content.trim()) return null;
  const at = typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at)) ? record.at : '';
  return {
    role: record.role,
    content: record.content.length <= MAX_MESSAGE_CHARS ? record.content : record.content.slice(0, MAX_MESSAGE_CHARS),
    at,
  };
}

export function normalizeChatThread(value: unknown): ChatThread {
  const record = asRecord(value);
  if (!Array.isArray(record?.messages)) return { messages: [] };
  const messages = record.messages.flatMap(item => {
    const message = cleanMessage(item);
    return message ? [message] : [];
  });
  return { messages: messages.slice(-MAX_THREAD_MESSAGES) };
}

export function appendChatMessage(thread: ChatThread, message: ChatMessage): ChatThread {
  const messages = [...thread.messages, message];
  return { messages: messages.slice(-MAX_THREAD_MESSAGES) };
}

export function toAiMessages(thread: ChatThread): AiChatMessage[] {
  return thread.messages.map(message => ({ role: message.role, content: message.content }));
}

/** Everything the page knows about the query, sent along as the assistant's context. */
export interface AssistantContext {
  description: string;
  result: AiResultContext | null;
  sources: AiSourceContext[];
}

/** Builds the ai-chat action input from the editor SQL, the stored thread, and the query context. */
export function buildAiChatInput(
  sql: string,
  thread: ChatThread,
  context: AssistantContext = { description: '', result: null, sources: [] },
): { sql: string; description: string; result: AiResultContext | null; sources: AiSourceContext[]; messages: AiChatMessage[] } | null {
  const recent = thread.messages.slice(-MAX_CHAT_MESSAGES);
  return normalizeAiChatInput({
    sql,
    description: context.description,
    result: context.result,
    sources: context.sources,
    messages: recent.map(message => ({ role: message.role, content: message.content })),
  });
}

export type ReplySegment = { kind: 'text'; text: string } | { kind: 'sql'; sql: string };

/**
 * Splits an assistant reply into text and ```sql code blocks. Only sql fences become
 * actionable segments; other fences keep their body as plain text.
 */
export function segmentReply(reply: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  const pushText = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) segments.push({ kind: 'text', text: trimmed });
  };
  const fence = /^```([A-Za-z0-9_-]*)[ \t]*\r?\n?/;
  let rest = reply;
  while (rest.length > 0) {
    const openIndex = rest.indexOf('```');
    if (openIndex === -1) {
      pushText(rest);
      break;
    }
    pushText(rest.slice(0, openIndex));
    const afterOpen = rest.slice(openIndex);
    const open = fence.exec(afterOpen);
    if (!open) {
      pushText(afterOpen);
      break;
    }
    const lang = open[1].toLowerCase();
    const bodyStart = open[0].length;
    const closeIndex = afterOpen.indexOf('```', bodyStart);
    if (closeIndex === -1) {
      const body = afterOpen.slice(bodyStart).trim();
      if (lang === 'sql') {
        if (body) segments.push({ kind: 'sql', sql: body });
      } else {
        pushText(body);
      }
      break;
    }
    const body = afterOpen.slice(bodyStart, closeIndex).trim();
    if (lang === 'sql') {
      if (body) segments.push({ kind: 'sql', sql: body });
    } else {
      pushText(body);
    }
    rest = afterOpen.slice(closeIndex + 3);
  }
  return segments;
}

export const SUGGESTED_PROMPTS = [
  'Explain this query',
  'Optimize this query',
  'Add a filter by date',
] as const;
