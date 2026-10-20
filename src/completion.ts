import type { SqlSource, SqlSourceField } from './sources.ts';

const MAX_COMPLETIONS = 100;

const COLUMN_CLAUSES = new Set(['select', 'where', 'having', 'on', 'qualify', 'by']);
const TABLE_CLAUSES = new Set(['from', 'join']);
const CLAUSE_WORDS = new Set([
  ...COLUMN_CLAUSES,
  ...TABLE_CLAUSES,
  'group',
  'order',
  'limit',
  'union',
  'except',
  'intersect',
  'with',
  'using',
  'window',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'and',
  'or',
  'not',
  'as',
  'set',
  'into',
  'values',
  'lateral',
]);

interface Token {
  kind: 'word' | 'dot' | 'dash' | 'other';
  text: string;
  start: number;
  end: number;
  quoted: boolean;
}

interface TableRef {
  path: string;
  alias: string | null;
}

export interface SqlCompletion {
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
  kind: 'table' | 'column';
  sortText: string;
  start: number;
  end: number;
}

/** Suggests a BigQuery table after FROM or JOIN, or a saved field after SELECT. */
export function sqlCompletions(sources: readonly SqlSource[], sql: string, offset: number): SqlCompletion[] {
  const scanned = scan(sql);
  if (scanned.opaque.some(span => span.start < offset && offset < span.end)) return [];

  const ident = identifierAt(scanned.tokens, sql, offset);
  if (!ident) return [];
  const clause = clauseBefore(scanned.tokens, ident.chainStart);
  if (!clause) return [];

  if (TABLE_CLAUSES.has(clause)) {
    const prefix = typedPath(ident.qualifier, ident.prefix);
    return tableCompletions(sources, prefix, ident.chainStart, ident.sequenceEnd);
  }
  if (COLUMN_CLAUSES.has(clause)) {
    return columnCompletions(sources, tableRefs(scanned.tokens), ident.qualifier, ident.prefix, ident.prefixStart, ident.prefixEnd);
  }
  return [];
}

export function quoteSqlPath(fullyQualifiedName: string): string {
  return fullyQualifiedName
    .split('.')
    .filter(part => part.length > 0)
    .map(quoteIdent)
    .join('.');
}

function tableCompletions(sources: readonly SqlSource[], prefix: string, start: number, end: number): SqlCompletion[] {
  const groups = new Map<string, SqlSource[]>();
  for (const source of sources) {
    const key = normalize(source.fullyQualifiedName);
    const group = groups.get(key);
    if (group) group.push(source);
    else groups.set(key, [source]);
  }

  const ranked: { rank: number; item: SqlCompletion }[] = [];
  for (const group of groups.values()) {
    const source = group[0];
    if (!source) continue;
    const rank = tableRank(source.fullyQualifiedName, group.map(item => item.title), prefix);
    if (rank === null) continue;
    const detail = group
      .map(item => item.title)
      .sort((left, right) => left.localeCompare(right))
      .join(', ');
    ranked.push({
      rank,
      item: {
        label: source.fullyQualifiedName,
        insertText: quoteSqlPath(source.fullyQualifiedName),
        detail,
        kind: 'table',
        sortText: `${rank}${source.fullyQualifiedName.toLowerCase()}`,
        start,
        end,
      },
    });
  }
  return takeRanked(ranked);
}

function columnCompletions(
  sources: readonly SqlSource[],
  refs: readonly TableRef[],
  qualifier: string | null,
  prefix: string,
  start: number,
  end: number,
): SqlCompletion[] {
  const ranked: { rank: number; item: SqlCompletion }[] = [];
  for (const entry of fieldsInScope(sources, refs, qualifier)) {
    for (const field of entry.fields) {
      const rank = columnRank(field.name, prefix);
      if (rank === null) continue;
      const type = field.fields.length > 0 && !field.type ? 'RECORD' : field.type;
      ranked.push({
        rank,
        item: {
          label: field.name,
          insertText: quoteIdent(field.name),
          detail: type ? `${type} · ${entry.source.title}` : entry.source.title,
          ...(field.description ? { documentation: field.description } : {}),
          kind: 'column',
          sortText: `${rank}${field.name.toLowerCase()} ${entry.source.fullyQualifiedName.toLowerCase()}`,
          start,
          end,
        },
      });
    }
  }
  return takeRanked(ranked);
}

