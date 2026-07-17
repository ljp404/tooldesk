<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { resolveContentToolKeys } from '../../shared/toolContentRules';
import type { InstalledApplication } from '../../types/installedApplication';
import type { ToolAliasSettings, ToolItem, ToolKey } from '../../types/toolbox';
import { filterInstalledApplications } from '../../utils/installedApplicationSearch';
import {
  filterToolsBySearchQuery,
  getDefaultToolAliasSettings,
  getToolUserAliases,
  normalizeToolAliasSettings
} from '../../utils/toolSearchIndex';
import ToolRenderer from '../toolbox/ToolRenderer.vue';
import AppIcon from '../ui/AppIcon.vue';
import ToolIcon from '../ui/ToolIcon.vue';
import commonSitesData from '../../../plugins/tooldesk-common-sites/sites.json';

type QuickKeyboardGroup = 'content' | 'favorite' | 'recent' | 'search';
type QuickKeyboardDirection = 'down' | 'left' | 'right' | 'up';
type QuickKeyboardItem =
  | {
      group: QuickKeyboardGroup;
      id: string;
      tool: ToolItem;
      type: 'tool';
    }
  | {
      application: InstalledApplication;
      group: 'search';
      id: string;
      type: 'application';
    };

type QuickSearchResult =
  | { id: string; tool: ToolItem; type: 'tool' }
  | { application: InstalledApplication; id: string; type: 'application' };

type CommonSiteCommand = {
  aliases: string[];
  openUrl: string;
  searchUrl: string;
};

const COMMON_SITE_COMMANDS: CommonSiteCommand[] = commonSitesData.map((site) => ({
  aliases: Array.isArray(site.aliases) ? site.aliases.map((alias) => String(alias)) : [],
  openUrl: String(site.openUrl ?? '').trim(),
  searchUrl: String(site.searchUrl ?? '').trim()
}));
const TOOL_ALIAS_SETTINGS_STORAGE_KEY = 'tooldesk-tool-alias-settings';
const RECENT_COLLAPSED_COUNT = 8;
const RECENT_STORAGE_LIMIT = 32;
const LAUNCHER_WINDOW_WIDTH = 820;
const LAUNCHER_WINDOW_HEIGHT = 440;
const INLINE_TOOL_WINDOW_HEIGHT = 640;
const INLINE_DOUBLE_CLICK_DISTANCE = 8;
const INLINE_DOUBLE_CLICK_INTERVAL = 360;
const INLINE_WINDOW_HINT_STORAGE_KEY = 'tooldesk-inline-window-hint-seen';

const props = defineProps<{
  shortcutContent?: string;
  shortcutContentVersion?: number;
  tools: ToolItem[];
}>();

const emit = defineEmits<{
  openTool: [tool: ToolItem];
}>();

const favoriteTools = ref<ToolKey[]>([]);
const recentTools = ref<ToolKey[]>([]);
const recentExpanded = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const searchInputMeasure = ref<HTMLElement | null>(null);
const searchInputWidth = ref('72px');
const searchQuery = ref('');
const clipboardContent = ref('');
const activeIndex = ref(0);
const activeInlineTool = ref<ToolItem | null>(null);
const activeInlineContent = ref('');
const activeInlineVersion = ref(0);
const showInlineWindowHint = ref(false);
const localLibraries = ref<TooldeskLocalLibraryConfig[]>([]);
const installedApplications = ref<InstalledApplication[]>([]);
const installedApplicationIcons = ref<Record<string, string | null>>({});
const toolAliasSettings = ref<ToolAliasSettings>(getDefaultToolAliasSettings());
const installedApplicationIconRequests = new Set<string>();
let installedApplicationsRefresh: Promise<void> | null = null;
let inlineDoubleClickOpening = false;
let inlineWindowHintTimer: number | null = null;
let inlineLastPointerDown:
  | {
      time: number;
      x: number;
      y: number;
    }
  | null = null;

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());
const searchPlaceholder = computed(() =>
  showClipboardChip.value ? '继续输入筛选…' : '搜索工具、本机程序 / 粘贴文本、链接、JSON'
);
const searchInputText = computed(() => searchQuery.value || '　');

function formatClipboardPreview(content: string) {
  const singleLine = content.replace(/\s+/g, ' ').trim();
  const maxLength = 28;

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  const frontLength = 8;
  const backLength = 8;
  return `${singleLine.slice(0, frontLength)} … ${singleLine.slice(-backLength)}`;
}

const clipboardPreview = computed(() => formatClipboardPreview(clipboardContent.value));
const inlineToolContent = computed(() => activeInlineContent.value);
const clipboardMatchTools = computed(() => props.tools.filter((tool) => tool.clipboardMatch?.length));

