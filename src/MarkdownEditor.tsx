import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { limitDescription } from './queries.ts';
import './monaco.ts';

interface MarkdownEditorProps {
  value: string;
  theme: 'light' | 'dark';
  onChange: (value: string) => void;
}

export function MarkdownEditor({ value, theme, onChange }: MarkdownEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = editor => {
    editorRef.current = editor;
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    editor.setValue(value);
    const end = editor.getModel()?.getPositionAt(value.length);
    if (end) editor.setPosition(end);
  }, [value]);

  return (
    <Editor
      language="markdown"
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      value={value}
      onMount={handleMount}
      onChange={next => {
        if (next !== undefined) onChange(limitDescription(next));
      }}
      height="100%"
      loading={<p className="dm-muted editor-loading">Loading editor…</p>}
      options={{
        selectOnLineNumbers: true,
        hideCursorInOverviewRuler: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerBorder: false,
        automaticLayout: true,
        wordWrap: 'on',
        ariaLabel: 'Query description',
      }}
    />
  );
}