function fieldsInScope(
  sources: readonly SqlSource[],
  refs: readonly TableRef[],
  qualifier: string | null,
): { source: SqlSource; fields: SqlSourceField[] }[] {
  const matched = sources.filter(source => refs.some(ref => sourceMatchesRef(source, ref)));
  if (!qualifier) return matched.map(source => ({ source, fields: source.fields }));

  const parts = qualifier.split('.').filter(part => part.length > 0);
  for (let length = parts.length; length >= 1; length -= 1) {
    const tableKey = parts.slice(0, length).join('.');
    const chosen = matched.filter(source => refs.some(ref => refMatchesQualifier(source, ref, tableKey)));
    if (chosen.length === 0) continue;
    const resolved: { source: SqlSource; fields: SqlSourceField[] }[] = [];
    for (const source of chosen) {
      const fields = walkFields(source.fields, parts.slice(length));
      if (fields) resolved.push({ source, fields });
    }
    return resolved;
  }

  if (matched.length === 1) {
    const source = matched[0];
    if (!source) return [];
    const fields = walkFields(source.fields, parts);
    if (fields) return [{ source, fields }];
  }
  return [];
}

function walkFields(fields: readonly SqlSourceField[], parts: readonly string[]): SqlSourceField[] | null {
  let current = fields;
  for (const part of parts) {
    const next = current.find(field => normalize(field.name) === normalize(part));
    if (!next) return null;
    current = next.fields;
  }
  return [...current];
}

function sourceMatchesRef(source: SqlSource, ref: TableRef): boolean {
  const path = normalize(ref.path);
  const fullyQualifiedName = normalize(source.fullyQualifiedName);
  if (!path) return false;
  return fullyQualifiedName === path || fullyQualifiedName.endsWith(`.${path}`) || fullyQualifiedName.split('.').pop() === path;
}

function refMatchesQualifier(source: SqlSource, ref: TableRef, qualifier: string): boolean {
  if (!sourceMatchesRef(source, ref)) return false;
  const key = normalize(qualifier);
  if (ref.alias && normalize(ref.alias) === key) return true;
  const path = normalize(ref.path);
  const fullyQualifiedName = normalize(source.fullyQualifiedName);
  return (
    path === key ||
    path.endsWith(`.${key}`) ||
    fullyQualifiedName === key ||
    fullyQualifiedName.endsWith(`.${key}`) ||
    fullyQualifiedName.split('.').pop() === key
  );
}

function tableRank(fullyQualifiedName: string, titles: readonly string[], prefix: string): number | null {
  if (!prefix) return 1;
  const needle = normalize(prefix);
  const path = normalize(fullyQualifiedName);
  const table = path.split('.').pop() ?? path;
  if (table.startsWith(needle) || path.startsWith(needle)) return 0;
  if (titles.some(title => normalize(title).startsWith(needle))) return 1;
  if (path.includes(needle) || titles.some(title => normalize(title).includes(needle))) return 2;
  return null;
}

function columnRank(name: string, prefix: string): number | null {
  if (!prefix) return 0;
  const needle = normalize(prefix);
  const label = normalize(name);
  if (label.startsWith(needle)) return 0;
  if (needle.length >= 2 && label.includes(needle)) return 1;
  return null;
}

function takeRanked(ranked: { rank: number; item: SqlCompletion }[]): SqlCompletion[] {
  ranked.sort((left, right) => left.rank - right.rank || left.item.label.localeCompare(right.item.label) || left.item.detail.localeCompare(right.item.detail));
  return ranked.slice(0, MAX_COMPLETIONS).map(entry => entry.item);
}

function typedPath(qualifier: string | null, prefix: string): string {
  if (!qualifier) return prefix;
  return prefix ? `${qualifier}.${prefix}` : qualifier;
}

interface IdentifierAt {
  chainStart: number;
  sequenceEnd: number;
  prefixStart: number;
  prefixEnd: number;
  qualifier: string | null;
  prefix: string;
}