function resolveShortcutAcceptTools(content: string) {
  const value = content.trim();

  if (!value) {
    return [];
  }

  return props.tools.filter((tool) => {
    try {
      return Boolean(tool.shortcut?.accepts(value));
    } catch {
      return false;
    }
  });
}

function mergeMatchedTools(...groups: ToolItem[][]) {
  const items = groups.flat();

  return items.filter((tool, index, tools) => tools.findIndex((item) => item.key === tool.key) === index);
}

function resolveContentMatchedTools(content: string) {
  return mergeMatchedTools(
    resolveToolKeys(resolveContentToolKeys(content, clipboardMatchTools.value)),
    resolveShortcutAcceptTools(content)
  );
}

const contentMatchedTools = computed(() => resolveContentMatchedTools(clipboardContent.value));

const searchContentMatchedTools = computed(() => resolveContentMatchedTools(searchQuery.value.trim()));

const showClipboardChip = computed(
  () => Boolean(clipboardContent.value.trim()) && contentMatchedTools.value.length > 0
);

const isContentMatchMode = computed(() => showClipboardChip.value && !normalizedSearch.value);

const enabledLocalLibraries = computed(() => localLibraries.value.filter((library) => library.enabled !== false));
const obsidianPluginTool = computed(() =>
  props.tools.find((tool) => tool.key === 'plugin:tooldesk-obsidian' || tool.pluginId === 'tooldesk-obsidian')
);
const commonSitesPluginTool = computed(() =>
  props.tools.find((tool) => tool.key === 'plugin:tooldesk-common-sites' || tool.pluginId === 'tooldesk-common-sites')
);
const commonSitesPrefixMatch = computed(() => {
  const tool = commonSitesPluginTool.value;
  const rawQuery = searchQuery.value.trim().toLowerCase();

  if (!tool || !rawQuery) {
    return false;
  }

  const [prefix] = rawQuery.split(/\s+/, 1);
  if (!prefix) {
    return false;
  }

  const candidates = [tool.defaultAlias, tool.label, ...getToolUserAliases(tool, toolAliasSettings.value), ...(tool.keywords ?? [])]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);

  return candidates.includes(prefix);
});

const matchedLocalLibraries = computed(() => {
  const query = normalizedSearch.value;

  if (!query || !obsidianPluginTool.value) {
    return [];
  }

  return enabledLocalLibraries.value.filter((library) =>
    [library.keyword, library.name, library.path].some((value) => String(value ?? '').toLowerCase().includes(query))
  );
});

const filteredTools = computed(() => {
  if (normalizedSearch.value) {
    return filterToolsBySearchQuery(props.tools, normalizedSearch.value, toolAliasSettings.value);
  }

  if (isContentMatchMode.value) {
    return contentMatchedTools.value;
  }

  return [];
});

const allRecentToolItems = computed(() => resolveToolKeys(recentTools.value));
const recentToolItems = computed(() =>
  recentExpanded.value
    ? allRecentToolItems.value
    : allRecentToolItems.value.slice(0, RECENT_COLLAPSED_COUNT)
);
const showRecentExpand = computed(
  () => allRecentToolItems.value.length > RECENT_COLLAPSED_COUNT && !recentExpanded.value
);
const favoriteToolItems = computed(() => resolveToolKeys(favoriteTools.value).slice(0, 8));
const defaultRecentItems = computed(() => (recentToolItems.value.length > 0 ? recentToolItems.value : props.tools.slice(0, 5)));
const contentResultItems = computed(() => filteredTools.value.slice(0, 12));
const searchToolItems = computed(() => {
  const items = [...filteredTools.value, ...searchContentMatchedTools.value].filter(
    (tool, index, tools) => tools.findIndex((item) => item.key === tool.key) === index
  );

  if (matchedLocalLibraries.value.length > 0 && obsidianPluginTool.value && !items.some((tool) => tool.key === obsidianPluginTool.value?.key)) {
    items.unshift(obsidianPluginTool.value);
  }

  const commonSitesTool = commonSitesPluginTool.value;
  if (commonSitesPrefixMatch.value && commonSitesTool) {
    const existingIndex = items.findIndex((tool) => tool.key === commonSitesTool.key);
    if (existingIndex >= 0) {
      items.splice(existingIndex, 1);
    }
    items.unshift(commonSitesTool);
  }

  return items.slice(0, 12);
});
const matchedInstalledApplications = computed(() =>
  filterInstalledApplications(installedApplications.value, normalizedSearch.value)
);
const searchResultItems = computed<QuickSearchResult[]>(() => {
  const applicationLimit = Math.min(4, matchedInstalledApplications.value.length);
  const contentMatchedKeys = new Set(searchContentMatchedTools.value.map((tool) => tool.key));
  const explicitlyMatchedKeys = new Set(filteredTools.value.map((tool) => tool.key));
  const primaryTools = searchToolItems.value.filter(
    (tool) => !contentMatchedKeys.has(tool.key) || explicitlyMatchedKeys.has(tool.key)
  );
  const inferredTools = searchToolItems.value.filter(
    (tool) => contentMatchedKeys.has(tool.key) && !explicitlyMatchedKeys.has(tool.key)
  );
  const primaryToolResults = primaryTools.slice(0, 12 - applicationLimit).map((tool) => ({
    id: `tool:${tool.key}`,
    tool,
    type: 'tool' as const
  }));
  const applicationResults = matchedInstalledApplications.value.slice(0, applicationLimit).map((application) => ({
    application,
    id: `application:${application.id}`,
    type: 'application' as const
  }));
  const inferredToolLimit = 12 - primaryToolResults.length - applicationResults.length;
  const inferredToolResults = inferredTools.slice(0, inferredToolLimit).map((tool) => ({
    id: `tool:${tool.key}`,
    tool,
    type: 'tool' as const
  }));

  return [...primaryToolResults, ...applicationResults, ...inferredToolResults];
});

