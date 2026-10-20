const MAX_SQL_CHARS = 100_000;

const STATEMENT_VERBS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'merge',
  'create',
  'drop',
  'alter',
  'truncate',
  'grant',
  'revoke',
  'call',
  'export',
  'load',
  'assert',
  'begin',
  'declare',
  'execute',
  'loop',
]);

export type PreparedQuery = { sql: string } | { error: string };

/**
 * Accepts one read-only statement.
 * The Google scope is the real write boundary; this check stops an obvious write before it is sent.
 */
export function prepareReadOnlyQuery(input: string): PreparedQuery {
  const sql = input.trim();
  if (!sql) return { error: 'Enter a SQL query.' };
  if (sql.length > MAX_SQL_CHARS) return { error: 'Query is too long.' };

  const stripped = stripCommentsAndStrings(sql).replace(/;\s*$/, '');
  if (stripped.includes(';')) return { error: 'Only one SQL statement is allowed.' };

  const verbError = readOnlyVerbError(stripped);
  if (verbError) return { error: verbError };

  return { sql: stripTrailingStatementSemicolon(sql).trim() };
}

/** Drops one statement-ending semicolon so BigQuery receives a single statement. */
function stripTrailingStatementSemicolon(sql: string): string {
  let index = 0;
  let semicolonAt = -1;
  let codeAfter = false;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }

    const quote = sql[index];
    if (quote === "'" || quote === '"' || quote === '`') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          index += 1;
          if (sql[index] === quote) {
            index += 1;
            continue;
          }
          break;
        }
        index += 1;
      }
      continue;
    }

    if (sql[index] === ';') {
      semicolonAt = index;
      codeAfter = false;
      index += 1;
      continue;
    }
    if (!/\s/.test(sql[index] ?? '')) codeAfter = true;
    index += 1;
  }

  if (semicolonAt >= 0 && !codeAfter) {
    return sql.slice(0, semicolonAt) + sql.slice(semicolonAt + 1);
  }
  return sql;
}

function readOnlyVerbError(stripped: string): string | null {
  const tokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*|\(|\)/g) ?? [];
  let depth = 0;
  let previous = '';
  let startedWith = false;

  for (const token of tokens) {
    if (token === '(') {
      depth += 1;
      previous = token;
      continue;
    }
    if (token === ')') {
      depth = Math.max(0, depth - 1);
      previous = token;
      continue;
    }
    if (depth !== 0) continue;

    const word = token.toLowerCase();
    if (!startedWith) {
      if (word === 'select') return null;
      if (word !== 'with') return 'Only a single SELECT or WITH query is allowed.';
      startedWith = true;
      previous = token;
      continue;
    }

    // A CTE name can be `insert` or `select`. The main verb sits after a CTE's closing paren.
    if (previous === ')' && STATEMENT_VERBS.has(word)) {
      return word === 'select' ? null : 'Only a read-only SELECT query is allowed.';
    }
    previous = token;
  }

  return 'Only a read-only SELECT query is allowed.';
}

function stripCommentsAndStrings(sql: string): string {
  let out = '';
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index);
      const end = newline === -1 ? sql.length : newline;
      out += ' '.repeat(end - index);
      index = end;
      continue;
    }
    if (sql.startsWith('/*', index)) {
      const close = sql.indexOf('*/', index + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += ' '.repeat(end - index);
      index = end;
      continue;
    }

    const quote = sql[index];
    if (quote === "'" || quote === '"' || quote === '`') {
      out += quote;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          out += quote;
          index += 1;
          if (sql[index] === quote) {
            out += ' ';
            index += 1;
            continue;
          }
          break;
        }
        out += sql[index] === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    out += sql[index];
    index += 1;
  }

  return out;
}