function identifierAt(tokens: readonly Token[], sql: string, offset: number): IdentifierAt | null {
  const sequence = sequenceAt(tokens, offset);
  if (sequence.length === 0) {
    return { chainStart: offset, sequenceEnd: offset, prefixStart: offset, prefixEnd: offset, qualifier: null, prefix: '' };
  }

  const only = sequence[0];
  if (
    sequence.length === 1 &&
    only?.kind === 'word' &&
    !only.quoted &&
    CLAUSE_WORDS.has(only.text.toLowerCase()) &&
    offset === only.end
  ) {
    return { chainStart: offset, sequenceEnd: offset, prefixStart: offset, prefixEnd: offset, qualifier: null, prefix: '' };
  }

  const chainStart = sequence[0]?.start ?? offset;
  const sequenceEnd = sequence[sequence.length - 1]?.end ?? offset;
  const segments = segmentsOf(sequence);
  const segmentIndex = segments.findIndex(segment => segment.start < offset && offset <= segment.end);
  if (segmentIndex < 0) {
    const dotIndex = sequence.findIndex(token => token.kind === 'dot' && token.start < offset && offset <= token.end);
    const dot = sequence[dotIndex];
    const qualifier = segments
      .filter(segment => dot !== undefined && segment.end <= dot.start)
      .map(segment => segment.text);
    return {
      chainStart,
      sequenceEnd,
      prefixStart: offset,
      prefixEnd: offset,
      qualifier: qualifier.length > 0 ? qualifier.join('.') : null,
      prefix: '',
    };
  }

  const segment = segments[segmentIndex];
  if (!segment) return null;
  const qualifier = segments.slice(0, segmentIndex).map(item => item.text);
  return {
    chainStart,
    sequenceEnd,
    prefixStart: segment.start,
    prefixEnd: segment.end,
    qualifier: qualifier.length > 0 ? qualifier.join('.') : null,
    prefix: segment.quoted ? quotedPrefix(sql, segment, offset) : sql.slice(segment.start, Math.min(offset, segment.end)),
  };
}

function sequenceAt(tokens: readonly Token[], offset: number): Token[] {
  const index = tokens.findIndex(token => token.kind !== 'other' && token.start < offset && offset <= token.end);
  if (index < 0) return [];
  let start = index;
  let end = index;
  while (start > 0 && isIdentToken(tokens[start - 1]) && tokens[start - 1]?.end === tokens[start]?.start) start -= 1;
  while (end + 1 < tokens.length && isIdentToken(tokens[end + 1]) && tokens[end]?.end === tokens[end + 1]?.start) end += 1;
  return tokens.slice(start, end + 1);
}

function clauseBefore(tokens: readonly Token[], chainStart: number): string | null {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token || token.end > chainStart || token.kind !== 'word' || token.quoted) continue;
    const text = token.text.toLowerCase();
    if (COLUMN_CLAUSES.has(text) || TABLE_CLAUSES.has(text)) return text;
    if (
      text === 'group' ||
      text === 'order' ||
      text === 'limit' ||
      text === 'union' ||
      text === 'except' ||
      text === 'intersect' ||
      text === 'with' ||
      text === 'window' ||
      text === 'using' ||
      text === 'set' ||
      text === 'into' ||
      text === 'values'
    ) {
      return null;
    }
  }
  return null;
}

function tableRefs(tokens: readonly Token[]): TableRef[] {
  const refs: TableRef[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind !== 'word' || token.quoted || !TABLE_CLAUSES.has(token.text.toLowerCase())) continue;
    let cursor = index + 1;
    while (cursor < tokens.length) {
      const path = readPath(tokens, cursor);
      if (!path) break;
      cursor = path.next;
      let alias: string | null = null;
      const marker = tokens[cursor];
      if (marker?.kind === 'word' && !marker.quoted && marker.text.toLowerCase() === 'as') {
        const name = tokens[cursor + 1];
        if (name?.kind === 'word') {
          alias = name.text;
          cursor += 2;
        }
      } else if (marker?.kind === 'word' && (marker.quoted || !CLAUSE_WORDS.has(marker.text.toLowerCase()))) {
        alias = marker.text;
        cursor += 1;
      }
      refs.push({ path: path.text, alias });
      if (tokens[cursor]?.kind === 'other' && tokens[cursor]?.text === ',') {
        cursor += 1;
        continue;
      }
      break;
    }
  }
  return refs;
}

function readPath(tokens: readonly Token[], start: number): { text: string; next: number } | null {
  const first = readSegment(tokens, start);
  if (!first) return null;
  const parts = [first.text];
  let index = first.next;
  while (tokens[index]?.kind === 'dot' && tokens[index]?.start === tokens[index - 1]?.end) {
    const next = readSegment(tokens, index + 1);
    if (!next || next.start !== tokens[index]?.end) break;
    parts.push(next.text);
    index = next.next;
  }
  return { text: parts.join('.'), next: index };
}