function resolveInstalledApplicationIcon(application: InstalledApplication) {
  return installedApplicationIcons.value[application.id] || 'application';
}

async function loadInstalledApplicationIcon(application: InstalledApplication) {
  if (
    Object.prototype.hasOwnProperty.call(installedApplicationIcons.value, application.id) ||
    installedApplicationIconRequests.has(application.id) ||
    !window.tooldeskShortcut?.getInstalledApplicationIcon
  ) {
    return;
  }

  installedApplicationIconRequests.add(application.id);

  try {
    const icon = await window.tooldeskShortcut.getInstalledApplicationIcon(application.id);
    installedApplicationIcons.value = {
      ...installedApplicationIcons.value,
      [application.id]: icon
    };
  } catch (error) {
    console.warn('[tooldesk] Failed to load installed application icon.', error);
    installedApplicationIcons.value = {
      ...installedApplicationIcons.value,
      [application.id]: null
    };
  } finally {
    installedApplicationIconRequests.delete(application.id);
  }
}

watch(searchResultItems, (results) => {
  for (const result of results) {
    if (result.type === 'application') {
      void loadInstalledApplicationIcon(result.application);
    }
  }
});

const keyboardItems = computed(() => {
  if (isContentMatchMode.value) {
    return contentResultItems.value.map((tool, index) => createKeyboardToolItem('content', tool, index));
  }

  if (normalizedSearch.value) {
    return searchResultItems.value.map((result, index) => createKeyboardSearchItem(result, index));
  }

  return [
    ...defaultRecentItems.value.map((tool, index) => createKeyboardToolItem('recent', tool, index)),
    ...favoriteToolItems.value.map((tool, index) => createKeyboardToolItem('favorite', tool, index))
  ];
});
const activeKeyboardItem = computed(() => keyboardItems.value[activeIndex.value] ?? null);

function createKeyboardToolItem(group: QuickKeyboardGroup, tool: ToolItem, index: number): QuickKeyboardItem {
  return {
    group,
    id: `${group}:${tool.key}:${index}`,
    type: 'tool',
    tool
  };
}

function createKeyboardSearchItem(result: QuickSearchResult, index: number): QuickKeyboardItem {
  if (result.type === 'application') {
    return {
      application: result.application,
      group: 'search',
      id: `search:${result.id}:${index}`,
      type: 'application'
    };
  }

  return createKeyboardToolItem('search', result.tool, index);
}

async function refreshInstalledApplications() {
  if (installedApplicationsRefresh) {
    return installedApplicationsRefresh;
  }

  if (!window.tooldeskShortcut?.listInstalledApplications) {
    installedApplications.value = [];
    return;
  }

  installedApplicationsRefresh = window.tooldeskShortcut
    .listInstalledApplications()
    .then((applications) => {
      installedApplications.value = applications;
    })
    .catch((error) => {
      console.warn('[tooldesk] Failed to list installed applications.', error);
      installedApplications.value = [];
    })
    .finally(() => {
      installedApplicationsRefresh = null;
    });

  return installedApplicationsRefresh;
}

