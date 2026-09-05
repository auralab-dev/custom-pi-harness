import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { renderComments } from '../render/comments.js';
import { asRecord, pickString } from '../util/unknown.js';
import {
  acknowledgeMutation,
  handleToolError,
  deliverRead,
  type ToolServices,
} from './common.js';

export function registerCommentTools(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_comments',
    {
      title: 'Read Paperclip comments',
      description:
        'Fetch issue comments as Markdown. Results are inline below the configured token threshold and otherwise returned as a new immutable snapshot path. Use after_comment_id for deltas instead of replaying an entire thread when possible. Call again for fresh comments.',
      inputSchema: {
        issue_id: z.string().min(1),
        after_comment_id: z.string().min(1).optional(),
        order: z.enum(['asc', 'desc']).optional().default('asc'),
        limit: z.number().int().min(1).max(500).optional().default(50),
        all_fields: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ issue_id, after_comment_id, order, limit, all_fields }) => {
      const operation = 'comments.list';
      try {
        const response = await services.client.request({
          path: `/api/issues/${encodeURIComponent(issue_id)}/comments`,
          query: {
            after: after_comment_id,
            order,
            limit,
          },
        });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderComments(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_comment_add',
    {
      title: 'Add Paperclip comment',
      description:
        'Add a comment to authoritative Paperclip state. Returns only a compact acknowledgement; the full created comment response is not injected into context.',
      inputSchema: {
        issue_id: z.string().min(1),
        body: z.string().min(1),
        reopen: z.boolean().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ issue_id, body, reopen }) => {
      const operation = 'comment.add';
      try {
        const response = await services.client.request({
          method: 'POST',
          path: `/api/issues/${encodeURIComponent(issue_id)}/comments`,
          body: {
            body,
            ...(reopen !== undefined ? { reopen } : {}),
          },
        });
        const commentId = pickString(asRecord(response.data), 'id', 'commentId');
        const message = commentId
          ? `Comment ${commentId} added to ${issue_id}.`
          : `Comment added to ${issue_id}.`;
        return acknowledgeMutation({ services, operation, response, message });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
