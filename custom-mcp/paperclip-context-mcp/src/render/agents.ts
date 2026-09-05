import { asArray, asRecord, pickString } from '../util/unknown.js';
import { escapeTableCell, truncate } from '../util/text.js';
import { renderGenericMarkdown } from './generic.js';

function agentList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = asRecord(value);
  if (!root) return [];
  for (const key of ['agents', 'items', 'data', 'results']) {
    const array = asArray(root[key]);
    if (array) return array;
  }
  return [];
}

export function renderAgents(value: unknown, allFields: boolean): string {
  if (allFields) return renderGenericMarkdown(value, { title: 'Agents — all fields', allFields: true });
  const root = asRecord(value);
  const list = Array.isArray(value) || (root && ['agents', 'items', 'data', 'results'].some((key) => Array.isArray(root[key])));
  if (!list && root) {
    const name = pickString(root, 'name', 'shortname', 'id') ?? 'Agent';
    const lines = [`# ${name}`, ''];
    for (const [label, keys] of [
      ['Role', ['role']],
      ['Title', ['title']],
      ['Status', ['status']],
      ['Reports to', ['reportsToName', 'reportsTo']],
      ['Capabilities', ['capabilities']],
    ] as const) {
      const text = pickString(root, ...keys);
      if (text) lines.push(`**${label}:** ${text}  `);
    }
    return lines.join('\n').trim();
  }

  const agents = agentList(value).map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const lines = ['# Agents', ''];
  if (agents.length === 0) return `${lines.join('\n')}No agents.`;
  lines.push('| Name | Role | Status | Title |');
  lines.push('|---|---|---|---|');
  for (const agent of agents) {
    lines.push(
      `| ${escapeTableCell(pickString(agent, 'name', 'shortname', 'id') ?? '—')} | ${escapeTableCell(pickString(agent, 'role') ?? '—')} | ${escapeTableCell(pickString(agent, 'status') ?? '—')} | ${escapeTableCell(truncate(pickString(agent, 'title') ?? '—', 120))} |`,
    );
  }
  lines.push('', `${agents.length} agent(s).`);
  return lines.join('\n');
}