watch([() => props.shortcutContent, () => props.shortcutContentVersion], () => {
  void refreshInstalledApplications();
  const content = props.shortcutContent?.trim() ?? '';

  if (activeInlineTool.value) {
    clipboardContent.value = content;
    searchQuery.value = '';
    if (window.tooldeskShortcut) {
      void nextTick(() =>
        window.tooldeskShortcut?.fitCurrentWindow({
          width: LAUNCHER_WINDOW_WIDTH,
          height: INLINE_TOOL_WINDOW_HEIGHT
        })
      );
    }
    return;
  }

  const contentChanged = content !== clipboardContent.value.trim();

  if (contentChanged) {
    activeInlineTool.value = null;
    activeInlineContent.value = '';
    activeInlineVersion.value = 0;
    if (window.tooldeskShortcut) {
      void nextTick(() =>
        window.tooldeskShortcut?.fitCurrentWindow({
          width: LAUNCHER_WINDOW_WIDTH,
          height: LAUNCHER_WINDOW_HEIGHT
        })
      );
    }
  }

  focusSearchInput({ selectExisting: true });

  if (!content) {
    return;
  }

  clipboardContent.value = content;
  searchQuery.value = '';
});

watch(normalizedSearch, () => {
  activeIndex.value = 0;
  recentExpanded.value = false;

  if (activeInlineTool.value) {
    activeInlineContent.value = inlineToolContent.value;
    activeInlineVersion.value = Date.now();
  }
});

watch(
  () => keyboardItems.value.length,
  (length) => {
    if (length === 0) {
      activeIndex.value = 0;
      return;
    }

    activeIndex.value = Math.min(activeIndex.value, length - 1);
  }
);

