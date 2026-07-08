<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import AppSettingsModal from './components/layout/AppSettingsModal.vue';
import AppTopbar from './components/layout/AppTopbar.vue';
import AppUpdateProgress from './components/layout/AppUpdateProgress.vue';
import ExtensionCenter from './components/toolbox/ExtensionCenter.vue';
import ToolDetail from './components/toolbox/ToolDetail.vue';
import ToolHome from './components/toolbox/ToolHome.vue';
import ToolRenderer from './components/toolbox/ToolRenderer.vue';
import { useExtensionMarket } from './composables/useExtensionMarket';
import { useToolRegistry } from './composables/useToolRegistry';
import { categories } from './tools';
import type { BaiduOcrSettings, OcrConfigStatus } from './types/baiduOcr';
import type { TranslateConfigStatus, TranslateSettings } from './types/translate';
import type { ScreenshotSettings } from './types/screenshot';
import type { SuperClipboardEntryMeta, SuperClipboardSettings } from './types/superClipboard';
import type { CategoryKey, ExtensionMarketItem, ExtensionSettings, MainView, ThemeMode, ToolAliasSettings, ToolItem, ToolKey } from './types/toolbox';
import type { GlobalShortcutsSettings } from './types/globalShortcuts';
import { getDefaultGlobalShortcutsSettings } from './types/globalShortcuts';
import { getDefaultBaiduOcrSettings } from './types/baiduOcr';
import { getDefaultTranslateSettings } from './types/translate';
import { getDefaultScreenshotSettings } from './utils/screenshotClient';
import {
  filterToolsBySearchQuery,
  getDefaultToolAliasSettings,
  normalizeToolAliasSettings
} from './utils/toolSearchIndex';
import { isHttpUrl } from './shared/toolContentRules';
import { isPluginUpdateAvailable } from './utils/pluginVersion';
import { getAppRuntime } from './utils/platform';
import {
  getDefaultSuperClipboardSettings,
  isSuperClipboardSupported,
  onSuperClipboardNewEntry
} from './utils/superClipboardClient';

interface SyncCloudSettings {
  autoSyncEnabled: boolean;
  lastSyncMessage?: string;
  lastSyncedAt?: string;
  loginName: string;
  syncPassword: string;
}

type MusicCloudProvider = 'none' | 'qiniu';

interface MusicCloudSettings {
  provider: MusicCloudProvider;
  qiniu: {
    accessKey: string;
    bucket: string;
    domain: string;
    prefix: string;
    region: string;
    secretKey: string;
  };
}

const DEFAULT_MUSIC_CLOUD_SETTINGS: MusicCloudSettings = {
  provider: 'none',
  qiniu: {
    accessKey: '',
    bucket: '',
    domain: '',
    prefix: 'tooldesk/music/',
    region: 'z0',
    secretKey: ''
  }
};

function normalizeMusicCloudSettings(value?: Partial<MusicCloudSettings> | null): MusicCloudSettings {
  const rawProvider = value?.provider === 'qiniu' ? 'qiniu' : 'none';
  const qiniu = value?.qiniu ?? DEFAULT_MUSIC_CLOUD_SETTINGS.qiniu;

  return {
    provider: rawProvider,
    qiniu: {
      accessKey: qiniu.accessKey ?? '',
      bucket: qiniu.bucket ?? '',
      domain: qiniu.domain ?? '',
      prefix: qiniu.prefix ?? DEFAULT_MUSIC_CLOUD_SETTINGS.qiniu.prefix,
      region: qiniu.region ?? DEFAULT_MUSIC_CLOUD_SETTINGS.qiniu.region,
      secretKey: qiniu.secretKey ?? ''
    }
  };
}

const FAVORITES_STORAGE_KEY = 'tooldesk-favorites';
const RECENT_STORAGE_KEY = 'tooldesk-recent';
const RECENT_STORAGE_LIMIT = 32;
const EXTENSION_SETTINGS_STORAGE_KEY = 'tooldesk-extension-settings';
const TOOL_ALIAS_SETTINGS_STORAGE_KEY = 'tooldesk-tool-alias-settings';
const AUTO_CLOUD_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PLUGIN_SYNC_META_KEY = 'tooldesk-plugin-sync-meta';

