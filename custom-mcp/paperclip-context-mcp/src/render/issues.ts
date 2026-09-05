import {
  asArray,
  asRecord,
  displayName,
  pickArray,
  pickBoolean,
  pickNumber,
  pickRecord,
  pickString,
  summarizeIdentity,
} from '../util/unknown.js';
import { escapeTableCell, truncate } from '../util/text.js';
import { renderGenericMarkdown } from './generic.js';

function issueObject(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  return pickRecord(root, 'issue') ?? root;
}

function issueLabel(issue: Record<string, unknown>): string {
  const identifier = pickString(issue, 'identifier', 'key', 'id') ?? 'Issue';
  const title = pickString(issue, 'title', 'name');
  return title ? `${identifier} — ${title}` : identifier;
}

function assigneeLabel(issue: Record<string, unknown>): string | undefined {
  const nested = pickRecord(issue, 'assigneeAgent', 'assignee', 'agent');
  return displayName(nested) ?? pickString(issue, 'assigneeAgentName', 'assigneeName', 'assigneeAgentId');
}

function relatedLabel(issue: Record<string, unknown>, nestedKeys: string[], idKeys: string[]): string | undefined {
  for (const key of nestedKeys) {
    const nested = issue[key];
    const label = summarizeIdentity(nested);
    if (label) return label;
  }
  return pickString(issue, ...idKeys);
}

function renderBlockers(issue: Record<string, unknown>): string[] {
  const values = pickArray(issue, 'blockedBy', 'blockers', 'blockedByIssues') ?? [];
  return values.map((value) => summarizeIdentity(value)).filter((value): value is string => Boolean(value));
}

function renderLabels(issue: Record<string, unknown>): string[] {
  const values = pickArray(issue, 'labels') ?? [];
  return values.map(displayName).filter((value): value is string => Boolean(value));
}

function primitiveLine(label: string, value: string | number | boolean | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  return `**${label}:** ${String(value)}`;
}

export function renderIssue(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Paperclip issue — all fields', allFields: true });

  const issue = issueObject(value);
  if (!issue) return renderGenericMarkdown(value, { title: 'Paperclip issue' });

  const lines: string[] = [`# ${issueLabel(issue)}`, ''];
  const top = [
    primitiveLine('Status', pickString(issue, 'status')),
    primitiveLine('Priority', pickString(issue, 'priority')),
    primitiveLine('Assignee', assigneeLabel(issue)),
    primitiveLine('Ready', pickBoolean(issue, 'dependencyReady', 'ready')),
  ].filter((line): line is string => Boolean(line));
  if (top.length > 0) lines.push(top.join('  \n'), '');

  const description = pickString(issue, 'description', 'body');
  if (description) lines.push('## Description', '', description, '');

  const blockers = renderBlockers(issue);
  const unresolvedCount = pickNumber(issue, 'unresolvedBlockerCount');
  if (blockers.length > 0 || (unresolvedCount !== undefined && unresolvedCount > 0)) {
    lines.push('## Blockers', '');
    if (blockers.length > 0) lines.push(...blockers.map((blocker) => `- ${blocker}`));
    else lines.push(`- ${unresolvedCount} unresolved blocker(s)`);
    lines.push('');
  }

  const context: string[] = [];
  const project = relatedLabel(issue, ['project'], ['projectName', 'projectId']);
  const goal = relatedLabel(issue, ['goal'], ['goalName', 'goalId']);
  const parent = relatedLabel(issue, ['parent'], ['parentIdentifier', 'parentId']);
  const currentParticipant = relatedLabel(
    pickRecord(issue, 'executionState') ?? {},
    ['currentParticipant'],
    ['currentParticipantId'],
  );
  if (project) context.push(`- **Project:** ${project}`);
  if (goal) context.push(`- **Goal:** ${goal}`);
  if (parent) context.push(`- **Parent:** ${parent}`);
  if (currentParticipant) context.push(`- **Current participant:** ${currentParticipant}`);
  const labels = renderLabels(issue);
  if (labels.length > 0) context.push(`- **Labels:** ${labels.join(', ')}`);
  if (context.length > 0) lines.push('## Context', '', ...context, '');

  return lines.join('\n').trim();
}

export function renderHeartbeatContext(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Heartbeat context — all fields', allFields: true });

  const root = asRecord(value);
  if (!root) return renderGenericMarkdown(value, { title: 'Heartbeat context' });
  const issue = pickRecord(root, 'issue') ?? root;

  const lines = [renderIssue(issue, false), ''];

  const ancestors = pickArray(root, 'ancestors');
  if (ancestors && ancestors.length > 0) {
    lines.push('## Ancestors', '', ...ancestors.map(summarizeIdentity).filter(Boolean).map((item) => `- ${item}`), '');
  }

  const project = pickRecord(root, 'project');
  if (project) {
    const label = summarizeIdentity(project);
    if (label) lines.push('## Project', '', label, '');
  }

  const goal = pickRecord(root, 'goal');
  if (goal) {
    const label = summarizeIdentity(goal);
    if (label) lines.push('## Goal', '', label, '');
  }

  const wakeComment = pickRecord(root, 'wakeComment');
  if (wakeComment) {
    const author = displayName(pickRecord(wakeComment, 'author', 'agent', 'user')) ?? pickString(wakeComment, 'authorName');
    const body = pickString(wakeComment, 'body', 'text', 'content');
    lines.push('## Wake comment', '');
    if (author) lines.push(`**${author}**`, '');
    if (body) lines.push(body, '');
  }

  const planReview = root.planReviewContext;
  if (planReview !== undefined && planReview !== null) {
    lines.push('## Plan review', '', renderGenericMarkdown(planReview), '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function listFromPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = asRecord(value);
  if (!root) return [];
  for (const key of ['items', 'issues', 'data', 'results']) {
    const array = asArray(root[key]);
    if (array) return array;
  }
  return [];
}

export function renderIssueList(value: unknown): string {
  const items = listFromPayload(value).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));

  const lines = ['# Issues', ''];
  if (items.length === 0) return `${lines.join('\n')}No issues.`;

  lines.push('| Issue | Status | Priority | Assignee | Ready | Title |');
  lines.push('|---|---|---|---|---|---|');
  for (const item of items) {
    const identifier = pickString(item, 'identifier', 'key', 'id') ?? '—';
    const status = pickString(item, 'status') ?? '—';
    const priority = pickString(item, 'priority') ?? '—';
    const assignee = assigneeLabel(item) ?? '—';
    const ready = pickBoolean(item, 'dependencyReady', 'ready');
    const title = pickString(item, 'title', 'name') ?? '—';
    lines.push(
      `| ${escapeTableCell(identifier)} | ${escapeTableCell(status)} | ${escapeTableCell(priority)} | ${escapeTableCell(assignee)} | ${ready === undefined ? '—' : ready ? 'yes' : 'no'} | ${escapeTableCell(truncate(title, 140))} |`,
    );
  }
  lines.push('', `${items.length} result(s).`);
  return lines.join('\n');
}
