import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { documentPanelId, listDocuments, openDocument } from "../shared/documents";
import { baseName } from "./pdf-picker";
import { PdfViewer } from "./pdf-viewer";
import { readCachedDocuments, writeCachedDocuments } from "./web";

export interface DocumentTabs {
  // Opens the PDF in its own tab, or focuses the tab already showing it.
  open(workspaceId: string, path: string): Promise<void>;
  dispose(): void;
}

export function createDocumentTabs(client: PluginClientContext): DocumentTabs {
  const panels = new Map<string, PluginCleanup>();
  let disposed = false;

  function register(absolutePath: string): string {
    const id = documentPanelId(absolutePath);
    if (!panels.has(id) && !disposed) {
      function DocumentPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
        return <PdfViewer theme={theme} compact={layout.compact} workspaceId={workspaceId} path={absolutePath} />;
      }
      panels.set(
        id,
        client.addWorkspacePanel({
          id,
          title: baseName(absolutePath),
          icon: "FileText",
          context: "workspace",
          Component: DocumentPanel,
        }),
      );
    }
    return id;
  }

  // Match the registered panels to the daemon's list and keep the synchronous copy current.
  function sync(absolutePaths: string[]): void {
    const keep = new Set(absolutePaths.map(register));
    for (const [id, remove] of panels) {
      if (keep.has(id)) continue;
      void remove();
      panels.delete(id);
    }
    writeCachedDocuments(absolutePaths);
  }

  // Paseo resolves a restored tab's panel when the tab first renders, which happens before any
  // RPC can answer, so register the cached list now and reconcile with the daemon afterwards.
  // Native clients have no cache; their restored tabs recover once the tab is reopened.
  for (const absolutePath of readCachedDocuments()) register(absolutePath);
  client
    .rpc(listDocuments, {})
    .then(({ absolutePaths }) => sync(absolutePaths))
    .catch((error) => console.warn("[pdf-viewer] Could not restore PDF tabs", error));

  return {
    async open(workspaceId, path) {
      const { absolutePath, remembered } = await client.rpc(openDocument, { workspaceId, path });
      sync(remembered);
      await openPanelWhenRegistered(client, documentPanelId(absolutePath), workspaceId);
    },
    dispose() {
      disposed = true;
      for (const remove of panels.values()) void remove();
      panels.clear();
    },
  };
}

// A panel registered a moment ago can take a tick to reach the app's registry.
async function openPanelWhenRegistered(client: PluginClientContext, id: string, workspaceId: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      client.openPanel(id, { workspaceId });
      return;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}