function resolveToolKeys(keys: ToolKey[]) {
  return keys.map((key) => props.tools.find((tool) => tool.key === key)).filter((tool): tool is ToolItem => Boolean(tool));
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
    favoriteTools.value = parseSavedToolKeys('tooldesk-favorites');
    recentTools.value = parseSavedToolKeys('tooldesk-recent');
  } catch {
    favoriteTools.value = [];
    recentTools.value = [];
  }

  try {
    toolAliasSettings.value = normalizeToolAliasSettings(
      JSON.parse(localStorage.getItem(TOOL_ALIAS_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<ToolAliasSettings>
    );
  } catch {
    toolAliasSettings.value = getDefaultToolAliasSettings();
  }
}

function expandRecentTools() {
  recentExpanded.value = true;
  activeIndex.value = 0;
}

function openTool(tool: ToolItem, forceNew = false, contentOverride?: string) {
  recentTools.value = [tool.key, ...recentTools.value.filter((key) => key !== tool.key)].slice(0, RECENT_STORAGE_LIMIT);
  localStorage.setItem('tooldesk-recent', JSON.stringify(recentTools.value));
  const content = contentOverride?.trim() || clipboardContent.value.trim() || searchQuery.value.trim() || undefined;

  if (window.tooldeskShortcut && forceNew) {
    void window.tooldeskShortcut.openQuickTool(tool.key, content, forceNew);
    return;
  }

  activeInlineTool.value = tool;
  activeInlineContent.value = content ?? '';
  activeInlineVersion.value = Date.now();
  searchQuery.value = '';

  if (!window.tooldeskShortcut) {
    emit('openTool', tool);
  }
}

function createLocalLibraryLaunchContent(library: TooldeskLocalLibraryConfig) {
  return JSON.stringify({
    libraryKeyword: library.keyword,
    source: 'quick-local-library'
  });
}

function openLocalLibraryTool(library: TooldeskLocalLibraryConfig, forceNew = false) {
  if (!obsidianPluginTool.value) {
    return;
  }

  openTool(obsidianPluginTool.value, forceNew, createLocalLibraryLaunchContent(library));
}

function getSearchMatchedLocalLibrary() {
  const exactLibrary = enabledLocalLibraries.value.find((lib) => lib.keyword.toLowerCase() === normalizedSearch.value);

  if (exactLibrary) {
    return exactLibrary;
  }

  return matchedLocalLibraries.value.length === 1 ? matchedLocalLibraries.value[0] : null;
}

function openSearchResultTool(tool: ToolItem, forceNew = false) {
  const searchContent = searchQuery.value.trim();

  if (obsidianPluginTool.value && tool.key === obsidianPluginTool.value.key) {
    const library = getSearchMatchedLocalLibrary();

    if (library) {
      openLocalLibraryTool(library, forceNew);
      return;
    }
  }

  if (commonSitesPluginTool.value && tool.key === commonSitesPluginTool.value.key && normalizedSearch.value) {
    openTool(
      commonSitesPluginTool.value,
      forceNew,
      JSON.stringify({
        autoOpen: true,
        query: searchQuery.value.trim(),
        source: 'quick-common-sites'
      })
    );
    return;
  }

  if (searchContent && searchContentMatchedTools.value.some((matchedTool) => matchedTool.key === tool.key)) {
    openTool(tool, forceNew, searchContent);
    return;
  }

  openTool(tool, forceNew);
}

async function openInstalledApplication(application: InstalledApplication) {
  if (!window.tooldeskShortcut?.launchInstalledApplication) {
    return;
  }

  try {
    await window.tooldeskShortcut.launchInstalledApplication(application.id);
    await window.tooldeskShortcut.closeCurrentWindow();
  } catch (error) {
    console.warn('[tooldesk] Failed to launch installed application.', error);
  }
}

function openSearchResult(result: QuickSearchResult, forceNew = false) {
  if (result.type === 'application') {
    void openInstalledApplication(result.application);
    return;
  }

  openSearchResultTool(result.tool, forceNew);
}

function focusSearchInput(options: { selectExisting?: boolean } = {}) {
  if (activeInlineTool.value) {
    return;
  }

  void nextTick(() => {
    const input = searchInput.value;
    if (!input) {
      return;
    }

    input.focus();

    if (options.selectExisting && input.value) {
      input.select();
    }
  });
}

function resolveCommonSiteCommand(rawQuery: string) {
  const trimmed = rawQuery.trim();

  if (!trimmed) {
    return null;
  }

  const [prefix, ...rest] = trimmed.split(/\s+/);
  const normalizedPrefix = prefix.trim().toLowerCase();
  const searchText = rest.join(' ').trim();
  const site = COMMON_SITE_COMMANDS.find((item) =>
    item.aliases.some((alias) => alias.toLowerCase() === normalizedPrefix)
  );

  if (!site) {
    return null;
  }

  return {
    targetUrl: searchText ? site.searchUrl.replace('{query}', encodeURIComponent(searchText)) : site.openUrl
  };
}

function openExternalUrl(targetUrl: string) {
  if (window.tooldeskShortcut?.openExternalUrl) {
    void window.tooldeskShortcut.openExternalUrl(targetUrl);
    return;
  }

  window.open(targetUrl, '_blank', 'noopener,noreferrer');
}

function clearClipboardContent() {
  clipboardContent.value = '';
  searchQuery.value = '';
  activeInlineTool.value = null;
  activeInlineContent.value = '';
  activeInlineVersion.value = 0;
  focusSearchInput({ selectExisting: true });
}

function closeInlineTool() {
  activeInlineTool.value = null;
  activeInlineContent.value = '';
  activeInlineVersion.value = 0;
  void nextTick(() => searchInput.value?.focus());
}

async function openInlineToolInWindow() {
  if (!activeInlineTool.value) {
    return;
  }

  if (window.tooldeskShortcut) {
    await window.tooldeskShortcut.openQuickTool(activeInlineTool.value.key, activeInlineContent.value || undefined, true);
    return;
  }

  openTool(activeInlineTool.value, true, activeInlineContent.value);
}

function isInlineToolChromeTarget(target: globalThis.EventTarget | null) {
  return target instanceof HTMLElement && !target.closest('.quick-launcher-inline-drag-space');
}

async function handleInlineSearchDoubleClick(event: MouseEvent) {
  if (!activeInlineTool.value || inlineDoubleClickOpening || isInlineToolChromeTarget(event.target)) {
    return;
  }

  inlineDoubleClickOpening = true;

  try {
    await openInlineToolInWindow();
    void window.tooldeskShortcut?.closeCurrentWindow();
  } finally {
    window.setTimeout(() => {
      inlineDoubleClickOpening = false;
    }, 250);
  }
}

async function openInlineToolInStandaloneWindow() {
  if (!activeInlineTool.value || inlineDoubleClickOpening) {
    return;
  }

  hideInlineWindowHint(true);
  inlineDoubleClickOpening = true;

  try {
    await openInlineToolInWindow();
    void window.tooldeskShortcut?.closeCurrentWindow();
  } finally {
    window.setTimeout(() => {
      inlineDoubleClickOpening = false;
    }, 250);
  }
}

function hideInlineWindowHint(markSeen = false) {
  showInlineWindowHint.value = false;

  if (inlineWindowHintTimer !== null) {
    window.clearTimeout(inlineWindowHintTimer);
    inlineWindowHintTimer = null;
  }

  if (markSeen) {
    localStorage.setItem(INLINE_WINDOW_HINT_STORAGE_KEY, '1');
  }
}

function maybeShowInlineWindowHint() {
  if (localStorage.getItem(INLINE_WINDOW_HINT_STORAGE_KEY) === '1') {
    return;
  }

  showInlineWindowHint.value = true;
  localStorage.setItem(INLINE_WINDOW_HINT_STORAGE_KEY, '1');

  inlineWindowHintTimer = window.setTimeout(() => {
    hideInlineWindowHint();
  }, 4200);
}

function isInlineDoubleClick(event: globalThis.PointerEvent) {
  const now = Date.now();
  const last = inlineLastPointerDown;

  inlineLastPointerDown = {
    time: now,
    x: event.screenX,
    y: event.screenY
  };

  if (!last || now - last.time > INLINE_DOUBLE_CLICK_INTERVAL) {
    return false;
  }

  return Math.hypot(event.screenX - last.x, event.screenY - last.y) <= INLINE_DOUBLE_CLICK_DISTANCE;
}

function handleInlineTitlePointerDown(event: globalThis.PointerEvent) {
  if (!activeInlineTool.value || event.button !== 0 || isInlineToolChromeTarget(event.target)) {
    return;
  }

  if (isInlineDoubleClick(event)) {
    event.preventDefault();
    void handleInlineSearchDoubleClick(event as unknown as MouseEvent);
    return;
  }

  event.preventDefault();
  void window.tooldeskShortcut?.startCurrentWindowDrag?.();
}

function handleSearchDragPointerDown(event: globalThis.PointerEvent) {
  if (activeInlineTool.value || event.button !== 0) {
    return;
  }

  event.preventDefault();
  void window.tooldeskShortcut?.startCurrentWindowDrag?.().finally(() => {
    focusSearchInput();
  });
}

function updateSearchInputWidth() {
  void nextTick(() => {
    const measuredWidth = searchInputMeasure.value?.offsetWidth ?? 0;
    searchInputWidth.value = `${Math.max(18, Math.ceil(measuredWidth) + 8)}px`;
  });
}

function handleSearchKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    searchInput.value?.select();
    return;
  }

  if (event.key === 'Backspace' && !searchQuery.value && showClipboardChip.value) {
    event.preventDefault();
    clearClipboardContent();
    return;
  }

  if (activeInlineTool.value) {
    event.preventDefault();

    if (event.key === 'Enter') {
      openInlineToolInWindow();
    } else if (event.key === 'Escape') {
      closeInlineTool();
    }

    return;
  }

  if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    moveActiveTool(event.key.replace('Arrow', '').toLowerCase() as QuickKeyboardDirection);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();

    if (activeKeyboardItem.value) {
      const commonSiteCommand = resolveCommonSiteCommand(searchQuery.value);
      if (
        commonSiteCommand &&
        commonSitesPluginTool.value &&
        activeKeyboardItem.value.type === 'tool' &&
        activeKeyboardItem.value.tool.key === commonSitesPluginTool.value.key
      ) {
        openExternalUrl(commonSiteCommand.targetUrl);
        return;
      }

      openKeyboardItem(activeKeyboardItem.value, event.shiftKey);
      return;
    }

    const commonSiteCommand = resolveCommonSiteCommand(searchQuery.value);
    if (commonSiteCommand) {
      openExternalUrl(commonSiteCommand.targetUrl);
      return;
    }

    const library = enabledLocalLibraries.value.find((lib) => lib.keyword.toLowerCase() === normalizedSearch.value);
    if (library) {
      openLocalLibraryTool(library, event.shiftKey);
      return;
    }

  }

  if (event.key === 'Escape') {
    event.preventDefault();
    void window.tooldeskShortcut?.closeCurrentWindow();
  }
}

