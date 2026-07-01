import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const pluginToolsListeners = new Set<(tools: TooldeskPluginToolRegistration[]) => void>();

function hasUrlProtocol(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:');
}

function hasImageExtension(value: string) {
  return /\.(?:svg|png|webp|jpe?g|ico)(?:[?#].*)?$/i.test(value);
}

function isFilesystemAbsolutePath(value: string) {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function convertAssetPath(value?: string) {
  const item = String(value ?? '').trim();

  if (!item || item.startsWith('./') || hasUrlProtocol(item)) {
    return value;
  }

  return convertFileSrc(item);
}

function resolveInstalledPluginAssetPath(tool: TooldeskPluginToolRegistration, value?: string) {
  const item = String(value ?? '').trim();

  if (!item || !hasImageExtension(item) || isFilesystemAbsolutePath(item) || hasUrlProtocol(item)) {
    return convertAssetPath(value) ?? value;
  }

  if (!tool.installPath || item.startsWith('./')) {
    return convertAssetPath(value) ?? value;
  }

  return convertFileSrc(`${tool.installPath.replace(/[\\/]+$/, '')}/${item}`);
}

function resolveInstalledPluginEntryUrl(tool: TooldeskPluginToolRegistration): string {
  return convertAssetPath(tool.entryUrl) ?? tool.entryUrl;
}

function normalizeInstalledPluginRegistration(tool: TooldeskPluginToolRegistration): TooldeskPluginToolRegistration {
  return {
    ...tool,
    entryUrl: resolveInstalledPluginEntryUrl(tool),
    icon: resolveInstalledPluginAssetPath(tool, tool.icon) ?? tool.icon,
    settings: tool.settings
      ? {
          ...tool.settings,
          entryUrl: convertAssetPath(tool.settings.entryUrl) ?? tool.settings.entryUrl,
          icon: resolveInstalledPluginAssetPath(tool, tool.settings.icon) ?? tool.settings.icon
        }
      : undefined,
    windowIcon: resolveInstalledPluginAssetPath(tool, tool.windowIcon) ?? tool.windowIcon
  };
}

export const __testing = {
  resolveInstalledPluginAssetPath,
  resolveInstalledPluginEntryUrl
};

export async function listPluginTools() {
  const installed = await invoke<TooldeskPluginToolRegistration[]>('list_installed_plugin_tools')
    .then((items) => items.map(normalizeInstalledPluginRegistration))
    .catch(() => []);

  return installed.sort((current, next) => current.label.localeCompare(next.label, 'zh-CN'));
}

function notifyPluginToolsChanged(tools: TooldeskPluginToolRegistration[]) {
  for (const listener of pluginToolsListeners) {
    listener(tools);
  }
}

export function onPluginToolsChanged(callback: (tools: TooldeskPluginToolRegistration[]) => void) {
  pluginToolsListeners.add(callback);
  return () => {
    pluginToolsListeners.delete(callback);
  };
}

async function withLatestPluginTools(result: TooldeskPluginInstallResult) {
  const tools = await listPluginTools();
  const nextResult = {
    ...result,
    tools
  };

  notifyPluginToolsChanged(tools);
  return nextResult;
}

export async function installLocalPlugin(): Promise<TooldeskPluginInstallResult> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: '选择插件目录'
  });

  if (typeof selected !== 'string' || !selected.trim()) {
    return {
      canceled: true,
      tools: await listPluginTools()
    };
  }

  const result = await invoke<TooldeskPluginInstallResult>('install_local_plugin', {
    sourcePath: selected.trim()
  });

  return withLatestPluginTools(result);
}

export async function uninstallPlugin(pluginId: string): Promise<TooldeskPluginInstallResult> {
  const result = await invoke<TooldeskPluginInstallResult>('uninstall_plugin', { pluginId });

  return withLatestPluginTools(result);
}

export function listPluginMarket(): Promise<TooldeskPluginMarketCatalog> {
  return invoke<TooldeskPluginMarketCatalog>('list_plugin_market');
}

export async function installMarketPlugin(pluginId: string): Promise<TooldeskPluginInstallResult> {
  const result = await invoke<TooldeskPluginInstallResult>('install_market_plugin', { pluginId });

  return withLatestPluginTools(result);
}
