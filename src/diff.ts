export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

export interface DiffCell {
  kind: 'same' | 'add' | 'remove' | 'empty';
  text: string;
}

export interface DiffRow {
  left: DiffCell;
  right: DiffCell;
}

/** Line diff from `before` to `after`. An empty string has no lines. */
export function diffLines(before: string, after: string): DiffLine[] {
  const source = splitLines(before);
  const target = splitLines(after);
  const sourceLength = source.length;
  const targetLength = target.length;
  if (sourceLength === 0 && targetLength === 0) return [];

  const max = sourceLength + targetLength;
  const furthest = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];

  for (let depth = 0; depth <= max; depth += 1) {
    trace.push(new Map(furthest));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down =
        diagonal === -depth ||
        (diagonal !== depth && (furthest.get(diagonal - 1) ?? 0) < (furthest.get(diagonal + 1) ?? 0));
      let x = down ? (furthest.get(diagonal + 1) ?? 0) : (furthest.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < sourceLength && y < targetLength && source[x] === target[y]) {
        x += 1;
        y += 1;
      }
      furthest.set(diagonal, x);
      if (x >= sourceLength && y >= targetLength) return walk(trace, source, target, depth);
    }
  }

  return target.map(text => ({ kind: 'add', text }));
}

/** Align a line diff into left (before) and right (after) cells. */
export function diffSideBySide(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let removed: string[] = [];
  let added: string[] = [];

  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1) {
      const left = removed[index];
      const right = added[index];
      rows.push({
        left: left === undefined ? { kind: 'empty', text: '' } : { kind: 'remove', text: left },
        right: right === undefined ? { kind: 'empty', text: '' } : { kind: 'add', text: right },
      });
    }
    removed = [];
    added = [];
  };

  for (const line of diffLines(before, after)) {
    if (line.kind === 'same') {
      flush();
      rows.push({
        left: { kind: 'same', text: line.text },
        right: { kind: 'same', text: line.text },
      });
      continue;
    }
    if (line.kind === 'remove') removed.push(line.text);
    else added.push(line.text);
  }
  flush();
  return rows;
}

function splitLines(value: string): string[] {
  if (value === '') return [];
  return value.split('\n');
}

function walk(
  trace: Map<number, number>[],
  source: string[],
  target: string[],
  depthEnd: number,
): DiffLine[] {
  const lines: DiffLine[] = [];
  let x = source.length;
  let y = target.length;

  for (let depth = depthEnd; depth > 0; depth -= 1) {
    const furthest = trace[depth];
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth && (furthest.get(diagonal - 1) ?? 0) < (furthest.get(diagonal + 1) ?? 0))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = furthest.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      lines.push({ kind: 'same', text: source[x] ?? '' });
    }

    if (x === previousX) {
      y -= 1;
      lines.push({ kind: 'add', text: target[y] ?? '' });
    } else {
      x -= 1;
      lines.push({ kind: 'remove', text: source[x] ?? '' });
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    lines.push({ kind: 'same', text: source[x] ?? '' });
  }
  while (x > 0) {
    x -= 1;
    lines.push({ kind: 'remove', text: source[x] ?? '' });
  }
  while (y > 0) {
    y -= 1;
    lines.push({ kind: 'add', text: target[y] ?? '' });
  }

  lines.reverse();
  return lines;
}
