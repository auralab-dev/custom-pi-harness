import type { RuntimeContext } from '../config.js';
import { renderGenericMarkdown } from './generic.js';

export interface RenderedRuntimeContext {
  inline: string;
  wakePayloadMarkdown?: string;
}

export function renderRuntimeContext(runtime: RuntimeContext): RenderedRuntimeContext {
  const lines = ['Paperclip runtime context:'];
  if (runtime.agentId) lines.push(`Agent: ${runtime.agentId}`);
  if (runtime.companyId) lines.push(`Company: ${runtime.companyId}`);
  if (runtime.runId) lines.push(`Run: ${runtime.runId}`);
  if (runtime.taskId) lines.push(`Task: ${runtime.taskId}`);
  if (runtime.wakeReason) lines.push(`Wake reason: ${runtime.wakeReason}`);
  if (runtime.wakeCommentId) lines.push(`Wake comment: ${runtime.wakeCommentId}`);
  if (runtime.approvalId) lines.push(`Approval: ${runtime.approvalId}`);
  if (runtime.approvalStatus) lines.push(`Approval status: ${runtime.approvalStatus}`);
  if (runtime.linkedIssueIds.length > 0) lines.push(`Linked issues: ${runtime.linkedIssueIds.join(', ')}`);

  let wakePayloadMarkdown: string | undefined;
  if (runtime.wakePayloadJson) {
    try {
      const payload = JSON.parse(runtime.wakePayloadJson) as unknown;
      wakePayloadMarkdown = renderGenericMarkdown(payload, { title: 'Wake payload' });
    } catch {
      wakePayloadMarkdown = `# Wake payload\n\n${runtime.wakePayloadJson}`;
    }
  }

  return {
    inline: lines.join('\n'),
    ...(wakePayloadMarkdown ? { wakePayloadMarkdown } : {}),
  };
}
