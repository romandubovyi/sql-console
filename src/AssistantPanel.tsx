import { Check, Copy, Play, Save, Send, Sparkles, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { segmentReply, SUGGESTED_PROMPTS, type ChatMessage } from './assistant.ts';
import { formatVersionTime } from './queries.ts';

interface AssistantPanelProps {
  configured: boolean;
  actionsAvailable: boolean;
  messages: ChatMessage[];
  sending: boolean;
  error: string | null;
  runEnabled: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onApply: (sql: string) => void;
  onRun: (sql: string) => void;
  onSave: (sql: string) => void;
  onClose: () => void;
}

export function AssistantPanel({
  configured,
  actionsAvailable,
  messages,
  sending,
  error,
  runEnabled,
  onSend,
  onCancel,
  onApply,
  onRun,
  onSave,
  onClose,
}: AssistantPanelProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const usable = configured && actionsAvailable && !sending;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, sending, error]);

  useEffect(() => {
    if (usable) inputRef.current?.focus();
  }, [usable]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !usable) return;
    setDraft('');
    onSend(trimmed);
  }

  return (
    <section className="assistant-pane" aria-label="AI assistant">
      <div className="pane-toolbar assistant-toolbar">
        <span className="pane-title">
          <Sparkles size={14} aria-hidden="true" />
          AI assistant
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" type="button" aria-label="Close assistant" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="assistant-body" ref={scrollRef}>
        {!configured ? (
          <p className="empty-note assistant-setup" role="note">
            To use the assistant, add an Anthropic (Claude) Credential in OWOX Data Marts and select it for
            SQL-Console when it is installed.
          </p>
        ) : null}
        {configured && !actionsAvailable ? (
          <p className="empty-note assistant-setup" role="note">
            This OWOX version cannot run plugin backend actions. Update OWOX to use the assistant.
          </p>
        ) : null}

        {messages.length === 0 && !sending ? (
          <div className="assistant-empty">
            <p className="dm-muted">Ask the assistant to change, explain, or fix the SQL in the editor.</p>
            {SUGGESTED_PROMPTS.map(prompt => (
              <button key={prompt} className="ghost assistant-suggestion" type="button" disabled={!usable} onClick={() => send(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {messages.map((message, index) => (
          <article key={index} className={message.role === 'user' ? 'chat-message is-user' : 'chat-message'}>
            {message.role === 'user' ? (
              <p className="chat-text">{message.content}</p>
            ) : (
              <AssistantContent
                content={message.content}
                runEnabled={runEnabled}
                onApply={onApply}
                onRun={onRun}
                onSave={onSave}
              />
            )}
            {message.at ? (
              <time className="chat-time" dateTime={message.at}>
                {formatVersionTime(message.at)}
              </time>
            ) : null}
          </article>
        ))}

        {sending ? (
          <div className="chat-typing" role="status">
            <span className="dm-muted">The assistant is thinking…</span>
            <button className="ghost" type="button" onClick={onCancel}>
              <Square size={12} aria-hidden="true" />
              Cancel
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="banner" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <form
        className="assistant-input"
        onSubmit={event => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="Message the assistant"
          placeholder={
            !configured
              ? 'Assistant is not configured'
              : !actionsAvailable
                ? 'Backend actions are not available'
                : 'Describe the change, e.g. "add a 7-day filter"'
          }
          value={draft}
          disabled={!usable}
          rows={2}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
        />
        <button className="primary" type="submit" aria-label="Send" title="Send" disabled={!usable || !draft.trim()}>
          <Send size={14} aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function AssistantContent({
  content,
  runEnabled,
  onApply,
  onRun,
  onSave,
}: {
  content: string;
  runEnabled: boolean;
  onApply: (sql: string) => void;
  onRun: (sql: string) => void;
  onSave: (sql: string) => void;
}) {
  const segments = segmentReply(content);
  return (
    <div className="chat-content">
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <TextBlock key={index} text={segment.text} />
        ) : (
          <SqlBlock
            key={index}
            sql={segment.sql}
            runEnabled={runEnabled}
            onApply={onApply}
            onRun={onRun}
            onSave={onSave}
          />
        ),
      )}
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="chat-text">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>
          {paragraph.split('\n').map((line, lineIndex) => (
            <span key={lineIndex}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line)}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/** Renders the small markdown the assistant is asked to use: inline code and bold. */
function renderInline(text: string): ReactNode {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(part => part !== '')
    .map((part, index) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      return <span key={index}>{part}</span>;
    });
}

function SqlBlock({
  sql,
  runEnabled,
  onApply,
  onRun,
  onSave,
}: {
  sql: string;
  runEnabled: boolean;
  onApply: (sql: string) => void;
  onRun: (sql: string) => void;
  onSave: (sql: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="chat-sql">
      <pre>
        <code>{sql}</code>
      </pre>
      <div className="chat-sql-actions">
        <button className="ghost" type="button" title="Replace the editor SQL with this query" onClick={() => onApply(sql)}>
          Apply
        </button>
        <button
          className="ghost"
          type="button"
          title="Replace the editor SQL and run the query"
          disabled={!runEnabled}
          onClick={() => onRun(sql)}
        >
          <Play size={12} aria-hidden="true" />
          Run
        </button>
        <button
          className="ghost"
          type="button"
          title="Replace the editor SQL and save a version"
          onClick={() => onSave(sql)}
        >
          <Save size={12} aria-hidden="true" />
          Save
        </button>
        <button className="ghost" type="button" title="Copy this SQL" onClick={() => void copy()}>
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
