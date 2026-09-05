import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { renderHeartbeatContext, renderIssue, renderIssueList } from '../render/issues.js';
import { asRecord, pickString } from '../util/unknown.js';
import {
  acknowledgeMutation,
  handleToolError,
  deliverRead,
  mergeExtra,
  type ToolServices,
} from './common.js';

const allFieldsSchema = z
  .boolean()
  .optional()
  .default(false)
  .describe('Expand fields from this same Paperclip endpoint response. This never changes endpoint or collection scope.');

const extraSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('Uncommon Paperclip request fields not covered by the dedicated arguments.');

function issueRef(data: unknown, fallback: string): string {
  const object = asRecord(data);
  return pickString(object, 'identifier', 'id') ?? fallback;
}

function issueTitle(data: unknown): string | undefined {
  return pickString(asRecord(data), 'title', 'name');
}

function changedSummary(body: Record<string, unknown>): string {
  const labels: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === 'comment') {
      labels.push('comment added');
      continue;
    }
    if (key === 'description') {
      labels.push('description updated');
      continue;
    }
    if (value === null) labels.push(`${key} cleared`);
    else if (['string', 'number', 'boolean'].includes(typeof value)) labels.push(`${key} → ${String(value)}`);
    else labels.push(`${key} updated`);
  }
  return labels.join(', ');
}

