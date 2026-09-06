import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { assertPathInsideWorkspace } from "./boundary.ts";

export interface WorkspaceBoundaryOptions {
  restrictRead?: boolean;
}

export function createWorkspaceBoundaryHook(
  workspaceRoot: string,
  options: WorkspaceBoundaryOptions = {},
) {
  const restrictRead = options.restrictRead ?? true;

  return async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
    if (isToolCallEventType("read", event)) {
      if (!restrictRead) {
        return undefined;
      }

      const requestedPath = event.input.path?.trim() ?? "";
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
    }

    if (isToolCallEventType("find", event)) {
      const requestedPath = event.input.path?.trim() || ".";

      try {
        await assertPathInsideWorkspace(workspaceRoot, requestedPath);
        return undefined;
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : "Path is outside the current workspace",
        };
      }
    }

    return undefined;
  };
}

export default function workspaceBoundary(pi: ExtensionAPI) {
  pi.on(
    "tool_call",
    createWorkspaceBoundaryHook(process.cwd(), {
      restrictRead: false,
    }),
  );
}