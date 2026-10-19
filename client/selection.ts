import { useCallback, useSyncExternalStore } from "react";

// The file last opened from the Explorer list, per workspace, for highlighting.
const selectedByWorkspace = new Map<string, string>();
const listeners = new Set<() => void>();

function selectPdf(workspaceId: string, path: string | null): void {
  if (path) selectedByWorkspace.set(workspaceId, path);
  else selectedByWorkspace.delete(workspaceId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedPdf(workspaceId: string): [string | null, (path: string | null) => void] {
  const selected = useSyncExternalStore(subscribe, () => selectedByWorkspace.get(workspaceId) ?? null);
  const select = useCallback((path: string | null) => selectPdf(workspaceId, path), [workspaceId]);
  return [selected, select];
}