export function registerIssueTools(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_inbox',
    {
      title: 'Paperclip inbox',
      description:
        'Fetch the current agent compact inbox. Returns Markdown inline when it fits the configured token threshold; otherwise returns only a new immutable snapshot path. Call again whenever fresh assignment state matters.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      const operation = 'inbox.get';
      try {
        const response = await services.client.request({ path: '/api/agents/me/inbox-lite' });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderIssueList(response.data),
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issue',
    {
      title: 'Read Paperclip issue',
      description:
        'Fetch one issue with GET /api/issues/:id. Returns Markdown inline when it fits the configured token threshold; otherwise returns only a NEW immutable snapshot path. all_fields=true only expands fields from that same response; it never changes the endpoint. Never edit snapshots to modify Paperclip.',
      inputSchema: {
        id: z.string().min(1).describe('Issue UUID or human identifier such as PAP-123.'),
        all_fields: allFieldsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, all_fields }) => {
      const operation = 'issue.get';
      try {
        const response = await services.client.request({ path: `/api/issues/${encodeURIComponent(id)}` });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderIssue(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_heartbeat_context',
    {
      title: 'Read Paperclip heartbeat context',
      description:
        'Fetch GET /api/issues/:id/heartbeat-context explicitly. Returns Markdown inline when it fits the configured token threshold; otherwise returns only a NEW immutable snapshot path. Use this when the smaller wake/execution context is what you want. all_fields=true only expands fields from this same heartbeat-context response.',
      inputSchema: {
        id: z.string().min(1).describe('Issue UUID or human identifier such as PAP-123.'),
        all_fields: allFieldsSchema,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, all_fields }) => {
      const operation = 'issue.heartbeat_context';
      try {
        const response = await services.client.request({
          path: `/api/issues/${encodeURIComponent(id)}/heartbeat-context`,
        });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderHeartbeatContext(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issues',
    {
      title: 'List or search Paperclip issues',
      description:
        'Return a compact Markdown list from GET /api/companies/:companyId/issues. With no filters and no limit, Paperclip returns all visible company issues. Filters narrow the list; limit caps it. Results are inline below the configured token threshold and otherwise returned as a snapshot path. Use paperclip_issue for details on one issue.',
      inputSchema: {
        q: z.string().min(1).optional().describe('Full-text issue search query.'),
        status: z.union([z.string(), z.array(z.string())]).optional().describe('Status or statuses.'),
        assignee_agent_id: z.string().min(1).optional(),
        participant_agent_id: z.string().min(1).optional(),
        assignee_user_id: z.string().min(1).optional(),
        project_id: z.string().min(1).optional(),
        execution_workspace_id: z.string().min(1).optional(),
        parent_id: z.string().min(1).optional(),
        label_id: z.string().min(1).optional(),
        origin_kind: z.string().min(1).optional(),
        origin_id: z.string().min(1).optional(),
        include_routine_executions: z.boolean().optional(),
        limit: z.number().int().min(1).optional().describe('Optional result cap. Omit to request all matching issues.'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({
      q,
      status,
      assignee_agent_id,
      participant_agent_id,
      assignee_user_id,
      project_id,
      execution_workspace_id,
      parent_id,
      label_id,
      origin_kind,
      origin_id,
      include_routine_executions,
      limit,
    }) => {
      const operation = 'issues.list';
      try {
        const companyId = services.client.requireCompanyId();
        const response = await services.client.request({
          path: `/api/companies/${encodeURIComponent(companyId)}/issues`,
          query: {
            q,
            status: Array.isArray(status) ? status.join(',') : status,
            assigneeAgentId: assignee_agent_id,
            participantAgentId: participant_agent_id,
            assigneeUserId: assignee_user_id,
            projectId: project_id,
            executionWorkspaceId: execution_workspace_id,
            parentId: parent_id,
            labelId: label_id,
            originKind: origin_kind,
            originId: origin_id,
            includeRoutineExecutions: include_routine_executions,
            limit,
          },
        });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderIssueList(response.data),
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issue_create',
    {
      title: 'Create Paperclip issue',
      description:
        'Create an issue/subtask in authoritative Paperclip state. Returns only a compact acknowledgement; the full created issue response is deliberately not injected into model context.',
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.string().nullable().optional(),
        goal_id: z.string().nullable().optional(),
        parent_id: z.string().nullable().optional(),
        assignee_agent_id: z.string().nullable().optional(),
        assignee_user_id: z.string().nullable().optional(),
        blocked_by_issue_ids: z.array(z.string()).optional(),
        label_ids: z.array(z.string()).optional(),
        extra: extraSchema,
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({
      title,
      description,
      status,
      priority,
      project_id,
      goal_id,
      parent_id,
      assignee_agent_id,
      assignee_user_id,
      blocked_by_issue_ids,
      label_ids,
      extra,
    }) => {
      const operation = 'issue.create';
      try {
        const companyId = services.client.requireCompanyId();
        const body = mergeExtra(extra, {
          title,
          description,
          status,
          priority,
          projectId: project_id,
          goalId: goal_id,
          parentId: parent_id,
          assigneeAgentId: assignee_agent_id,
          assigneeUserId: assignee_user_id,
          blockedByIssueIds: blocked_by_issue_ids,
          labelIds: label_ids,
        });
        const response = await services.client.request({
          method: 'POST',
          path: `/api/companies/${encodeURIComponent(companyId)}/issues`,
          body,
        });
        const ref = issueRef(response.data, 'issue');
        const createdTitle = issueTitle(response.data) ?? title;
        return acknowledgeMutation({
          services,
          operation,
          response,
          message: `Created ${ref}${createdTitle ? ` — ${createdTitle}` : ''}.`,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issue_update',
    {
      title: 'Update Paperclip issue',
      description:
        'Update authoritative issue state. Use this for status/assignment/field changes and optional comments; never edit snapshot files. Returns only a compact acknowledgement.',
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        project_id: z.string().nullable().optional(),
        goal_id: z.string().nullable().optional(),
        parent_id: z.string().nullable().optional(),
        assignee_agent_id: z.string().nullable().optional(),
        assignee_user_id: z.string().nullable().optional(),
        blocked_by_issue_ids: z.array(z.string()).optional(),
        label_ids: z.array(z.string()).optional(),
        comment: z.string().min(1).optional(),
        reopen: z.boolean().optional(),
        interrupt: z.boolean().optional(),
        hidden_at: z.string().nullable().optional(),
        extra: extraSchema,
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({
      id,
      title,
      description,
      status,
      priority,
      project_id,
      goal_id,
      parent_id,
      assignee_agent_id,
      assignee_user_id,
      blocked_by_issue_ids,
      label_ids,
      comment,
      reopen,
      interrupt,
      hidden_at,
      extra,
    }) => {
      const operation = 'issue.update';
      try {
        const body = mergeExtra(extra, {
          title,
          description,
          status,
          priority,
          projectId: project_id,
          goalId: goal_id,
          parentId: parent_id,
          assigneeAgentId: assignee_agent_id,
          assigneeUserId: assignee_user_id,
          blockedByIssueIds: blocked_by_issue_ids,
          labelIds: label_ids,
          comment,
          reopen,
          interrupt,
          hiddenAt: hidden_at,
        });
        if (Object.keys(body).length === 0) throw new Error('paperclip_issue_update requires at least one field to update.');

        const response = await services.client.request({
          method: 'PATCH',
          path: `/api/issues/${encodeURIComponent(id)}`,
          body,
        });
        const ref = issueRef(response.data, id);
        const changed = changedSummary(body);
        return acknowledgeMutation({
          services,
          operation,
          response,
          message: `Updated ${ref}${changed ? `: ${changed}` : ''}.`,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issue_checkout',
    {
      title: 'Checkout Paperclip issue',
      description:
        'Atomically claim an issue for the current agent. A 409 is terminal: do not retry or steal the lock. Set reclaim_stale=true only when adopting your own stale in_progress checkout after a crashed run.',
      inputSchema: {
        id: z.string().min(1),
        reclaim_stale: z.boolean().optional().default(false),
        expected_statuses: z.array(z.string()).min(1).optional().describe('Advanced override; normally omit.'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, reclaim_stale, expected_statuses }) => {
      const operation = 'issue.checkout';
      try {
        const agentId = services.client.requireAgentId();
        const expectedStatuses =
          expected_statuses ?? ['todo', 'backlog', 'blocked', 'in_review', ...(reclaim_stale ? ['in_progress'] : [])];
        const response = await services.client.request({
          method: 'POST',
          path: `/api/issues/${encodeURIComponent(id)}/checkout`,
          body: { agentId, expectedStatuses },
        });
        const ref = issueRef(response.data, id);
        return acknowledgeMutation({
          services,
          operation,
          response,
          message: `Checked out ${ref}.`,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_issue_release',
    {
      title: 'Release Paperclip issue',
      description: 'Release the current agent checkout and return the issue to todo. Returns only a compact acknowledgement.',
      inputSchema: { id: z.string().min(1) },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ id }) => {
      const operation = 'issue.release';
      try {
        const response = await services.client.request({
          method: 'POST',
          path: `/api/issues/${encodeURIComponent(id)}/release`,
          body: {},
        });
        const ref = issueRef(response.data, id);
        return acknowledgeMutation({
          services,
          operation,
          response,
          message: `Released ${ref} to todo.`,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