const activeCategory = ref<CategoryKey>('all');
const activeView = ref<MainView>('all');
const activeTool = ref<ToolKey>('super-clipboard');
const isToolChromeHidden = ref(false);
const isToolBreadcrumbHidden = ref(false);
const isSettingsOpen = ref(false);
const isToolOpen = ref(false);
const searchFocused = ref(false);
const searchActiveIndex = ref(0);
const searchText = ref('');
const favoriteTools = ref<ToolKey[]>([]);
const recentTools = ref<ToolKey[]>([]);
const extensionActionDetails = ref<string[]>([]);
const extensionActionMessage = ref('');
const extensionSettings = ref<ExtensionSettings>({ disabledToolKeys: [] });
const isBulkExtensionActionRunning = ref(false);
const toolAliasSettings = ref<ToolAliasSettings>(getDefaultToolAliasSettings());
const updateProgressRef = ref<InstanceType<typeof AppUpdateProgress>>();
const globalShortcutsSettings = ref<GlobalShortcutsSettings>(getDefaultGlobalShortcutsSettings());
const shortcutSupported = ref(false);
const closeToTray = ref(true);
const pluginAutoUpdateEnabled = ref(false);
const baiduOcrSettings = ref<BaiduOcrSettings>(getDefaultBaiduOcrSettings());
const ocrConfigStatus = ref<OcrConfigStatus>({
  configured: false,
  locked: false,
  provider: 'none',
  source: 'none'
});
const translateSettings = ref<TranslateSettings>(getDefaultTranslateSettings());
const translateConfigStatus = ref<TranslateConfigStatus>({
  configured: false,
  locked: false,
  provider: 'none',
  source: 'none'
});
const screenshotSettings = ref<ScreenshotSettings>(getDefaultScreenshotSettings());
const superClipboardSettings = ref<SuperClipboardSettings>(getDefaultSuperClipboardSettings());
const syncCloudSettings = ref<SyncCloudSettings>({
  autoSyncEnabled: false,
  lastSyncMessage: '',
  lastSyncedAt: '',
  loginName: '',
  syncPassword: ''
});
const musicCloudSettings = ref<MusicCloudSettings>(normalizeMusicCloudSettings());
const theme = ref<ThemeMode>('light');
const shortcutContent = ref('');
const shortcutContentVersion = ref(0);
const topbarRef = ref<InstanceType<typeof AppTopbar> | null>(null);
let stopWindowStateListener: (() => void) | undefined;
let stopAppNavigateListener: (() => void) | undefined;
let stopSuperClipboardRouteListener: (() => void) | undefined;
let isAutoUpdatingPlugins = false;
let autoCloudSyncTimer: number | undefined;
let cloudSyncInFlight = false;

function closeToolState() {
  isToolOpen.value = false;
  isToolBreadcrumbHidden.value = false;
  isToolChromeHidden.value = false;
}

function setExtensionAction(message: string, details: string[] = []) {
  extensionActionMessage.value = message;
  extensionActionDetails.value = details;
}

const {
  allTools,
  installLocalPlugin,
  installMarketPlugin,
  isLoadingPluginTools,
  refreshPluginTools,
  tools,
  uninstallPlugin
} = useToolRegistry(computed(() => extensionSettings.value.disabledToolKeys));
const { isLoadingMarketItems, marketError, marketItems, refreshMarketItems } = useExtensionMarket();

const activeToolMeta = computed(() => allTools.value.find((tool) => tool.key === activeTool.value) ?? allTools.value[0]);
const normalizedSearchText = computed(() => searchText.value.trim());
const globalSearchResults = computed(() => filterToolsBySearchQuery(tools.value, normalizedSearchText.value, toolAliasSettings.value).slice(0, 8));
const isGlobalSearchOpen = computed(() => Boolean(normalizedSearchText.value) && searchFocused.value);

const filteredTools = computed(() => {
  const visibleTools = tools.value.filter((tool) => {
    const viewMatched =
      activeView.value === 'all' ||
      (activeView.value === 'favorites' && favoriteTools.value.includes(tool.key)) ||
      (activeView.value === 'recent' && recentTools.value.includes(tool.key));
    const categoryMatched = activeCategory.value === 'all' || tool.category === activeCategory.value;

    return viewMatched && categoryMatched;
  });

  return visibleTools;
});

const categoryTools = computed(() =>
  categories
    .filter((category) => category.key !== 'all')
    .map((category) => ({
      category,
      tools: filteredTools.value.filter((tool) => tool.category === category.key)
    }))
    .filter((group) => group.tools.length > 0)
);

function setView(view: MainView) {
  activeView.value = view;
  activeCategory.value = 'all';
  isToolOpen.value = false;

  if (view === 'extensions') {
    void refreshExtensions();
  }
}

function selectCategory(category: CategoryKey) {
  activeCategory.value = category;
  activeView.value = 'all';
  isToolOpen.value = false;
}

function openTool(tool: ToolItem, content?: string) {
  const trimmedContent = content?.trim() ?? '';

  if (trimmedContent) {
    shortcutContent.value = trimmedContent;
    shortcutContentVersion.value = Date.now();
  } else {
    shortcutContent.value = '';
    shortcutContentVersion.value = 0;
  }

  activeTool.value = tool.key;
  activeCategory.value = tool.category;
  isToolBreadcrumbHidden.value = false;
  isToolChromeHidden.value = false;
  isToolOpen.value = true;
  recentTools.value = [tool.key, ...recentTools.value.filter((key) => key !== tool.key)].slice(0, RECENT_STORAGE_LIMIT);
}

function closeGlobalSearch(clearText = false) {
  searchFocused.value = false;
  searchActiveIndex.value = 0;

  if (clearText) {
    searchText.value = '';
  }
}

function openGlobalSearchResult(tool: ToolItem) {
  closeGlobalSearch(true);
  openTool(tool);
}

