import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  type LayoutChangeEvent,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewToken,
} from "react-native";
import { pdfInfo, renderPage } from "../shared/pdf";
import { baseName } from "./pdf-picker";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const PAGE_GAP = 12;
// How often the viewer checks whether the PDF was rebuilt.
const RELOAD_INTERVAL_MS = 2000;

interface PdfViewerProps {
  theme: PluginTheme;
  compact: boolean;
  directory: string;
  path: string;
  // Shows a back button when the viewer replaces a file list.
  onClose?: () => void;
}

export function PdfViewer({ theme, compact, directory, path, onClose }: PdfViewerProps) {
  const getInfo = useRpc(pdfInfo);
  const info = useQuery({
    queryKey: ["pdf.info", directory, path],
    queryFn: () => getInfo({ directory, path }),
    refetchInterval: RELOAD_INTERVAL_MS,
    // A rebuild can briefly leave a half-written file. The last good data stays on screen and the
    // next poll recovers, so retries would only add noise.
    retry: false,
  });
  const [zoomIndex, setZoomIndex] = useState(ZOOM_STEPS.indexOf(1));
  const [viewportWidth, setViewportWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const styles = useMemo(() => viewerStyles(theme, compact), [theme, compact]);

  const zoom = ZOOM_STEPS[zoomIndex];
  const padding = compact ? 8 : 16;
  const pageWidth = Math.max(100, Math.floor((viewportWidth - 2 * padding) * zoom));
  const aspects = info.data?.aspects ?? [];

  const offsets = useMemo(() => {
    const result: number[] = [];
    let offset = 0;
    for (const aspect of aspects) {
      result.push(offset);
      offset += pageWidth / aspect + PAGE_GAP;
    }
    return result;
  }, [aspects, pageWidth]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(Math.floor(event.nativeEvent.layout.width));
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable);
    if (first?.index != null) setCurrentPage(first.index);
  }).current;

  const title = info.data?.title || baseName(path);

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        {onClose && <ToolbarButton theme={theme} icon="ChevronLeft" label="Back to PDF list" onPress={onClose} />}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {aspects.length > 0 && (
          <Text style={styles.muted}>
            {currentPage + 1} / {aspects.length}
          </Text>
        )}
        <ToolbarButton
          theme={theme}
          icon="ZoomOut"
          label="Zoom out"
          disabled={zoomIndex === 0}
          onPress={() => setZoomIndex((index) => Math.max(0, index - 1))}
        />
        <Text style={[styles.muted, styles.zoomLabel]}>{Math.round(zoom * 100)}%</Text>
        <ToolbarButton
          theme={theme}
          icon="ZoomIn"
          label="Zoom in"
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          onPress={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
        />
      </View>
      {info.isError && !info.data ? (
        <View style={styles.message}>
          <Text style={styles.error}>{errorMessage(info.error)}</Text>
        </View>
      ) : (
        <View style={styles.viewport} onLayout={onLayout}>
          {!info.data || viewportWidth === 0 ? (
            <ActivityIndicator style={styles.spinner} color={theme.colors.foregroundMuted} />
          ) : (
            <ScrollView horizontal contentContainerStyle={{ minWidth: viewportWidth }}>
              <FlatList
                style={{ width: Math.max(viewportWidth, pageWidth + 2 * padding) }}
                contentContainerStyle={{ padding }}
                data={aspects}
                keyExtractor={(_, index) => String(index)}
                getItemLayout={(_, index) => ({
                  length: pageWidth / aspects[index] + PAGE_GAP,
                  offset: offsets[index],
                  index,
                })}
                initialNumToRender={2}
                windowSize={5}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
                renderItem={({ item: aspect, index }) => (
                  <PdfPage
                    theme={theme}
                    directory={directory}
                    path={path}
                    mtimeMs={info.data.mtimeMs}
                    page={index}
                    width={pageWidth}
                    height={pageWidth / aspect}
                  />
                )}
              />
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

interface PdfPageProps {
  theme: PluginTheme;
  directory: string;
  path: string;
  mtimeMs: number;
  page: number;
  width: number;
  height: number;
}

function PdfPage({ theme, directory, path, mtimeMs, page, width, height }: PdfPageProps) {
  const render = useRpc(renderPage);
  // Round up to 100 device pixels so small resizes reuse cached renders.
  const renderWidth = Math.min(4000, Math.max(100, Math.ceil((width * PixelRatio.get()) / 100) * 100));
  const image = useQuery({
    queryKey: ["pdf.page", directory, path, mtimeMs, page, renderWidth],
    queryFn: () => render({ directory, path, page, width: renderWidth, mtimeMs }),
    staleTime: Number.POSITIVE_INFINITY,
    // After a rebuild or zoom change, keep the old image up until the new one arrives.
    placeholderData: (previous) => previous,
  });

  return (
    <View
      style={{
        width,
        height,
        marginBottom: PAGE_GAP,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityLabel={`Page ${page + 1}`}
    >
      {image.data ? (
        <Image source={{ uri: image.data.uri }} style={{ width: width - 2, height: height - 2 }} resizeMode="contain" />
      ) : image.isError ? (
        <Text style={{ color: theme.colors.statusDanger, padding: 12 }}>{errorMessage(image.error)}</Text>
      ) : (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      )}
    </View>
  );
}

interface ToolbarButtonProps {
  theme: PluginTheme;
  icon: string;
  label: string;
  disabled?: boolean;
  onPress(): void;
}

function ToolbarButton({ theme, icon, label, disabled, onPress }: ToolbarButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 6,
        borderRadius: 6,
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={16} color={theme.colors.foreground} />
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function viewerStyles(theme: PluginTheme, compact: boolean) {
  const { colors } = theme;
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    toolbar: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: compact ? 2 : 6,
      paddingHorizontal: compact ? 6 : 10,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface1,
    },
    title: { flex: 1, color: colors.foreground, fontSize: 14, marginHorizontal: 4 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    zoomLabel: { minWidth: 36, textAlign: "center" as const },
    viewport: { flex: 1, backgroundColor: colors.surface2 },
    spinner: { marginTop: 32 },
    message: { padding: 16 },
    error: { color: colors.statusDanger, fontSize: 13 },
  };
}
