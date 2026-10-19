import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createDocumentTabs } from "./client/document-tabs";
import { createPdfFilesPanel } from "./client/pdf-files-panel";
import { openListPanel } from "./client/placement";

export default function contribute(client: PluginClientContext) {
  const tabs = createDocumentTabs(client);
  // The same list lives in two panels: one per location, so each keeps its own tab. A single
  // panel that moved between locations would keep re-focusing its old tab, which on a phone sits
  // in the hidden Explorer pane.
  const PdfFilesPanel = createPdfFilesPanel(tabs);
  client.addWorkspacePanel({
    id: "pdf-files",
    title: "PDFs",
    icon: "Files",
    context: "workspace",
    locations: ["explorer"],
    Component: PdfFilesPanel,
  });
  client.addWorkspacePanel({
    id: "pdf-list",
    title: "PDFs",
    icon: "Files",
    context: "workspace",
    Component: PdfFilesPanel,
  });
  client.addSlashCommand({
    name: "pdf",
    description: "Open a PDF in its own tab, or list the workspace PDFs",
    argumentHint: "[path]",
    context: "workspace",
    async onSubmit({ args, workspace, openPanel }) {
      if (args) await tabs.open(workspace.id, workspace.directory, args);
      else openListPanel(openPanel);
    },
  });
  client.addCommandCenterItem({
    id: "show-pdf-files",
    title: "Show PDFs",
    icon: "Files",
    keywords: ["pdf", "explorer", "files", "viewer"],
    context: "workspace",
    onSelect({ openPanel }) {
      openListPanel(openPanel);
    },
  });
  return tabs.dispose;
}
