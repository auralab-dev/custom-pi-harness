import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { assertPathInsideWorkspace, WorkspaceBoundaryError } from "./boundary.ts";
import { createWorkspaceBoundaryHook } from "./index.ts";

test("allows the workspace root and files below it", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "pi-workspace-boundary-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const workspace = join(parent, "workspace");
  await mkdir(join(workspace, "nested"), { recursive: true });
  await writeFile(join(workspace, "nested", "file.txt"), "ok");

  await assert.doesNotReject(assertPathInsideWorkspace(workspace, "."));
  await assert.doesNotReject(assertPathInsideWorkspace(workspace, "nested/file.txt"));
  await assert.doesNotReject(assertPathInsideWorkspace(workspace, join(workspace, "nested", "file.txt")));
});

test("blocks parent, absolute, symlink, and unresolved paths", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "pi-workspace-boundary-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const workspace = join(parent, "workspace");
  const outside = join(parent, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(workspace, "escape"));

  for (const candidate of ["../outside/secret.txt", join(outside, "secret.txt"), "escape/secret.txt", "missing.txt"]) {
    await assert.rejects(assertPathInsideWorkspace(workspace, candidate), WorkspaceBoundaryError);
  }
});

test("blocks escaped read/find calls and ignores unrelated tools", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "pi-workspace-boundary-"));
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(parent, { recursive: true, force: true })));
  const workspace = join(parent, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "allowed.txt"), "ok");
  const hook = createWorkspaceBoundaryHook(workspace);
  const event = (toolName: string, input: Record<string, unknown>): ToolCallEvent => ({
    type: "tool_call",
    toolCallId: "test",
    toolName,
    input,
  } as ToolCallEvent);

  assert.equal(await hook(event("read", { path: "allowed.txt" })), undefined);
  assert.equal(await hook(event("find", { pattern: "*.txt" })), undefined);
  assert.equal((await hook(event("read", { path: "../secret.txt" })))?.block, true);
  assert.equal((await hook(event("find", { pattern: "*", path: ".." })))?.block, true);
  assert.equal(await hook(event("web_search", { query: "example" })), undefined);
});
