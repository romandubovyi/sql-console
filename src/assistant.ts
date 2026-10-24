import {
  MAX_CHAT_MESSAGES,
  MAX_MESSAGE_CHARS,
  normalizeAiChatInput,
  type AiChatMessage,
  type AiResultContext,
} from './ai-chat.ts';

export const CHATS_COLLECTION = 'chats';
export const MAX_THREAD_MESSAGES = 100;
/** How many preview rows are sent to the assistant so it can see the data shape. */
export const RESULT_SAMPLE_ROWS = 30;

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
}

/** Builds the ai-chat action input from the editor SQL, the stored thread, and the query context. */
export function buildAiChatInput(
  sql: string,
  thread: ChatThread,
  context: AssistantContext = { description: '', result: null },
): { sql: string; description: string; result: AiResultContext | null; messages: AiChatMessage[] } | null {
  const recent = thread.messages.slice(-MAX_CHAT_MESSAGES);
  return normalizeAiChatInput({
    sql,
    description: context.description,
    result: context.result,
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
