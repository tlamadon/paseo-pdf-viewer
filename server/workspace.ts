import { realpath } from "node:fs/promises";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

type Paseo = PluginHandlerContext["paseo"];

// Every file the plugin reads is confined to a workspace directory, which the daemon looks up
// itself: clients name a workspace, never a directory.
const ROOT_TTL_MS = 30_000;
const roots = new Map<string, { root: string; expires: number }>();

export async function workspaceRoot(paseo: Paseo, workspaceId: string): Promise<string> {
  const cached = roots.get(workspaceId);
  if (cached && cached.expires > Date.now()) return cached.root;
  const workspace = await paseo.workspaces.ref(workspaceId).refresh();
  const directory = workspace?.workspaceDirectory;
  if (!directory) throw new Error("This workspace has no directory on the daemon");
  const root = await realpath(directory).catch(() => {
    throw new Error(`The workspace directory is missing: ${directory}`);
  });
  roots.set(workspaceId, { root, expires: Date.now() + ROOT_TTL_MS });
  return root;
}

export class OutsideWorkspaceError extends Error {
  constructor() {
    super("Only files inside the workspace can be opened");
  }
}

function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Resolves a workspace-relative or absolute path, rejecting anything that lands outside the
// workspace either as written or after following symlinks. Returns the real path.
export async function resolveInWorkspace(root: string, requested: string): Promise<string> {
  const trimmed = requested.trim().replace(/^["']|["']$/g, "");
  if (!trimmed || trimmed.includes("\0")) throw new Error("Enter a path to a PDF");
  if (trimmed === "~" || trimmed.startsWith("~/")) throw new OutsideWorkspaceError();
  const lexical = path.resolve(root, trimmed);
  if (!contains(root, lexical)) throw new OutsideWorkspaceError();
  const real = await realpath(lexical).catch(() => {
    throw new Error(`No such PDF: ${path.relative(root, lexical) || lexical}`);
  });
  if (!contains(root, real)) throw new OutsideWorkspaceError();
  return real;
}
