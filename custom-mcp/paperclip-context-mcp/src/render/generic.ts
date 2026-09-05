import { isRecord } from '../util/unknown.js';
import { escapeTableCell, sanitizeSingleLine, truncate } from '../util/text.js';

const DEFAULT_NOISY_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'companyId',
  'tenantId',
]);

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

export function compactGeneric(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactGeneric).filter((item) => !isEmpty(item));
  }

  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (DEFAULT_NOISY_KEYS.has(key) || isEmpty(child)) continue;
    const compacted = compactGeneric(child);
    if (!isEmpty(compacted)) result[key] = compacted;
  }
  return result;
}

function primitive(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

function labelForKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

function renderPrimitiveFields(object: Record<string, unknown>, lines: string[]): Set<string> {
  const rendered = new Set<string>();
  for (const [key, value] of Object.entries(object)) {
    const display = primitive(value);
    if (display === undefined) continue;

    if (display.includes('\n') || display.length > 240) continue;
    lines.push(`- **${labelForKey(key)}:** ${display || '—'}`);
    rendered.add(key);
  }
  return rendered;
}

function renderLongPrimitive(key: string, value: string, depth: number, lines: string[]): void {
  const heading = '#'.repeat(Math.min(6, depth + 2));
  lines.push(`${heading} ${labelForKey(key)}`, '', value, '');
}

function renderArray(key: string, value: unknown[], depth: number, lines: string[]): void {
  const heading = '#'.repeat(Math.min(6, depth + 2));
  lines.push(`${heading} ${labelForKey(key)}`, '');

  if (value.length === 0) {
    lines.push('_None._', '');
    return;
  }

  if (value.every((item) => primitive(item) !== undefined)) {
    for (const item of value) lines.push(`- ${primitive(item)}`);
    lines.push('');
    return;
  }

  const objectItems = value.filter(isRecord);
  if (objectItems.length === value.length && objectItems.length > 1) {
    const candidateColumns = inferTableColumns(objectItems);
    if (candidateColumns.length > 0 && candidateColumns.length <= 8) {
      lines.push(renderObjectTable(objectItems, candidateColumns), '');
      return;
    }
  }

  value.forEach((item, index) => {
    const itemHeading = '#'.repeat(Math.min(6, depth + 3));
    lines.push(`${itemHeading} Item ${index + 1}`, '');
    renderValue(item, depth + 2, lines);
  });
}

function inferTableColumns(items: Array<Record<string, unknown>>): string[] {
  const counts = new Map<string, number>();
  for (const item of items.slice(0, 20)) {
    for (const [key, value] of Object.entries(item)) {
      const display = primitive(value);
      if (display !== undefined && !display.includes('\n') && display.length <= 120) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= Math.max(1, Math.ceil(Math.min(items.length, 20) * 0.6)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => key);
}

function renderObjectTable(items: Array<Record<string, unknown>>, columns: string[]): string {
  const header = `| ${columns.map(labelForKey).join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const rows = items.map((item) => {
    const cells = columns.map((column) => {
      const display = primitive(item[column]);
      return escapeTableCell(display === undefined ? '—' : truncate(display, 120));
    });
    return `| ${cells.join(' | ')} |`;
  });
  return [header, separator, ...rows].join('\n');
}

function renderObject(object: Record<string, unknown>, depth: number, lines: string[]): void {
  const primitiveLines: string[] = [];
  const renderedPrimitiveKeys = renderPrimitiveFields(object, primitiveLines);
  if (primitiveLines.length > 0) lines.push(...primitiveLines, '');

  for (const [key, value] of Object.entries(object)) {
    if (renderedPrimitiveKeys.has(key)) continue;

    if (typeof value === 'string') {
      renderLongPrimitive(key, value, depth, lines);
    } else if (Array.isArray(value)) {
      renderArray(key, value, depth, lines);
    } else if (isRecord(value)) {
      const heading = '#'.repeat(Math.min(6, depth + 2));
      lines.push(`${heading} ${labelForKey(key)}`, '');
      renderObject(value, depth + 1, lines);
    } else if (value === null) {
      lines.push(`- **${labelForKey(key)}:** null`);
    }
  }
}

function renderValue(value: unknown, depth: number, lines: string[]): void {
  const display = primitive(value);
  if (display !== undefined) {
    lines.push(display, '');
    return;
  }
  if (Array.isArray(value)) {
    renderArray('items', value, depth, lines);
    return;
  }
  if (isRecord(value)) {
    renderObject(value, depth, lines);
    return;
  }
  lines.push(sanitizeSingleLine(String(value)), '');
}

export function renderGenericMarkdown(
  value: unknown,
  options: { title?: string; allFields?: boolean } = {},
): string {
  const data = options.allFields ? value : compactGeneric(value);
  const lines: string[] = [];
  if (options.title) lines.push(`# ${options.title}`, '');
  renderValue(data, 0, lines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
