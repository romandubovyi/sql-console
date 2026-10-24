export type SqlTokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'quoted'
  | 'word'
  | 'space'
  | 'other';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

const KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'group',
  'by',
  'order',
  'having',
  'limit',
  'offset',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'on',
  'using',
  'natural',
  'lateral',
  'union',
  'all',
  'intersect',
  'except',
  'distinct',
  'as',
  'with',
  'and',
  'or',
  'not',
  'in',
  'is',
  'null',
  'like',
  'between',
  'exists',
  'any',
  'some',
  'case',
  'when',
  'then',
  'else',
  'end',
  'desc',
  'asc',
  'nulls',
  'first',
  'last',
  'over',
  'partition',
  'rows',
  'range',
  'groups',
  'unbounded',
  'preceding',
  'following',
  'current',
  'qualify',
  'pivot',
  'unpivot',
  'window',
  'filter',
  'collate',
  'values',
  'cast',
  'safe_cast',
  'coalesce',
  'if',
  'ifnull',
  'nullif',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'any_value',
  'string_agg',
  'array_agg',
  'unnest',
  'struct',
  'array',
  'extract',
  'interval',
  'date',
  'datetime',
  'timestamp',
  'time',
  'numeric',
  'bignumeric',
  'int64',
  'float64',
  'bool',
  'string',
  'bytes',
  'json',
  'true',
  'false',
]);

// Order matters: comments and literals before words, whitespace last.
const TOKEN_PATTERN = new RegExp(
  [
    '(--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))',
    "('(?:[^']|'')*')",
    '(`(?:[^`]|``)*`|"(?:[^"]|"")*")',
    '((?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)',
    '([A-Za-z_][A-Za-z0-9_]*)',
    '(\\s+)',
  ].join('|'),
  'gy',
);

/**
 * Splits SQL into a flat token list for lightweight syntax highlighting.
 * Adjacent tokens of the same kind are merged so React renders fewer spans.
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const push = (kind: SqlTokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ kind, text });
  };

  let index = 0;
  while (index < sql.length) {
    TOKEN_PATTERN.lastIndex = index;
    const match = TOKEN_PATTERN.exec(sql);
    if (!match) {
      push('other', sql[index]);
      index += 1;
      continue;
    }
    const text = match[0];
    const kind: SqlTokenKind = match[1]
      ? 'comment'
      : match[2]
        ? 'string'
        : match[3]
          ? 'quoted'
          : match[4]
            ? 'number'
            : match[5]
              ? KEYWORDS.has(text.toLowerCase())
                ? 'keyword'
                : 'word'
              : 'space';
    push(kind, text);
    index = TOKEN_PATTERN.lastIndex;
  }
  return tokens;
}

/** CSS class per token kind; kinds without an entry render with the default color. */
export const SQL_TOKEN_CLASSES: Partial<Record<SqlTokenKind, string>> = {
  keyword: 'tok-k',
  string: 'tok-s',
  quoted: 'tok-q',
  comment: 'tok-c',
};
