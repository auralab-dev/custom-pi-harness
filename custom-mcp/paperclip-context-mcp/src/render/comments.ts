import { asArray, asRecord, displayName, pickRecord, pickString } from '../util/unknown.js';
import { renderGenericMarkdown } from './generic.js';

function commentList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = asRecord(value);
  if (!root) return [];
  for (const key of ['comments', 'items', 'data', 'results']) {
    const array = asArray(root[key]);
    if (array) return array;
  }
  return [];
}

function author(comment: Record<string, unknown>): string {
  return (
    displayName(pickRecord(comment, 'author', 'agent', 'user', 'createdByAgent', 'createdByUser')) ??
    pickString(comment, 'authorName', 'createdByName') ??
    'Unknown author'
  );
}

export function renderComments(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Comments — all fields', allFields: true });
  const comments = commentList(value).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const lines = ['# Comments', ''];
  if (comments.length === 0) return `${lines.join('\n')}No comments.`;

  for (const comment of comments) {
    const created = pickString(comment, 'createdAt', 'timestamp');
    lines.push(`## ${author(comment)}${created ? ` — ${created}` : ''}`, '');
    lines.push(pickString(comment, 'body', 'text', 'content') ?? '_No body._', '');
  }
  return lines.join('\n').trim();
}