function openKeyboardItem(item: QuickKeyboardItem, forceNew = false) {
  if (item.type === 'application') {
    void openInstalledApplication(item.application);
    return;
  }

  openSearchResultTool(item.tool, forceNew);
}

function moveActiveTool(direction: QuickKeyboardDirection) {
  const length = keyboardItems.value.length;

  if (length === 0) {
    activeIndex.value = 0;
    return;
  }

  if (direction === 'left' || direction === 'right') {
    const offset = direction === 'right' ? 1 : -1;
    activeIndex.value = (activeIndex.value + offset + length) % length;
    return;
  }

  moveActiveToolByRow(direction);
}

function moveActiveToolByRow(direction: 'down' | 'up') {
  const buttons = [...document.querySelectorAll('.quick-launcher-tool')];
  const currentButton = buttons[activeIndex.value];

  if (!currentButton) {
    activeIndex.value = 0;
    return;
  }

  const currentRect = currentButton.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;
  const candidates = buttons
    .map((button, index) => {
      const rect = button.getBoundingClientRect();

      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        index
      };
    })
    .filter((item) => (direction === 'down' ? item.centerY > currentCenterY + 4 : item.centerY < currentCenterY - 4));

  if (candidates.length === 0) {
    return;
  }

  const nextRowY =
    direction === 'down'
      ? Math.min(...candidates.map((item) => item.centerY))
      : Math.max(...candidates.map((item) => item.centerY));
  const target = candidates
    .filter((item) => Math.abs(item.centerY - nextRowY) < 8)
    .sort((a, b) => Math.abs(a.centerX - currentCenterX) - Math.abs(b.centerX - currentCenterX))[0];

  if (target) {
    activeIndex.value = target.index;
  }
}

