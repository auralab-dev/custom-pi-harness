import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { renderDocument, renderDocuments } from '../render/documents.js';
import { asRecord, pickNumber, pickString } from '../util/unknown.js';
import {
  acknowledgeMutation,
  handleToolError,
  deliverRead,
  type ToolServices,
} from './common.js';

export function registerDocumentTools(server: McpServer, services: ToolServices): void {
  server.registerTool(
    'paperclip_documents',
    {
      title: 'List Paperclip issue documents',
      description:
        'List issue documents as compact Markdown. Results are inline below the configured token threshold and otherwise returned as a new immutable snapshot path. Default output omits document bodies; call paperclip_document for a body or all_fields=true for every returned field.',
      inputSchema: {
        issue_id: z.string().min(1),
        all_fields: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ issue_id, all_fields }) => {
      const operation = 'documents.list';
      try {
        const response = await services.client.request({
          path: `/api/issues/${encodeURIComponent(issue_id)}/documents`,
        });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderDocuments(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_document',
    {
      title: 'Read Paperclip issue document',
      description:
        'Fetch one issue document as Markdown. Results are inline below the configured token threshold and otherwise returned as a new immutable snapshot path. Annotation loading is controlled explicitly with include_annotations/include_annotation_comments. all_fields=true only expands fields from the same response.',
      inputSchema: {
        issue_id: z.string().min(1),
        key: z.string().regex(/^[a-z0-9_-]+$/),
        include_annotations: z.boolean().optional().default(false),
        include_annotation_comments: z.boolean().optional().default(false),
        all_fields: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ issue_id, key, include_annotations, include_annotation_comments, all_fields }) => {
      const operation = 'document.get';
      try {
        const response = await services.client.request({
          path: `/api/issues/${encodeURIComponent(issue_id)}/documents/${encodeURIComponent(key)}`,
          query: {
            includeAnnotations: include_annotations,
            includeAnnotationComments: include_annotations ? include_annotation_comments : false,
          },
        });
        return deliverRead({
          services,
          operation,
          response,
          markdown: renderDocument(response.data, all_fields),
          allFields: all_fields,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );

  server.registerTool(
    'paperclip_document_put',
    {
      title: 'Create or update Paperclip issue document',
      description:
        'Create a document or append a new revision. Updating an existing document normally requires base_revision_id from a fresh paperclip_document result. Returns only a compact acknowledgement.',
      inputSchema: {
        issue_id: z.string().min(1),
        key: z.string().regex(/^[a-z0-9_-]+$/),
        body: z.string(),
        title: z.string().optional(),
        change_summary: z.string().optional(),
        base_revision_id: z.string().nullable().optional(),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ issue_id, key, body, title, change_summary, base_revision_id }) => {
      const operation = 'document.put';
      try {
        const response = await services.client.request({
          method: 'PUT',
          path: `/api/issues/${encodeURIComponent(issue_id)}/documents/${encodeURIComponent(key)}`,
          body: {
            ...(title !== undefined ? { title } : {}),
            format: 'markdown',
            body,
            ...(change_summary !== undefined ? { changeSummary: change_summary } : {}),
            ...(base_revision_id !== undefined ? { baseRevisionId: base_revision_id } : {}),
          },
        });
        const object = asRecord(response.data);
        const revision = pickNumber(object, 'revisionNumber', 'latestRevisionNumber');
        const revisionId = pickString(object, 'revisionId', 'latestRevisionId', 'id');
        const suffix = revision !== undefined ? ` revision ${revision}` : revisionId ? ` revision ${revisionId}` : '';
        return acknowledgeMutation({
          services,
          operation,
          response,
          message: `Saved ${issue_id}/${key}${suffix}.`,
        });
      } catch (error) {
        return handleToolError(services, operation, error);
      }
    },
  );
}
