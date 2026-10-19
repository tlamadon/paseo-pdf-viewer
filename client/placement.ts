import type { PluginOpenPanelOptions } from "@getpaseo/plugin/client";
import { Dimensions, Platform } from "react-native";

// Phone layouts replace the Explorer pane with a compact file browser that has no plugin tabs,
// so there the PDF list opens as a regular tab instead. Commands get no layout info, so judge
// by the platform and window width.
export function openListPanel(openPanel: (id: string, options?: PluginOpenPanelOptions) => void): void {
  if (Platform.OS === "web" && Dimensions.get("window").width >= 768) {
    openPanel("pdf-files", { location: "explorer" });
  } else {
    openPanel("pdf-list");
  }
}
