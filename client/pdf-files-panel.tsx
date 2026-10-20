import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { ComponentType } from "react";
import type { DocumentTabs } from "./document-tabs";
import { PdfPicker } from "./pdf-picker";
import { useSelectedPdf } from "./selection";

// Opening a document tab needs the client context, so the component is built around it.
export function createPdfFilesPanel(tabs: DocumentTabs): ComponentType<PluginWorkspacePanelProps> {
  return function PdfFilesPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
    const [selected, select] = useSelectedPdf(workspaceId);
    const toast = useToast();
    return (
      <PdfPicker
        theme={theme}
        // The Explorer is a narrow column even on desktop.
        compact
        workspaceId={workspaceId}
        activePath={selected}
        onOpen={(path) => {
          select(path);
          tabs.open(workspaceId, path).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
          });
        }}
      />
    );
  };
}