function readSegment(tokens: readonly Token[], start: number): { text: string; start: number; next: number } | null {
  const first = tokens[start];
  if (first?.kind !== 'word') return null;
  if (!first.quoted && CLAUSE_WORDS.has(first.text.toLowerCase())) return null;
  let text = first.text;
  let end = first.end;
  let index = start + 1;
  while (
    !first.quoted &&
    tokens[index]?.kind === 'dash' &&
    tokens[index]?.start === end &&
    tokens[index + 1]?.kind === 'word' &&
    !tokens[index + 1]?.quoted &&
    tokens[index + 1]?.start === tokens[index]?.end
  ) {
    const next = tokens[index + 1];
    if (!next) break;
    text += `-${next.text}`;
    end = next.end;
    index += 2;
  }
  return { text, start: first.start, next: index };
}

function segmentsOf(sequence: readonly Token[]): { text: string; start: number; end: number; quoted: boolean }[] {
  const segments: { text: string; start: number; end: number; quoted: boolean }[] = [];
  let index = 0;
  while (index < sequence.length) {
    const segment = readSegment(sequence, index);
    if (!segment) {
      index += 1;
      continue;
    }
    const token = sequence[index];
    segments.push({
      text: segment.text,
      start: segment.start,
      end: sequence[segment.next - 1]?.end ?? segment.start,
      quoted: token?.quoted ?? false,
    });
    index = segment.next;
    if (sequence[index]?.kind === 'dot') index += 1;
  }
  return segments;
}

function scan(sql: string): { tokens: Token[]; opaque: { start: number; end: number }[] } {
  const tokens: Token[] = [];
  const opaque: { start: number; end: number }[] = [];
  let index = 0;
  while (index < sql.length) {
    const current = sql[index] ?? '';
    if (current === ' ' || current === '\t' || current === '\n' || current === '\r' || current === '\f') {
      index += 1;
      continue;
    }
    if (current === '-' && sql[index + 1] === '-') {
      const start = index;
      index += 2;
      while (index < sql.length && sql[index] !== '\n') index += 1;
      opaque.push({ start, end: index });
      continue;
    }
    if (current === '-') {
      tokens.push({ kind: 'dash', text: '-', start: index, end: index + 1, quoted: false });
      index += 1;
      continue;
    }
    if (current === '/' && sql[index + 1] === '*') {
      const start = index;
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index = Math.min(sql.length, index + 2);
      opaque.push({ start, end: index });
      continue;
    }
    if (current === "'" || current === '"') {
      const quote = current;
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index += 2;
          continue;
        }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      opaque.push({ start, end: index });
      continue;
    }
    if (current === '`') {
      const start = index;
      index += 1;
      let text = '';
      while (index < sql.length) {
        if (sql[index] === '`' && sql[index + 1] === '`') {
          text += '`';
          index += 2;
          continue;
        }
        if (sql[index] === '`') {
          index += 1;
          break;
        }
        text += sql[index] ?? '';
        index += 1;
      }
      tokens.push({ kind: 'word', text, start, end: index, quoted: true });
      continue;
    }
    if (current === '.') {
      tokens.push({ kind: 'dot', text: '.', start: index, end: index + 1, quoted: false });
      index += 1;
      continue;
    }
    if (/[A-Za-z0-9_]/.test(current)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index] ?? '')) index += 1;
      tokens.push({ kind: 'word', text: sql.slice(start, index), start, end: index, quoted: false });
      continue;
    }
    tokens.push({ kind: 'other', text: current, start: index, end: index + 1, quoted: false });
    index += 1;
  }
  return { tokens, opaque };
}

function quotedPrefix(sql: string, token: { text: string; start: number; end: number }, offset: number): string {
  if (offset >= token.end) return token.text;
  let text = '';
  let index = token.start + 1;
  const stop = Math.min(offset, token.end);
  while (index < stop) {
    if (sql[index] === '`' && sql[index + 1] === '`') {
      text += '`';
      index += 2;
      continue;
    }
    if (sql[index] === '`') break;
    text += sql[index] ?? '';
    index += 1;
  }
  return text;
}

function quoteIdent(part: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) return part;
  return `\`${part.replace(/`/g, '``')}\``;
}

function isIdentToken(token: Token | undefined): token is Token {
  return token?.kind === 'word' || token?.kind === 'dot' || token?.kind === 'dash';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
