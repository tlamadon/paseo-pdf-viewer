import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { type listDocuments, MAX_REMEMBERED_DOCUMENTS, type openDocument } from "../shared/documents";
import { resolvePdfPath } from "./pdf";

const stateFile = path.join(
  process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"),
  "paseo-pdf-viewer",
  "documents.json",
);

async function readRemembered(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

async function writeRemembered(absolutePaths: string[]): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(absolutePaths, null, 2)}\n`);
}

export async function openPdfDocument({
  directory,
  path: requested,
}: RpcInput<typeof openDocument>): Promise<RpcOutput<typeof openDocument>> {
  const absolutePath = resolvePdfPath(directory, requested);
  const info = await stat(absolutePath).catch(() => null);
  if (!info?.isFile()) throw new Error(`No such PDF: ${absolutePath}`);

  // Most recent first; the oldest fall off the end.
  const remembered = [absolutePath, ...(await readRemembered()).filter((entry) => entry !== absolutePath)];
  const forgotten = remembered.splice(MAX_REMEMBERED_DOCUMENTS);
  await writeRemembered(remembered);
  return { absolutePath, forgotten };
}

export async function listRememberedDocuments(
  _input: RpcInput<typeof listDocuments>,
): Promise<RpcOutput<typeof listDocuments>> {
  return { absolutePaths: await readRemembered() };
}
