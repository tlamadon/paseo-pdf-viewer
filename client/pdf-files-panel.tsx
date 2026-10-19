import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { ComponentType } from "react";
import { ActivityIndicator, View } from "react-native";
import type { DocumentTabs } from "./document-tabs";
import { PdfPicker } from "./pdf-picker";
import { useSelectedPdf } from "./selection";

// Opening a document tab needs the client context, so the component is built around it.
export function createPdfFilesPanel(tabs: DocumentTabs): ComponentType<PluginWorkspacePanelProps> {
  return function PdfFilesPanel({ theme, workspaceId }: PluginWorkspacePanelProps) {
    const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
    const [selected, select] = useSelectedPdf(workspaceId);
    const toast = useToast();

    if (!directory) {
      return (
        <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
          <ActivityIndicator style={{ marginTop: 32 }} color={theme.colors.foregroundMuted} />
        </View>
      );
    }
    return (
      <PdfPicker
        theme={theme}
        // The Explorer is a narrow column even on desktop.
        compact
        directory={directory}
        activePath={selected}
        onOpen={(path) => {
          select(path);
          tabs.open(workspaceId, directory, path).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : String(error));
          });
        }}
      />
    );
  };
}
