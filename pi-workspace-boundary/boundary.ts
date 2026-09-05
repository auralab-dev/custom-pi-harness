import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export class WorkspaceBoundaryError extends Error {
  constructor(path: string) {
    super(`Path is outside the current workspace: ${path}`);
    this.name = "WorkspaceBoundaryError";
  }
}

export async function assertPathInsideWorkspace(
  workspaceRoot: string,
  requestedPath: string,
): Promise<void> {
  const canonicalRoot = await realpath(workspaceRoot);
  let canonicalTarget: string;

  try {
    canonicalTarget = await realpath(resolve(canonicalRoot, requestedPath));
  } catch {
    throw new WorkspaceBoundaryError(requestedPath);
  }

  const relativePath = relative(canonicalRoot, canonicalTarget);
  if (
    relativePath === ""
    || (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  ) {
    return;
  }

  throw new WorkspaceBoundaryError(requestedPath);
}