function handleSearchInput(value: string) {
  searchText.value = value;
  searchFocused.value = true;
  searchActiveIndex.value = 0;
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (!isGlobalSearchOpen.value && event.key !== 'Escape') {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    const count = globalSearchResults.value.length;
    searchActiveIndex.value = count > 0 ? (searchActiveIndex.value + 1) % count : 0;
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    const count = globalSearchResults.value.length;
    searchActiveIndex.value = count > 0 ? (searchActiveIndex.value - 1 + count) % count : 0;
    return;
  }

  if (event.key === 'Enter') {
    const tool = globalSearchResults.value[searchActiveIndex.value] ?? globalSearchResults.value[0];

    if (tool) {
      event.preventDefault();
      openGlobalSearchResult(tool);
    }

    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeGlobalSearch(Boolean(searchText.value));
  }
}

function openQrToolForUrl(url: string) {
  const trimmed = url.trim();

  if (!isHttpUrl(trimmed)) {
    return;
  }

  const qrTool = tools.value.find((tool) => tool.key === 'plugin:tooldesk-qr-generator');

  if (!qrTool) {
    return;
  }

  openTool(qrTool, trimmed);
}

function shouldOpenQrForClipboardEntry(entry: SuperClipboardEntryMeta) {
  return entry.category === 'link' || isHttpUrl(entry.preview);
}

function bindSuperClipboardQrRoute() {
  stopSuperClipboardRouteListener?.();
  stopSuperClipboardRouteListener = undefined;

  if (!isSuperClipboardSupported() || !superClipboardSettings.value.enabled) {
    return;
  }

  stopSuperClipboardRouteListener = onSuperClipboardNewEntry((entry) => {
    if (!shouldOpenQrForClipboardEntry(entry)) {
      return;
    }

    openQrToolForUrl(entry.preview);
  });
}