function isToolActive(group: QuickKeyboardGroup, tool: ToolItem, index: number) {
  return activeKeyboardItem.value?.id === `${group}:${tool.key}:${index}`;
}

function isSearchResultActive(result: QuickSearchResult, index: number) {
  const id = result.type === 'tool' ? `search:${result.tool.key}:${index}` : `search:${result.id}:${index}`;
  return activeKeyboardItem.value?.id === id;
}

onMounted(() => {
  loadSavedToolState();

  const content = props.shortcutContent?.trim() ?? '';
  if (content) {
    clipboardContent.value = content;
  }

  void nextTick(() => searchInput.value?.focus());

  if (window.tooldeskShortcut) {
    void window.tooldeskShortcut.getLocalLibraries().then((libraries) => {
      localLibraries.value = libraries;
    });
    void refreshInstalledApplications();
  }
});

onUnmounted(() => {
  hideInlineWindowHint();
});

watch(activeInlineTool, (tool) => {
  if (!window.tooldeskShortcut) {
    return;
  }

  if (tool) {
    maybeShowInlineWindowHint();
    void window.tooldeskShortcut.fitCurrentWindow({
      width: LAUNCHER_WINDOW_WIDTH,
      height: INLINE_TOOL_WINDOW_HEIGHT
    });
    return;
  }

  void nextTick(() =>
    window.tooldeskShortcut?.fitCurrentWindow({
      width: LAUNCHER_WINDOW_WIDTH,
      height: LAUNCHER_WINDOW_HEIGHT
    })
  );
});

watch(searchInputText, updateSearchInputWidth, { immediate: true });
</script>

