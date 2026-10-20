import type { PluginHookContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { MAX_TURN_CARD_FILES, TURN_CARD_KIND, TURN_CARD_VERSION, type TurnCardData } from "../shared/turn-cards";
import { scanPdfs } from "./pdf";
import { workspaceRoot } from "./workspace";

// Each turn compares the workspace's PDFs against a snapshot taken when it started, so files
// rebuilt just before the turn do not show up. Paseo does not wait for the hook, so the scan can
// trail the turn's start slightly; anything modified after the hook arrived also counts.
interface TurnStart {
  workspaceId: string;
  startedAt: number;
  before: Map<string, number>;
}

const turnStarts = new Map<string, Promise<TurnStart | null>>();

export function turnStarted(
  { agent }: PluginLifecycleEvents["agent.turn_started"],
  { paseo }: PluginHookContext,
): void {
  const workspaceId = agent.workspaceId;
  if (!workspaceId) return;
  const startedAt = Date.now();
  const snapshot = workspaceRoot(paseo, workspaceId)
    .then(scanPdfs)
    .then(({ files }) => ({ workspaceId, startedAt, before: new Map(files.map((file) => [file.path, file.mtimeMs])) }))
    .catch(() => null);
  turnStarts.set(agent.id, snapshot);
}

export async function turnEnded(
  { agent, turnId }: PluginLifecycleEvents["agent.turn_ended"],
  { paseo }: PluginHookContext,
): Promise<void> {
  const pending = turnStarts.get(agent.id);
  turnStarts.delete(agent.id);
  const start = await pending;
  if (!start) return;
  const { files } = await scanPdfs(await workspaceRoot(paseo, start.workspaceId));
  const changed = files.filter(
    (file) => file.mtimeMs >= start.startedAt || start.before.get(file.path) !== file.mtimeMs,
  );
  if (changed.length === 0) return;
  const data: TurnCardData = {
    workspaceId: start.workspaceId,
    files: changed.slice(0, MAX_TURN_CARD_FILES).map(({ path, size }) => ({ path, size })),
    more: Math.max(0, changed.length - MAX_TURN_CARD_FILES),
  };
  await paseo.agents.ref(agent.id).timeline.append({
    type: "plugin",
    id: `pdf-turn-${turnId ?? Date.now()}`,
    kind: TURN_CARD_KIND,
    version: TURN_CARD_VERSION,
    data,
  });
}

export function forgetAgent(agentId: string): void {
  turnStarts.delete(agentId);
}