function readLocalStorageJson(key: string) {
  const value = localStorage.getItem(key);

  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function readPluginSyncMeta() {
  const meta = readLocalStorageJson(PLUGIN_SYNC_META_KEY);
  return meta && typeof meta === 'object' ? meta as Record<string, { hash?: string; updatedAt?: string }> : {};
}

function writePluginSyncMeta(meta: Record<string, { hash?: string; updatedAt?: string }>) {
  localStorage.setItem(PLUGIN_SYNC_META_KEY, JSON.stringify(meta));
}

function getPluginSyncItemKey(pluginId: string) {
  return `plugin:${pluginId}`;
}

function stringifyPluginStorageValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function readPluginStorageValue(key: string) {
  const raw = await window.tooldeskShortcut?.getPluginStorageItem?.(key);

  if (raw === null || raw === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function getSyncablePluginTools() {
  return tools.value.filter((tool) =>
    tool.source === 'plugin' &&
    tool.pluginId &&
    Boolean(tool.sync?.localStorageKeys?.length)
  );
}

async function collectPluginSyncItems() {
  const items: Record<string, unknown> = {};
  const meta = readPluginSyncMeta();
  let metaChanged = false;

  for (const tool of getSyncablePluginTools()) {
    const localStorageItems: Record<string, unknown> = {};

    for (const key of tool.sync?.localStorageKeys ?? []) {
      const value = await readPluginStorageValue(key);

      if (value !== undefined) {
        localStorageItems[key] = value;
      }
    }

    if (tool.pluginId && Object.keys(localStorageItems).length) {
      const itemKey = getPluginSyncItemKey(tool.pluginId);
      const hash = stableStringify(localStorageItems);
      const previous = meta[itemKey];
      const updatedAt = previous?.hash === hash && previous.updatedAt ? previous.updatedAt : new Date().toISOString();

      if (previous?.hash !== hash || previous.updatedAt !== updatedAt) {
        meta[itemKey] = { hash, updatedAt };
        metaChanged = true;
      }

      items[itemKey] = {
        localStorage: localStorageItems,
        schemaVersion: 1,
        updatedAt
      };
    }
  }

  if (metaChanged) {
    writePluginSyncMeta(meta);
  }

  return items;
}

function normalizePluginSyncItem(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as { localStorage?: Record<string, unknown>; schemaVersion?: number; updatedAt?: string };

  if (record.schemaVersion !== 1 || !record.localStorage || typeof record.localStorage !== 'object') {
    return null;
  }

  return {
    localStorage: record.localStorage,
    schemaVersion: 1,
    updatedAt: record.updatedAt
  };
}

async function applyPluginSyncItems(items?: Record<string, unknown>) {
  if (!items) {
    return;
  }

  for (const tool of getSyncablePluginTools()) {
    if (!tool.pluginId) {
      continue;
    }

    const pluginItem = normalizePluginSyncItem(items[getPluginSyncItemKey(tool.pluginId)]);

    if (!pluginItem) {
      continue;
    }

    for (const key of tool.sync?.localStorageKeys ?? []) {
      if (key in pluginItem.localStorage) {
        await window.tooldeskShortcut?.setPluginStorageItem?.(
          key,
          stringifyPluginStorageValue(pluginItem.localStorage[key])
        );
      }
    }

    const meta = readPluginSyncMeta();
    meta[getPluginSyncItemKey(tool.pluginId)] = {
      hash: stableStringify(pluginItem.localStorage),
      updatedAt: pluginItem.updatedAt ?? new Date().toISOString()
    };
    writePluginSyncMeta(meta);
  }
}

function canRunCloudSync(settings = syncCloudSettings.value) {
  return Boolean(settings.autoSyncEnabled && settings.loginName.trim() && settings.syncPassword.trim());
}

async function runAutomaticCloudSync(reason: 'startup' | 'interval') {
  if (!window.tooldeskShortcut?.syncCloudSnapshot || !canRunCloudSync() || cloudSyncInFlight) {
    return;
  }

  cloudSyncInFlight = true;

  try {
    const result = await window.tooldeskShortcut.syncCloudSnapshot({
      localItems: await collectPluginSyncItems(),
      loginName: syncCloudSettings.value.loginName,
      syncPassword: syncCloudSettings.value.syncPassword
    });
    await refreshExtensions();
    await applyPluginSyncItems(result.clientItems);
    const settings = await window.tooldeskShortcut.getAppSettings();
    applyAppSettings(settings);
  } catch (error) {
    console.warn(`[tooldesk] Automatic cloud sync failed (${reason}).`, error);
  } finally {
    cloudSyncInFlight = false;
  }
}

function startAutomaticCloudSync() {
  window.clearInterval(autoCloudSyncTimer);
  autoCloudSyncTimer = window.setInterval(() => {
    void runAutomaticCloudSync('interval');
  }, AUTO_CLOUD_SYNC_INTERVAL_MS);
}

function closeTool() {
  closeToolState();
}

function toggleFavorite(tool: ToolItem) {
  favoriteTools.value = favoriteTools.value.includes(tool.key)
    ? favoriteTools.value.filter((key) => key !== tool.key)
    : [...favoriteTools.value, tool.key];
}

function categoryLabel(category: ToolItem['category']) {
  return categories.find((item) => item.key === category)?.label ?? '工具';
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

async function updateGlobalShortcutsSettings(value: GlobalShortcutsSettings) {
  globalShortcutsSettings.value = {
    bindings: value.bindings.map((binding) => ({ ...binding }))
  };

  if (!window.tooldeskShortcut) {
    return;
  }

  // 确保传递的是纯 JSON 对象，避免序列化错误
  const plainSettings = {
    globalShortcuts: {
      bindings: value.bindings.map((binding) => ({
        id: binding.id,
        enabled: binding.enabled,
        accelerator: binding.accelerator
      }))
    }
  };

  const settings = await window.tooldeskShortcut.setAppSettings(plainSettings);
  applyAppSettings(settings);
}

async function updateCloseToTray(value: boolean) {
  const previousValue = closeToTray.value;
  closeToTray.value = value;

  if (!window.tooldeskShortcut) {
    return;
  }

  try {
    const settings = await window.tooldeskShortcut.setAppSettings({ closeToTray: value });
    applyAppSettings(settings);
  } catch (error) {
    closeToTray.value = previousValue;
    console.warn('[tooldesk] Failed to update close-to-tray setting.', error);
  }
}

async function updatePluginAutoUpdateEnabled(value: boolean) {
  pluginAutoUpdateEnabled.value = value;

  if (!window.tooldeskShortcut) {
    return;
  }

  const settings = await window.tooldeskShortcut.setAppSettings({ pluginAutoUpdateEnabled: value });
  applyAppSettings(settings);
}

async function updateBaiduOcrSettings(value: Partial<BaiduOcrSettings>) {
  baiduOcrSettings.value = {
    ...baiduOcrSettings.value,
    ...value
  };

  if (!window.tooldeskShortcut) {
    return;
  }

  const settings = await window.tooldeskShortcut.setAppSettings({
    baiduOcr: baiduOcrSettings.value
  });
  applyAppSettings(settings);
}

async function updateTranslateSettings(value: Partial<TranslateSettings>) {
  translateSettings.value = {
    ...translateSettings.value,
    ...value,
    aliyun: {
      ...translateSettings.value.aliyun,
      ...(value.aliyun ?? {})
    },
    baidu: {
      ...translateSettings.value.baidu,
      ...(value.baidu ?? {})
    },
    tencent: {
      ...translateSettings.value.tencent,
      ...(value.tencent ?? {})
    }
  };

  if (!window.tooldeskShortcut) {
    return;
  }

  const settings = await window.tooldeskShortcut.setAppSettings({
    translate: translateSettings.value
  });
  applyAppSettings(settings);
}

function applyAppSettings(settings: {
  baiduOcr: BaiduOcrSettings;
  closeToTray: boolean;
  globalShortcuts: GlobalShortcutsSettings;
  localLibrary: TooldeskLocalLibrarySettings;
  keepass: TooldeskKeePassSettings;
  ocrConfigStatus: OcrConfigStatus;
  screenshot: ScreenshotSettings;
  superClipboard: SuperClipboardSettings;
  musicCloud: MusicCloudSettings;
  syncCloud: SyncCloudSettings;
  pluginAutoUpdateEnabled: boolean;
  translate: TranslateSettings;
  translateConfigStatus: TranslateConfigStatus;
} | undefined) {
  if (!settings) {
    return;
  }

  closeToTray.value = settings.closeToTray;
  pluginAutoUpdateEnabled.value = settings.pluginAutoUpdateEnabled ?? false;
  baiduOcrSettings.value = settings.baiduOcr ?? getDefaultBaiduOcrSettings();
  globalShortcutsSettings.value = settings.globalShortcuts ?? getDefaultGlobalShortcutsSettings();
  ocrConfigStatus.value = settings.ocrConfigStatus;
  screenshotSettings.value = settings.screenshot ?? getDefaultScreenshotSettings();
  superClipboardSettings.value = settings.superClipboard ?? getDefaultSuperClipboardSettings();
  musicCloudSettings.value = normalizeMusicCloudSettings(settings.musicCloud);
  syncCloudSettings.value = settings.syncCloud ?? {
    autoSyncEnabled: false,
    lastSyncMessage: '',
    lastSyncedAt: '',
    loginName: '',
    syncPassword: ''
  };
  bindSuperClipboardQrRoute();
  translateSettings.value = settings.translate ?? getDefaultTranslateSettings();
  translateConfigStatus.value = settings.translateConfigStatus ?? {
    configured: false,
    locked: false,
    provider: 'none',
    source: 'none'
  };
}

async function updateScreenshotSettings(value: Partial<ScreenshotSettings>) {
  screenshotSettings.value = {
    ...screenshotSettings.value,
    ...value
  };

  if (!window.tooldeskShortcut) {
    return;
  }

  const settings = await window.tooldeskShortcut.setAppSettings({
    screenshot: screenshotSettings.value
  });
  applyAppSettings(settings);
}

async function updateSuperClipboardSettings(value: Partial<SuperClipboardSettings>) {
  superClipboardSettings.value = {
    ...superClipboardSettings.value,
    ...value
  };

  if (!window.tooldeskShortcut) {
    return;
  }

  // 手动构建纯 JSON 对象，避免 Vue 响应式对象序列化错误
  const plainSettings: SuperClipboardSettings = {
    enabled: superClipboardSettings.value.enabled,
    ignoreDuplicates: superClipboardSettings.value.ignoreDuplicates,
    maxImageBytes: superClipboardSettings.value.maxImageBytes,
    maxItems: superClipboardSettings.value.maxItems,
    pollIntervalMs: superClipboardSettings.value.pollIntervalMs
  };
  
  const settings = await window.tooldeskShortcut.setAppSettings({
    superClipboard: plainSettings
  });
  applyAppSettings(settings);
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    void nextTick(() => topbarRef.value?.focusSearch());
  }
}

function openSettings() {
  void window.tooldeskShortcut?.dismissStaleScreenshotOverlay?.();
  void window.tooldeskShortcut?.getAppSettings().then((settings) => {
    applyAppSettings(settings);
  });
  isSettingsOpen.value = true;
}

function handleAppNavigate(target: 'extensions' | 'settings') {
  if (target === 'settings') {
    openSettings();
    return;
  }

  activeView.value = 'extensions';
  activeCategory.value = 'all';
  isToolOpen.value = false;
  isSettingsOpen.value = false;
  void refreshExtensions();
}

function setWindowMaximizedState(maximized: boolean) {
  document.documentElement.dataset.windowMaximized = maximized ? 'true' : 'false';
}

function parseSavedToolKeys(storageKey: string) {
  const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((key): key is ToolKey => typeof key === 'string' && key.trim().length > 0);
}

function loadSavedToolState() {
  try {
    favoriteTools.value = parseSavedToolKeys(FAVORITES_STORAGE_KEY);
    recentTools.value = parseSavedToolKeys(RECENT_STORAGE_KEY);
  } catch {
    favoriteTools.value = [];
    recentTools.value = [];
  }

  try {
    const savedExtensionSettings = JSON.parse(localStorage.getItem(EXTENSION_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<ExtensionSettings>;
    extensionSettings.value = {
      disabledToolKeys: Array.isArray(savedExtensionSettings.disabledToolKeys)
        ? savedExtensionSettings.disabledToolKeys.filter((key): key is ToolKey => typeof key === 'string')
        : []
    };
  } catch {
    extensionSettings.value = { disabledToolKeys: [] };
  }

  try {
    toolAliasSettings.value = normalizeToolAliasSettings(
      JSON.parse(localStorage.getItem(TOOL_ALIAS_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<ToolAliasSettings>
    );
  } catch {
    toolAliasSettings.value = getDefaultToolAliasSettings();
  }
}

async function refreshExtensions() {
  await Promise.all([refreshPluginTools(), refreshMarketItems()]);
  loadSavedToolState();
  await autoUpdateInstalledPlugins();
}

async function autoUpdateInstalledPlugins() {
  if (!pluginAutoUpdateEnabled.value || isAutoUpdatingPlugins || marketItems.value.length === 0) {
    return;
  }

  const installedVersionByPluginId = new Map(
    allTools.value
      .filter((tool) => tool.source === 'plugin' && tool.pluginId && tool.manifestVersion)
      .map((tool) => [tool.pluginId as string, tool.manifestVersion as string])
  );
  const updateItems = marketItems.value.filter((item) => {
    const installedVersion = installedVersionByPluginId.get(item.pluginId);
    return installedVersion ? isPluginUpdateAvailable(installedVersion, item.version) : false;
  });

  if (updateItems.length === 0) {
    return;
  }

  isAutoUpdatingPlugins = true;
  let successCount = 0;
  const errors: string[] = [];
  const details: string[] = [];

  try {
    for (const item of updateItems) {
      const result = await installMarketPlugin(item.pluginId);

      if (result?.error) {
        errors.push(`${item.label}: ${result.error}`);
        details.push(`${item.pluginId}: ${result.error}`, ...(result.details ?? []));
        continue;
      }

      successCount += 1;
    }

    await refreshPluginTools();
    setExtensionAction(
      errors.length ? `已自动更新 ${successCount} 个插件，${errors.length} 个失败。` : `已自动更新 ${successCount} 个插件。`,
      errors.length ? details : []
    );
  } finally {
    isAutoUpdatingPlugins = false;
    loadSavedToolState();
  }
}

async function installLocalExtension() {
  if (isBulkExtensionActionRunning.value) {
    return;
  }

  isBulkExtensionActionRunning.value = true;
  setExtensionAction('');

  try {
    const result = await installLocalPlugin();
    if (result?.error) {
      setExtensionAction(result.error, result.details ?? []);
      return;
    }

    if (result?.canceled) {
      setExtensionAction('');
      return;
    }

    setExtensionAction('本地扩展已安装。');
    loadSavedToolState();
  } catch (error) {
    setExtensionAction(error instanceof Error ? error.message : '安装本地扩展失败。');
  } finally {
    isBulkExtensionActionRunning.value = false;
  }
}

async function installMarketExtension(item: ExtensionMarketItem) {
  if (isBulkExtensionActionRunning.value) {
    return;
  }

  isBulkExtensionActionRunning.value = true;
  setExtensionAction('');
  const installedVersion = allTools.value.find((tool) => tool.pluginId === item.pluginId)?.manifestVersion ?? '';
  const wasUpdate = isPluginUpdateAvailable(installedVersion, item.version);

  try {
    const result = await installMarketPlugin(item.pluginId);

    if (result?.error) {
      setExtensionAction(result.error, result.details ?? []);
      return;
    }

    setExtensionAction(wasUpdate || result.updated ? `${item.label} 已更新到 v${item.version}。` : `${item.label} 已安装。`);
    loadSavedToolState();
  } catch (error) {
    setExtensionAction(error instanceof Error ? error.message : '安装市场扩展失败。');
  } finally {
    isBulkExtensionActionRunning.value = false;
  }
}

async function uninstallExtension(tool: ToolItem) {
  if (!tool.pluginId || isBulkExtensionActionRunning.value) {
    return;
  }

  isBulkExtensionActionRunning.value = true;
  setExtensionAction('');

  try {
    const result = await uninstallPlugin(tool.pluginId);
    if (result?.error) {
      setExtensionAction(result.error, result.details ?? []);
      return;
    }

    setExtensionAction(`${tool.label} 已卸载。`);
    loadSavedToolState();
  } catch (error) {
    setExtensionAction(error instanceof Error ? error.message : '卸载扩展失败。');
  } finally {
    isBulkExtensionActionRunning.value = false;
  }
}

async function installSelectedMarketExtensions(selectedItems: ExtensionMarketItem[]) {
  if (isBulkExtensionActionRunning.value) {
    return;
  }

  const installedVersionByPluginId = new Map(
    allTools.value
      .filter((tool) => tool.source === 'plugin' && tool.pluginId && tool.manifestVersion)
      .map((tool) => [tool.pluginId as string, tool.manifestVersion as string])
  );
  const items = selectedItems.filter((item) => {
    const installedVersion = installedVersionByPluginId.get(item.pluginId);
    return !installedVersion || isPluginUpdateAvailable(installedVersion, item.version);
  });

  if (items.length === 0) {
    setExtensionAction('选中的插件已安装且无需更新。');
    return;
  }

  isBulkExtensionActionRunning.value = true;
  setExtensionAction(`正在安装 ${items.length} 个插件...`);

  let successCount = 0;
  const errors: string[] = [];
  const details: string[] = [];

  try {
    for (const [index, item] of items.entries()) {
      setExtensionAction(`正在安装 ${index + 1} / ${items.length}：${item.label}...`);

      try {
        const result = await installMarketPlugin(item.pluginId);

        if (result.error) {
          errors.push(`${item.label}: ${result.error}`);
          details.push(`${item.pluginId}: ${result.error}`, ...(result.details ?? []));
          continue;
        }

        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : '安装失败';
        errors.push(`${item.label}: ${message}`);
        details.push(`${item.pluginId}: ${message}`);
      }
    }

    setExtensionAction(
      errors.length ? `已安装/更新 ${successCount} 个插件，${errors.length} 个失败。` : `已安装/更新 ${successCount} 个插件。`,
      errors.length ? details : []
    );
    loadSavedToolState();
  } finally {
    isBulkExtensionActionRunning.value = false;
  }
}

async function uninstallSelectedExtensions(selectedTools: ToolItem[]) {
  if (isBulkExtensionActionRunning.value) {
    return;
  }

  const pluginToolsById = new Map(
    selectedTools.filter((tool) => tool.source === 'plugin' && tool.pluginId).map((tool) => [tool.pluginId as string, tool])
  );
  const tools = Array.from(pluginToolsById.values());

  if (tools.length === 0) {
    setExtensionAction('请选择要卸载的插件。');
    return;
  }

  isBulkExtensionActionRunning.value = true;
  setExtensionAction(`正在卸载 ${tools.length} 个插件...`);

  let successCount = 0;
  const errors: string[] = [];
  const details: string[] = [];

  try {
    for (const tool of tools) {
      const pluginId = tool.pluginId;

      if (!pluginId) {
        continue;
      }

      try {
        const result = await uninstallPlugin(pluginId);

        if (result.error) {
          errors.push(`${tool.label}: ${result.error}`);
          details.push(`${pluginId}: ${result.error}`, ...(result.details ?? []));
          continue;
        }

        successCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : '卸载失败';
        errors.push(`${tool.label}: ${message}`);
        details.push(`${pluginId}: ${message}`);
      }
    }

    setExtensionAction(
      errors.length ? `已卸载 ${successCount} 个插件，${errors.length} 个失败。` : `已卸载 ${successCount} 个插件。`,
      errors.length ? details : []
    );
    loadSavedToolState();
  } finally {
    isBulkExtensionActionRunning.value = false;
  }
}

function updateExtensionSettings(settings: ExtensionSettings) {
  extensionSettings.value = {
    disabledToolKeys: Array.from(new Set(settings.disabledToolKeys.filter((key) => typeof key === 'string')))
  };
}

function updateToolAliasSettings(settings: ToolAliasSettings) {
  toolAliasSettings.value = normalizeToolAliasSettings(settings);
}

watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem('tooldesk-theme', value);
  },
  { immediate: true }
);

watch(
  favoriteTools,
  (value) => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

watch(
  recentTools,
  (value) => {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

watch(
  extensionSettings,
  (value) => {
    localStorage.setItem(EXTENSION_SETTINGS_STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

watch(
  toolAliasSettings,
  (value) => {
    localStorage.setItem(TOOL_ALIAS_SETTINGS_STORAGE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

watch(pluginAutoUpdateEnabled, (enabled) => {
  if (enabled) {
    void refreshMarketItems().then(autoUpdateInstalledPlugins);
  }
});

onMounted(() => {
  const runtime = getAppRuntime();
  document.documentElement.dataset.desktopShell = runtime === 'tauri' ? 'true' : 'false';
  document.documentElement.dataset.runtime = runtime;
  setWindowMaximizedState(false);

  const savedTheme = localStorage.getItem('tooldesk-theme');
  shortcutSupported.value = runtime === 'tauri';
  if (savedTheme === 'dark' || savedTheme === 'light') {
    theme.value = savedTheme;
  }

  loadSavedToolState();
  void (async () => {
    try {
      const settings = await window.tooldeskShortcut?.getAppSettings();
      applyAppSettings(settings);
      await refreshExtensions();
      await runAutomaticCloudSync('startup');
    } catch (error) {
      console.warn('[tooldesk] Startup cloud sync initialization failed.', error);
    }
  })();
  startAutomaticCloudSync();

  window.addEventListener('keydown', handleKeydown);
  void window.tooldeskShortcut?.isWindowMaximized().then(setWindowMaximizedState);
  stopWindowStateListener = window.tooldeskShortcut?.onWindowMaximizedChange(setWindowMaximizedState);
  stopAppNavigateListener = window.tooldeskShortcut?.onAppNavigate(handleAppNavigate);
  bindSuperClipboardQrRoute();

  // 监听更新事件
  const updateEventSource = window.tooldeskShortcut;
  updateEventSource?.onUpdateAvailable?.((data) => {
    updateProgressRef.value?.handleUpdateAvailable(data);
  });
  updateEventSource?.onUpdateCheckComplete?.((data) => {
    updateProgressRef.value?.handleUpdateCheckComplete(data);
  });
  updateEventSource?.onUpdateCheckError?.((data) => {
    updateProgressRef.value?.handleUpdateCheckError(data);
  });
  updateEventSource?.onUpdateDownloadStart?.((data) => {
    updateProgressRef.value?.handleStart(data);
  });
  updateEventSource?.onUpdateDownloadProgress?.((data) => {
    updateProgressRef.value?.handleProgress(data);
  });
  updateEventSource?.onUpdateDownloadComplete?.((data) => {
    updateProgressRef.value?.handleComplete(data);
  });
  updateEventSource?.onUpdateDownloadError?.(() => {
    updateProgressRef.value?.handleError();
  });
  updateEventSource?.onUpdateInstallStart?.((data) => {
    updateProgressRef.value?.handleInstallStart(data);
  });
});

watch(
  () => superClipboardSettings.value.enabled,
  () => {
    bindSuperClipboardQrRoute();
  }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.clearInterval(autoCloudSyncTimer);
  stopWindowStateListener?.();
  stopAppNavigateListener?.();
  stopSuperClipboardRouteListener?.();
});
</script>

<template>
  <main class="app-shell">
    <AppTopbar
      ref="topbarRef"
      :active-search-index="searchActiveIndex"
      :search-open="isGlobalSearchOpen"
      :search-results="globalSearchResults"
      :search-text="searchText"
      :theme="theme"
      @clear-search="closeGlobalSearch(true)"
      @open-settings="openSettings"
      @open-search-result="openGlobalSearchResult"
      @search-blur="closeGlobalSearch(false)"
      @search-focus="searchFocused = true"
      @search-keydown="handleSearchKeydown"
      @set-view="setView"
      @toggle-theme="toggleTheme"
      @update:search-text="handleSearchInput"
    />

    <AppSidebar
      :active-category="activeCategory"
      :active-view="activeView"
      :categories="categories"
      @select-category="selectCategory"
    />

    <section
      class="workspace"
    >
      <div class="workspace-content">
        <ToolHome
          v-if="!isToolOpen && activeView !== 'extensions'"
          :active-view="activeView"
          :favorite-tools="favoriteTools"
          :filtered-tool-count="filteredTools.length"
          :groups="categoryTools"
          @open-tool="openTool"
          @set-view="setView"
          @toggle-favorite="toggleFavorite"
        />

        <ExtensionCenter
          v-else-if="!isToolOpen && activeView === 'extensions'"
          :action-details="extensionActionDetails"
          :action-message="extensionActionMessage"
          :extension-settings="extensionSettings"
          :is-loading-extensions="isLoadingPluginTools || isLoadingMarketItems || isBulkExtensionActionRunning"
          :market-error="marketError"
          :market-items="marketItems"
          :tool-alias-settings="toolAliasSettings"
          :tools="allTools"
          @install-local-extension="installLocalExtension"
          @install-market-extension="installMarketExtension"
          @install-selected-market-extensions="installSelectedMarketExtensions"
          @open-tool="openTool"
          @refresh-extensions="refreshExtensions"
          @uninstall-extension="uninstallExtension"
          @uninstall-selected-extensions="uninstallSelectedExtensions"
          @update-extension-settings="updateExtensionSettings"
          @update-tool-alias-settings="updateToolAliasSettings"
        />

        <ToolDetail
          v-else
          :active-tool-meta="activeToolMeta"
          :category-label="categoryLabel(activeToolMeta.category)"
          :chrome-hidden="isToolChromeHidden"
          :breadcrumb-hidden="isToolBreadcrumbHidden"
          :show-breadcrumb="true"
          @back="closeTool"
        >
          <ToolRenderer
            :tool-key="activeTool"
            :tool="activeToolMeta"
            :shortcut-content="shortcutContent"
            :shortcut-content-version="shortcutContentVersion"
            @back="closeTool"
            @chrome-hidden-change="isToolChromeHidden = $event"
          />
        </ToolDetail>
      </div>
    </section>

    <Teleport to="body">
      <AppSettingsModal
        v-if="isSettingsOpen"
        :close-to-tray="closeToTray"
        :baidu-ocr-settings="baiduOcrSettings"
        :global-shortcuts-settings="globalShortcutsSettings"
        :ocr-config-status="ocrConfigStatus"
        :music-cloud-settings="musicCloudSettings"
        :screenshot-settings="screenshotSettings"
        :plugin-auto-update-enabled="pluginAutoUpdateEnabled"
        :super-clipboard-settings="superClipboardSettings"
        :sync-cloud-settings="syncCloudSettings"
        :translate-config-status="translateConfigStatus"
        :translate-settings="translateSettings"
        :shortcut-supported="shortcutSupported"
        :tools="allTools"
        @close="isSettingsOpen = false"
        @update-close-to-tray="updateCloseToTray"
        @update-plugin-auto-update-enabled="updatePluginAutoUpdateEnabled"
        @update-baidu-ocr-settings="updateBaiduOcrSettings"
        @update-global-shortcuts-settings="updateGlobalShortcutsSettings"
        @update-screenshot-settings="updateScreenshotSettings"
        @update-super-clipboard-settings="updateSuperClipboardSettings"
        @update-translate-settings="updateTranslateSettings"
        @app-settings-synced="applyAppSettings"
      />
    </Teleport>

    <AppUpdateProgress ref="updateProgressRef" />
  </main>
</template>
