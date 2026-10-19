import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { documentPanelId, listDocuments, openDocument } from "../shared/documents";
import { baseName } from "./pdf-picker";
import { PdfViewer } from "./pdf-viewer";

export interface DocumentTabs {
  // Opens the PDF in its own tab, or focuses the tab already showing it.
  open(workspaceId: string, directory: string, path: string): Promise<void>;
  dispose(): void;
}

export function createDocumentTabs(client: PluginClientContext): DocumentTabs {
  const panels = new Map<string, PluginCleanup>();
  let disposed = false;

  function register(absolutePath: string): string {
    const id = documentPanelId(absolutePath);
    if (!panels.has(id) && !disposed) {
      function DocumentPanel({ theme, layout }: PluginWorkspacePanelProps) {
        return <PdfViewer theme={theme} compact={layout.compact} directory="/" path={absolutePath} />;
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

  function forget(absolutePath: string): void {
    const id = documentPanelId(absolutePath);
    void panels.get(id)?.();
    panels.delete(id);
  }

  // Re-register remembered documents so tabs the app restores after a reload have a panel.
  client
    .rpc(listDocuments, {})
    .then(({ absolutePaths }) => {
      for (const absolutePath of absolutePaths) register(absolutePath);
    })
    .catch((error) => console.warn("[pdf-viewer] Could not restore PDF tabs", error));

  return {
    async open(workspaceId, directory, path) {
      const { absolutePath, forgotten } = await client.rpc(openDocument, { directory, path });
      for (const old of forgotten) forget(old);
      await openPanelWhenRegistered(client, register(absolutePath), workspaceId);
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
