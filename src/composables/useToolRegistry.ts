import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { normalizeClipboardMatchConfig } from '../shared/plugin/clipboardMatch';
import { tools as builtinTools } from '../tools';
import type { ToolItem } from '../types/toolbox';
import { isToolAvailableInCurrentRuntime } from '../utils/platform';

const pluginTools = ref<ToolItem[]>([]);
const isLoadingPluginTools = ref(false);

function normalizePluginTool(tool: TooldeskPluginToolRegistration): ToolItem | null {
  if (!tool.key || !tool.label || !tool.entryUrl) {
    return null;
  }

  const clipboardMatch = normalizeClipboardMatchConfig(tool.clipboardMatch);

  return {
    accent: tool.accent || 'blue',
    capabilities: tool.capabilities ?? [],
    caption: tool.caption || `插件 ${tool.label}`,
    category: (tool.category || 'dev') as ToolItem['category'],
    clipboardMatch: clipboardMatch.length ? clipboardMatch : undefined,
    defaultAlias: tool.defaultAlias || tool.pluginId,
    entryUrl: tool.entryUrl,
    icon: tool.icon || 'toolbox',
    installPath: tool.installPath,
    key: tool.key,
    keywords: tool.keywords ?? [],
    label: tool.label,
    manifestVersion: tool.manifestVersion,
    minHostVersion: tool.minHostVersion,
    permissions: tool.permissions ?? [],
    pluginId: tool.pluginId,
    sdkVersion: tool.sdkVersion,
    settings: tool.settings,
    source: 'plugin',
    sync: tool.sync,
    windowIcon: tool.windowIcon
  };
}

export function useToolRegistry(disabledToolKeys: Ref<string[]> = ref([])) {
  const allTools = computed(() => [...builtinTools, ...pluginTools.value].filter(isToolAvailableInCurrentRuntime));
  const disabledToolKeySet = computed(() => new Set(disabledToolKeys.value));
  const tools = computed(() => allTools.value.filter((tool) => !disabledToolKeySet.value.has(tool.key)));
  let stopPluginToolsListener: (() => void) | undefined;

  async function refreshPluginTools() {
    if (isLoadingPluginTools.value) {
      return;
    }

    isLoadingPluginTools.value = true;

    try {
      if (!window.tooldeskShortcut?.listPluginTools) {
        throw new Error('Plugin registry API is unavailable.');
      }

      const registrations = await window.tooldeskShortcut.listPluginTools();
      pluginTools.value = registrations
        .map(normalizePluginTool)
        .filter((tool): tool is ToolItem => Boolean(tool));
    } finally {
      isLoadingPluginTools.value = false;
    }
  }

  function replacePluginTools(registrations: TooldeskPluginToolRegistration[]) {
    pluginTools.value = registrations
      .map(normalizePluginTool)
      .filter((tool): tool is ToolItem => Boolean(tool));
  }

  async function installLocalPlugin() {
    if (!window.tooldeskShortcut?.installLocalPlugin) {
      throw new Error('Plugin install API is unavailable.');
    }

    const result = await window.tooldeskShortcut.installLocalPlugin();
    replacePluginTools(result.tools);
    return result;
  }

  async function installMarketPlugin(pluginId: string) {
    if (!window.tooldeskShortcut?.installMarketPlugin) {
      throw new Error('Plugin market API is unavailable.');
    }

    const result = await window.tooldeskShortcut.installMarketPlugin(pluginId);
    replacePluginTools(result.tools);
    return result;
  }

  async function uninstallPlugin(pluginId: string) {
    if (!window.tooldeskShortcut?.uninstallPlugin) {
      throw new Error('Plugin uninstall API is unavailable.');
    }

    const result = await window.tooldeskShortcut.uninstallPlugin(pluginId);
    replacePluginTools(result.tools);
    return result;
  }

  onMounted(() => {
    stopPluginToolsListener = window.tooldeskShortcut?.onPluginToolsChanged?.((registrations) => {
      replacePluginTools(registrations);
    });
  });

  onBeforeUnmount(() => {
    stopPluginToolsListener?.();
  });

  return {
    allTools,
    builtinTools,
    installLocalPlugin,
    installMarketPlugin,
    isLoadingPluginTools,
    pluginTools,
    refreshPluginTools,
    uninstallPlugin,
    tools
  };
}
