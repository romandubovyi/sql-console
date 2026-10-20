import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import './monaco.ts';

interface SqlEditorProps {
  value: string;
  theme: 'light' | 'dark';
  onChange: (value: string) => void;
  onRun: () => void;
}

export function SqlEditor({ value, theme, onChange, onRun }: SqlEditorProps) {
  const onRunRef = useRef(onRun);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const handleMount: OnMount = (editor, monacoApi) => {
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter, () => {
      onRunRef.current();
    });
  };

  return (
    <Editor
      language="sql"
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      value={value}
      onChange={next => {
        if (next !== undefined) onChange(next);
      }}
      onMount={handleMount}
      height="100%"
      loading={<p className="dm-muted editor-loading">Loading editor…</p>}
      options={{
        selectOnLineNumbers: true,
        hideCursorInOverviewRuler: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerBorder: false,
        automaticLayout: true,
        ariaLabel: 'SQL query',
      }}
    />
  );
}
