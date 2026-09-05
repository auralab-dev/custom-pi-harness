import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { assertPathInsideWorkspace } from "./boundary.ts";

export function createWorkspaceBoundaryHook(workspaceRoot: string) {
  return async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
    if (!isToolCallEventType("read", event) && !isToolCallEventType("find", event)) {
      return undefined;
    }

    const requestedPath = event.input.path?.trim() || (event.toolName === "find" ? "." : "");
    if (!requestedPath) {
      return { block: true, reason: "read requires a path inside the current workspace" };
    }

    try {
      await assertPathInsideWorkspace(workspaceRoot, requestedPath);
      return undefined;
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : "Path is outside the current workspace",
      };
    }
  };
}

export default function workspaceBoundary(pi: ExtensionAPI) {
  pi.on("tool_call", createWorkspaceBoundaryHook(process.cwd()));
}
