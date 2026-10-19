import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { listPdfs } from "../shared/pdf";

interface PdfPickerProps {
  theme: PluginTheme;
  compact: boolean;
  directory: string;
  // The file open in the viewer, highlighted in the list.
  activePath?: string | null;
  onOpen(path: string): void;
}

// Rescan now and then so freshly built PDFs show up without pressing refresh.
const RESCAN_INTERVAL_MS = 15000;

export function PdfPicker({ theme, compact, directory, activePath, onOpen }: PdfPickerProps) {
  const list = useRpc(listPdfs);
  const files = useQuery({
    queryKey: ["pdf.list", directory],
    queryFn: () => list({ directory }),
    refetchInterval: RESCAN_INTERVAL_MS,
  });
  const [filter, setFilter] = useState("");
  const styles = useMemo(() => pickerStyles(theme, compact), [theme, compact]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = files.data?.files ?? [];
    return needle ? all.filter((file) => file.path.toLowerCase().includes(needle)) : all;
  }, [files.data, filter]);

  // A typed path that matches nothing in the list can still be opened directly.
  function submit() {
    const typed = filter.trim();
    if (visible.length === 1) onOpen(visible[0].path);
    else if (typed.toLowerCase().endsWith(".pdf")) onOpen(typed);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          onSubmitEditing={submit}
          placeholder="Filter PDFs or type a path"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Filter PDF files"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rescan PDF files"
          onPress={() => files.refetch()}
          style={styles.iconButton}
        >
          <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      {files.isPending ? (
        <Text style={styles.muted}>Scanning for PDFs…</Text>
      ) : files.isError ? (
        <Text style={styles.error}>{String(files.error)}</Text>
      ) : visible.length === 0 ? (
        <Text style={styles.muted}>
          {filter ? "No matching PDFs. Press Enter to open a typed path." : "No PDFs in this workspace."}
        </Text>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(file) => file.path}
          ListFooterComponent={
            files.data?.truncated ? <Text style={styles.muted}>Showing the first 500 PDFs.</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.path}`}
              onPress={() => onOpen(item.path)}
              style={({ pressed }) => [
                styles.row,
                item.path === activePath && styles.rowActive,
                pressed && styles.rowPressed,
              ]}
            >
              <Icon name="FileText" size={16} color={theme.colors.accent} />
              <View style={styles.rowText}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {baseName(item.path)}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {dirName(item.path)}
                  {dirName(item.path) ? " · " : ""}
                  {formatSize(item.size)} · {formatAge(item.mtimeMs)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts.slice(0, -1).join("/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAge(mtimeMs: number): string {
  const minutes = Math.round((Date.now() - mtimeMs) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(mtimeMs).toISOString().slice(0, 10);
}

function pickerStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, padding: compact ? 12 : 16, gap: 12, backgroundColor: colors.surface0 },
    searchRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
    },
    searchInput: { flex: 1, paddingVertical: 8, color: colors.foreground, fontSize: 14 },
    iconButton: { padding: 6 },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    rowActive: { backgroundColor: colors.surface1 },
    rowPressed: { backgroundColor: colors.surface2 },
    rowText: { flex: 1, gap: 2 },
    fileName: { color: colors.foreground, fontSize: 14 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    error: { color: colors.statusDanger, fontSize: 13 },
  };
}