<template>
  <section class="quick-launcher" :class="{ 'quick-launcher-inline-active': activeInlineTool }">
    <label
      v-if="!activeInlineTool"
      class="quick-launcher-search"
    >
      <AppIcon name="search" />

      <div class="quick-launcher-search-field" @click="() => focusSearchInput()">
        <div v-if="showClipboardChip" class="quick-launcher-clipboard-chip" :title="clipboardContent">
          <span class="quick-launcher-clipboard-chip-text">{{ clipboardPreview }}</span>
          <button
            class="quick-launcher-clipboard-chip-remove"
            type="button"
            aria-label="清除剪贴板内容"
            @click.stop="clearClipboardContent"
          >
            <svg class="quick-launcher-clipboard-chip-remove-icon" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </div>

        <input
          ref="searchInput"
          v-model="searchQuery"
          type="search"
          placeholder=""
          :style="{ width: searchInputWidth }"
          @keydown="handleSearchKeydown"
        />
        <span
          v-if="!searchQuery"
          class="quick-launcher-search-placeholder"
          @click.prevent.stop
          @pointerdown.stop="handleSearchDragPointerDown"
        >
          {{ searchPlaceholder }}
        </span>
        <span ref="searchInputMeasure" class="quick-launcher-search-measure">{{ searchInputText }}</span>
        <div
          class="quick-launcher-search-drag-space"
          aria-hidden="true"
          @click.prevent.stop
          @pointerdown.stop="handleSearchDragPointerDown"
        ></div>
      </div>
    </label>

    <div
      v-else
      class="quick-launcher-search quick-launcher-search-inline-active"
      @dblclick="handleInlineSearchDoubleClick"
      @pointerdown="handleInlineTitlePointerDown"
    >
      <div class="quick-launcher-search-field quick-launcher-inline-title-field">
        <div class="quick-launcher-tool-chip" :title="activeInlineTool.label">
          <ToolIcon :accent="activeInlineTool.accent" :icon="activeInlineTool.icon" />
          <span class="quick-launcher-tool-chip-text">{{ activeInlineTool.label }}</span>
          <button
            class="quick-launcher-tool-chip-remove"
            type="button"
            aria-label="关闭当前组件"
            @click.prevent.stop="closeInlineTool"
            @pointerdown.prevent.stop="closeInlineTool"
          >
            <svg class="quick-launcher-clipboard-chip-remove-icon" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </div>
        <div class="quick-launcher-inline-drag-space" title="双击顶部空白区切换独立窗口">
          <span v-if="showInlineWindowHint" class="quick-launcher-inline-window-hint">
            双击顶部空白区，或点击右侧按钮切换独立窗口
          </span>
          <button
            class="quick-launcher-inline-window-button"
            type="button"
            title="独立窗口打开"
            aria-label="独立窗口打开"
            @click.prevent.stop="openInlineToolInStandaloneWindow"
            @pointerdown.prevent.stop
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3H3.8A1.8 1.8 0 0 0 2 4.8v7.4A1.8 1.8 0 0 0 3.8 14h7.4a1.8 1.8 0 0 0 1.8-1.8V10" />
              <path d="M9 2h5v5" />
              <path d="M8 8l6-6" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <div class="quick-launcher-body" :class="{ 'quick-launcher-body-inline-active': activeInlineTool }">
    <section v-if="activeInlineTool" class="quick-launcher-inline-tool">
      <ToolRenderer
        :key="activeInlineTool.key"
        :shortcut-content="inlineToolContent"
        :shortcut-content-version="activeInlineVersion"
        tool-class="quick-inline-tool-panel"
        :tool-key="activeInlineTool.key"
        :tool="activeInlineTool"
      />
    </section>

    <section v-else-if="isContentMatchMode" class="quick-launcher-section">
      <div class="quick-launcher-section-head">
        <h2>匹配结果</h2>
        <span>{{ contentResultItems.length }} 个</span>
      </div>
      <div v-if="contentResultItems.length > 0" class="quick-launcher-grid">
        <button
          v-for="(tool, index) in contentResultItems"
          :key="tool.key"
          class="quick-launcher-tool"
          :class="{ active: isToolActive('content', tool, index) }"
          type="button"
          @click="openTool(tool, $event.shiftKey)"
        >
          <ToolIcon :accent="tool.accent" :icon="tool.icon" />
          <span>{{ tool.label }}</span>
        </button>
      </div>
      <p v-else class="quick-launcher-empty">暂无匹配的工具，试试其他内容</p>
    </section>

    <section v-else-if="normalizedSearch" class="quick-launcher-section">
      <div class="quick-launcher-section-head">
        <h2>搜索结果</h2>
        <span>{{ searchResultItems.length }} 个</span>
      </div>
      <div v-if="searchResultItems.length > 0" class="quick-launcher-grid">
        <button
          v-for="(result, index) in searchResultItems"
          :key="result.id"
          class="quick-launcher-tool"
          :class="{ active: isSearchResultActive(result, index) }"
          type="button"
          @click="openSearchResult(result, $event.shiftKey)"
        >
          <ToolIcon v-if="result.type === 'tool'" :accent="result.tool.accent" :icon="result.tool.icon" />
          <ToolIcon v-else accent="cyan" :icon="resolveInstalledApplicationIcon(result.application)" />
          <span>{{ result.type === 'tool' ? result.tool.label : result.application.name }}</span>
        </button>
      </div>
      <p v-else class="quick-launcher-empty">未找到相关工具，换个关键词试试</p>
    </section>

    <template v-else>
      <section class="quick-launcher-section">
        <div class="quick-launcher-section-head">
          <h2>最近使用</h2>
          <button
            v-if="showRecentExpand"
            class="quick-launcher-section-action"
            type="button"
            @click="expandRecentTools"
          >
            展开（{{ allRecentToolItems.length }}）
          </button>
        </div>
        <div class="quick-launcher-grid">
          <button
            v-for="(tool, index) in defaultRecentItems"
            :key="tool.key"
            class="quick-launcher-tool"
            :class="{ active: isToolActive('recent', tool, index) }"
            type="button"
            @click="openTool(tool, $event.shiftKey)"
          >
            <ToolIcon :accent="tool.accent" :icon="tool.icon" />
            <span>{{ tool.label }}</span>
          </button>
        </div>
      </section>

      <section v-if="favoriteToolItems.length > 0" class="quick-launcher-section">
        <div class="quick-launcher-section-head">
          <h2>我的收藏</h2>
          <span>{{ favoriteToolItems.length }}</span>
        </div>
        <div class="quick-launcher-grid">
          <button
            v-for="(tool, index) in favoriteToolItems"
            :key="tool.key"
            class="quick-launcher-tool"
            :class="{ active: isToolActive('favorite', tool, index) }"
            type="button"
            @click="openTool(tool, $event.shiftKey)"
          >
            <ToolIcon :accent="tool.accent" :icon="tool.icon" />
            <span>{{ tool.label }}</span>
          </button>
        </div>
      </section>
    </template>
    </div>

    <p v-if="!activeInlineTool" class="quick-launcher-hint">
      <span class="quick-launcher-hint-item">
        <kbd>Enter</kbd>
        <span class="quick-launcher-hint-label">打开</span>
      </span>
      <span class="quick-launcher-hint-sep" aria-hidden="true" />
      <span class="quick-launcher-hint-item">
        <kbd>Shift</kbd>
        <span class="quick-launcher-hint-keysep">+</span>
        <kbd>Enter</kbd>
        <span class="quick-launcher-hint-label">新窗口</span>
      </span>
    </p>
  </section>
</template>
