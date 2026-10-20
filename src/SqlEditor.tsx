import Editor, { type OnMount } from '@monaco-editor/react';
import type { languages as MonacoLanguages } from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { sqlCompletions } from './completion.ts';
import './monaco.ts';
import type { SqlSource } from './sources.ts';

interface SqlEditorProps {
  value: string;
  theme: 'light' | 'dark';
  sources: readonly SqlSource[];
  onChange: (value: string) => void;
  onRun: () => void;
}

export function SqlEditor({ value, theme, sources, onChange, onRun }: SqlEditorProps) {
  const onRunRef = useRef(onRun);
  const sourcesRef = useRef(sources);
  const providerRef = useRef<{ dispose(): void } | null>(null);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    return () => {
      providerRef.current?.dispose();
      providerRef.current = null;
    };
  }, []);

  const handleMount: OnMount = (editor, monacoApi) => {
    providerRef.current?.dispose();
    const provider: MonacoLanguages.CompletionItemProvider = {
      triggerCharacters: [' ', '.', '`'],
      provideCompletionItems(model, position) {
        const offset = model.getOffsetAt(position);
        const suggestions = sqlCompletions(sourcesRef.current, model.getValue(), offset).map(item => {
          const start = model.getPositionAt(item.start);
          const end = model.getPositionAt(item.end);
          return {
            label: item.label,
            kind: item.kind === 'table' ? monacoApi.languages.CompletionItemKind.Struct : monacoApi.languages.CompletionItemKind.Field,
            detail: item.detail,
            documentation: item.documentation,
            insertText: item.insertText,
            filterText: `${item.label} ${item.detail}`,
            sortText: item.sortText,
            range: {
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
            },
          };
        });
        return { suggestions };
      },
    };
    providerRef.current = monacoApi.languages.registerCompletionItemProvider('sql', provider);
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
        fixedOverflowWidgets: true,
        wordBasedSuggestions: 'off',
      }}
    />
  );
}
