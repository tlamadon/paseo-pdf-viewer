import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { type ComponentType, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { TurnCardData } from "../shared/turn-cards";
import type { DocumentTabs } from "./document-tabs";
import { baseName } from "./pdf-picker";

// Opening a document tab needs the client context, so the component is built around it.
export function createTurnCard(tabs: DocumentTabs): ComponentType<PluginTimelineItemProps<TurnCardData>> {
  return function TurnCard({ theme, item }: PluginTimelineItemProps<TurnCardData>) {
    const { workspaceId, files, more } = item.data;
    const toast = useToast();
    const styles = useMemo(() => cardStyles(theme), [theme]);
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Icon name="FileText" size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.heading}>{files.length + more === 1 ? "PDF updated" : "PDFs updated"} in this turn</Text>
        </View>
        {files.map((file) => (
          <Pressable
            key={file.path}
            accessibilityRole="button"
            accessibilityLabel={`Open ${file.path}`}
            onPress={() =>
              tabs.open(workspaceId, file.path).catch((error: unknown) => {
                toast.error(error instanceof Error ? error.message : String(error));
              })
            }
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.name} numberOfLines={1}>
              {baseName(file.path)}
            </Text>
            <Text style={styles.folder} numberOfLines={1}>
              {file.path.split(/[\\/]/).slice(0, -1).join("/")}
            </Text>
          </Pressable>
        ))}
        {more > 0 && <Text style={styles.more}>and {more} more</Text>}
      </View>
    );
  };
}

function cardStyles(theme: PluginTheme) {
  const { colors } = theme;
  return {
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      paddingVertical: 6,
      marginVertical: 4,
    },
    header: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 10, paddingVertical: 4 },
    heading: { color: colors.foregroundMuted, fontSize: 12 },
    row: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 8, paddingHorizontal: 10, paddingVertical: 5 },
    rowPressed: { backgroundColor: colors.surface2 },
    name: { color: colors.accent, fontSize: 14, flexShrink: 0 },
    folder: { color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
    more: { color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 10, paddingTop: 2 },
  };
}
