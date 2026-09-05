import { asArray, asRecord, pickNumber, pickString } from '../util/unknown.js';
import { escapeTableCell, truncate } from '../util/text.js';
import { renderGenericMarkdown } from './generic.js';

function documentList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = asRecord(value);
  if (!root) return [];
  for (const key of ['documents', 'items', 'data', 'results']) {
    const array = asArray(root[key]);
    if (array) return array;
  }
  return [];
}

export function renderDocuments(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Issue documents — all fields', allFields: true });

  const docs = documentList(value).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const lines = ['# Documents', ''];
  if (docs.length === 0) return `${lines.join('\n')}No documents.`;

  lines.push('| Key | Title | Revision | Format |');
  lines.push('|---|---|---:|---|');
  for (const doc of docs) {
    const key = pickString(doc, 'key', 'documentKey', 'id') ?? '—';
    const title = pickString(doc, 'title', 'name') ?? '—';
    const revision = pickNumber(doc, 'revisionNumber', 'latestRevisionNumber') ?? pickString(doc, 'revisionNumber') ?? '—';
    const format = pickString(doc, 'format') ?? 'markdown';
    lines.push(
      `| ${escapeTableCell(key)} | ${escapeTableCell(truncate(title, 140))} | ${escapeTableCell(String(revision))} | ${escapeTableCell(format)} |`,
    );
  }
  lines.push('', `${docs.length} document(s). Bodies omitted; call paperclip_document for one document.`);
  return lines.join('\n');
}

export function renderDocument(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Issue document — all fields', allFields: true });
  const doc = asRecord(value);
  if (!doc) return renderGenericMarkdown(value, { title: 'Issue document' });

  const key = pickString(doc, 'key', 'documentKey') ?? 'document';
  const title = pickString(doc, 'title', 'name') ?? key;
  const format = pickString(doc, 'format') ?? 'markdown';
  const revision = pickNumber(doc, 'revisionNumber', 'latestRevisionNumber');
  const body = pickString(doc, 'body', 'content', 'markdown') ?? '';

  const lines = [`# ${title}`, '', `**Key:** ${key}  `, `**Format:** ${format}  `];
  if (revision !== undefined) lines.push(`**Revision:** ${revision}  `);
  lines.push('', body || '_Empty document._');
  return lines.join('\n').trim();
}
