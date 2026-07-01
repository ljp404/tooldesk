<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { formatPluginPermissions, getPluginPermissionLabel } from '../../shared/plugin/pluginApiReference';
import type { ExtensionMarketItem, ExtensionSettings, ToolAliasSettings, ToolItem } from '../../types/toolbox';
import { isPluginUpdateAvailable } from '../../utils/pluginVersion';
import { getToolUserAliases, normalizeToolAlias, normalizeToolAliases } from '../../utils/toolSearchIndex';
import AppIcon from '../ui/AppIcon.vue';
import ToolIcon from '../ui/ToolIcon.vue';

const props = defineProps<{
  actionDetails: string[];
  actionMessage: string;
  extensionSettings: ExtensionSettings;
  isLoadingExtensions: boolean;
  marketError: string;
  marketItems: ExtensionMarketItem[];
  toolAliasSettings: ToolAliasSettings;
  tools: ToolItem[];
}>();

const emit = defineEmits<{
  installLocalExtension: [];
  installMarketExtension: [item: ExtensionMarketItem];
  installSelectedMarketExtensions: [items: ExtensionMarketItem[]];
  openTool: [tool: ToolItem];
  refreshExtensions: [];
  uninstallExtension: [tool: ToolItem];
  uninstallSelectedExtensions: [tools: ToolItem[]];
  updateExtensionSettings: [settings: ExtensionSettings];
  updateToolAliasSettings: [settings: ToolAliasSettings];
}>();

type ActiveTab = 'installed' | 'market';
type InstalledFilter = 'all' | 'enabled' | 'disabled';
type MarketFilter = 'all' | 'available' | 'installed' | 'updates';
type MarketInstallState = 'available' | 'installed' | 'update';

const activeTab = ref<ActiveTab>('installed');
const installedFilter = ref<InstalledFilter>('all');
const marketFilter = ref<MarketFilter>('all');
const searchQuery = ref('');
const selectedInstalledKey = ref('');
const selectedMarketId = ref('');
const selectedInstalledPluginIds = ref<string[]>([]);
const selectedMarketPluginIds = ref<string[]>([]);
const detailPanelRef = ref<HTMLElement | null>(null);
const aliasDraft = ref('');
const aliasInputRef = ref<HTMLInputElement | null>(null);
const isEditingAlias = ref(false);
const aliasStatus = ref('');

const disabledToolKeySet = computed(() => new Set(props.extensionSettings.disabledToolKeys));
const installedPluginIds = computed(
  () => new Set(props.tools.filter((tool) => tool.source === 'plugin' && tool.pluginId).map((tool) => tool.pluginId))
);
const installedPluginVersionById = computed(() => {
  const versions = new Map<string, string>();

  for (const tool of props.tools) {
    if (tool.source === 'plugin' && tool.pluginId && tool.manifestVersion) {
      versions.set(tool.pluginId, tool.manifestVersion);
    }
  }

  return versions;
});
const marketUpdateCount = computed(() => props.marketItems.filter((item) => isMarketItemUpdateAvailable(item)).length);
const enabledToolCount = computed(() => props.tools.filter((tool) => !isToolDisabled(tool)).length);
const installedTools = computed(() => props.tools);

const visibleInstalledTools = computed(() => {
  const query = normalizeQuery(searchQuery.value);

  return installedTools.value.filter((tool) => {
    if (!matchesInstalledFilter(tool)) {
      return false;
    }

    return matchesToolQuery(tool, query);
  });
});

const visibleMarketItems = computed(() => {
  const query = normalizeQuery(searchQuery.value);

  return props.marketItems.filter((item) => {
    if (marketFilter.value === 'available' && isMarketItemInstalled(item)) {
      return false;
    }

    if (marketFilter.value === 'installed' && !isMarketItemInstalled(item)) {
      return false;
    }

    if (marketFilter.value === 'updates' && !isMarketItemUpdateAvailable(item)) {
      return false;
    }

    return matchesMarketQuery(item, query);
  });
});

const activeInstalledList = computed(() => visibleInstalledTools.value);

const selectableVisibleMarketItems = computed(() => visibleMarketItems.value.filter((item) => isMarketItemBatchSelectable(item)));

const selectedMarketItems = computed(() => {
  const selectedIds = new Set(selectedMarketPluginIds.value);
  return props.marketItems.filter((item) => selectedIds.has(item.pluginId) && isMarketItemSelectable(item));
});

const selectedMarketInstalledTools = computed(() => {
  const selectedIds = new Set(selectedMarketPluginIds.value);
  const toolsByPluginId = new Map<string, ToolItem>();

  for (const tool of props.tools) {
    if (
      isInstalledToolSelectable(tool) &&
      tool.pluginId &&
      selectedIds.has(tool.pluginId) &&
      !toolsByPluginId.has(tool.pluginId)
    ) {
      toolsByPluginId.set(tool.pluginId, tool);
    }
  }

  return Array.from(toolsByPluginId.values());
});

const selectedMarketBatchCount = computed(() => {
  const selectedIds = new Set<string>();

  for (const item of selectedMarketItems.value) {
    selectedIds.add(item.pluginId);
  }

  for (const tool of selectedMarketInstalledTools.value) {
    if (tool.pluginId) {
      selectedIds.add(tool.pluginId);
    }
  }

  return selectedIds.size;
});

const selectableVisibleInstalledTools = computed(() => {
  const toolsByPluginId = new Map<string, ToolItem>();

  for (const tool of activeInstalledList.value) {
    if (isInstalledToolSelectable(tool) && tool.pluginId && !toolsByPluginId.has(tool.pluginId)) {
      toolsByPluginId.set(tool.pluginId, tool);
    }
  }

  return Array.from(toolsByPluginId.values());
});

const selectedInstalledTools = computed(() => {
  const selectedIds = new Set(selectedInstalledPluginIds.value);
  const toolsByPluginId = new Map<string, ToolItem>();

  for (const tool of props.tools) {
    if (
      isInstalledToolSelectable(tool) &&
      tool.pluginId &&
      selectedIds.has(tool.pluginId) &&
      !toolsByPluginId.has(tool.pluginId)
    ) {
      toolsByPluginId.set(tool.pluginId, tool);
    }
  }

  return Array.from(toolsByPluginId.values());
});

const isAllVisibleMarketSelected = computed(
  () =>
    selectableVisibleMarketItems.value.length > 0 &&
    selectableVisibleMarketItems.value.every((item) => selectedMarketPluginIds.value.includes(item.pluginId))
);

const isAllVisibleInstalledSelected = computed(
  () =>
    selectableVisibleInstalledTools.value.length > 0 &&
    selectableVisibleInstalledTools.value.every((tool) => tool.pluginId && selectedInstalledPluginIds.value.includes(tool.pluginId))
);

const selectedTool = computed(() => {
  return installedTools.value.find((tool) => tool.key === selectedInstalledKey.value) ?? activeInstalledList.value[0] ?? null;
});

const selectedMarketItem = computed(
  () => props.marketItems.find((item) => item.pluginId === selectedMarketId.value) ?? visibleMarketItems.value[0] ?? null
);

const selectedToolMarketItem = computed(() => {
  const tool = selectedTool.value;

  if (!tool?.pluginId) {
    return null;
  }

  return props.marketItems.find((item) => item.pluginId === tool.pluginId) ?? null;
});

const selectedDetailKey = computed(() => {
  if (activeTab.value === 'market') {
    return `market:${selectedMarketItem.value?.pluginId ?? 'empty'}`;
  }

  return `installed:${selectedTool.value?.key ?? 'empty'}`;
});

const isSelectedToolUpdateAvailable = computed(() => {
  const tool = selectedTool.value;
  const item = selectedToolMarketItem.value;

  if (!tool || tool.source !== 'plugin' || !item) {
    return false;
  }

  return isMarketItemUpdateAvailable(item);
});

const detailRows = computed(() => {
  const tool = selectedTool.value;

  if (!tool) {
    return [];
  }

  const rows = [
    { label: '分类', value: tool.category },
    { label: '默认指令', value: tool.defaultAlias ?? tool.key },
    { label: '搜索词', value: tool.keywords.length ? tool.keywords.join(' / ') : '无' },
    { label: '版本', value: tool.source === 'plugin' ? tool.manifestVersion ?? '未知' : '随应用发布' },
    ...(tool.source === 'plugin' ? [{ label: '权限', value: formatToolPermissions(tool) }] : [])
  ];

  if (tool.source === 'plugin') {
    const marketItem = props.marketItems.find((item) => item.pluginId === tool.pluginId);

    if (marketItem) {
      rows.push({ label: '市场版本', value: `v${marketItem.version}` });
    }
  }

  return rows;
});

const marketDetailRows = computed(() => {
  const item = selectedMarketItem.value;

  if (!item) {
    return [];
  }

  const installState = getMarketItemInstallState(item);
  const installedVersion = getInstalledPluginVersion(item.pluginId);

  return [
    { label: '分类', value: item.category },
    { label: '默认指令', value: item.defaultAlias },
    { label: '搜索词', value: item.keywords.length ? item.keywords.join(' / ') : '无' },
    { label: '市场版本', value: `v${item.version}` },
    ...(installedVersion ? [{ label: '当前版本', value: `v${installedVersion}` }] : []),
    { label: '发布者', value: item.publisher },
    { label: '信任级别', value: formatMarketTrust(item) },
    { label: '包校验', value: formatShortSha256(item.sha256) },
    { label: '更新时间', value: item.updatedAt || '未知' },
    { label: '安装状态', value: formatMarketInstallStatus(item, installState) }
  ];
});

const marketFeatureItems = computed(() => {
  const item = selectedMarketItem.value;

  if (!item) {
    return [];
  }

  return [
    item.caption,
    `支持通过 ${item.defaultAlias} 快速搜索和打开`,
    item.permissions.length ? `使用 ${formatMarketPermissions(item)} 能力` : '无需额外宿主权限'
  ].filter(Boolean);
});

const marketUsageItems = computed(() => {
  const item = selectedMarketItem.value;

  if (!item) {
    return [];
  }

  const action = getMarketItemInstallState(item) === 'installed' ? '确认扩展已启用' : `点击${getMarketItemActionLabel(item)}完成安装`;

  return [action, `在主搜索框输入 ${item.defaultAlias} 或相关关键词`, '打开扩展后按工具界面完成操作'];
});

const toolFeatureItems = computed(() => {
  const tool = selectedTool.value;

  if (!tool) {
    return [];
  }

  return [
    tool.caption,
    `支持通过 ${tool.defaultAlias ?? tool.key} 快速搜索和打开`,
    getToolPermissions(tool).length ? `使用 ${formatToolPermissions(tool)} 能力` : '无需额外宿主权限'
  ].filter(Boolean);
});

const toolUsageItems = computed(() => {
  const tool = selectedTool.value;

  if (!tool) {
    return [];
  }

  return [isToolDisabled(tool) ? '先启用该组件' : '确认组件已启用', `在主搜索框输入 ${tool.defaultAlias ?? tool.key} 或相关关键词`, '打开组件后按工具界面完成操作'];
});

watch(
  visibleInstalledTools,
  (tools) => {
    if (activeTab.value !== 'installed') {
      return;
    }

    if (!tools.some((tool) => tool.key === selectedInstalledKey.value)) {
      selectedInstalledKey.value = tools[0]?.key ?? '';
    }
  },
  { immediate: true }
);

watch(
  selectedTool,
  (tool) => {
    aliasDraft.value = tool ? formatToolAliasesForInput(tool) : '';
    isEditingAlias.value = false;
    aliasStatus.value = '';
  },
  { immediate: true }
);

watch(
  () => props.toolAliasSettings,
  () => {
    const tool = selectedTool.value;
    aliasDraft.value = tool ? formatToolAliasesForInput(tool) : '';
  },
  { deep: true, immediate: true }
);

watch(
  visibleMarketItems,
  (items) => {
    if (!items.some((item) => item.pluginId === selectedMarketId.value)) {
      selectedMarketId.value = items[0]?.pluginId ?? '';
    }
  },
  { immediate: true }
);

watch(
  selectedDetailKey,
  async () => {
    await nextTick();
    detailPanelRef.value?.scrollTo({ top: 0 });
  }
);

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function isToolDisabled(tool: ToolItem) {
  return disabledToolKeySet.value.has(tool.key);
}

function matchesInstalledFilter(tool: ToolItem) {
  if (installedFilter.value === 'enabled') {
    return !isToolDisabled(tool);
  }

  if (installedFilter.value === 'disabled') {
    return isToolDisabled(tool);
  }

  return true;
}

function matchesToolQuery(tool: ToolItem, query: string) {
  if (!query) {
    return true;
  }

  return [
    tool.label,
    tool.caption,
    tool.key,
    tool.defaultAlias,
    tool.category,
    ...getToolPermissions(tool),
    ...getToolPermissions(tool).map(getPluginPermissionLabel),
    ...tool.keywords,
    ...getCustomAliases(tool)
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function matchesMarketQuery(item: ExtensionMarketItem, query: string) {
  if (!query) {
    return true;
  }

  return [
    item.label,
    item.caption,
    item.pluginId,
    item.defaultAlias,
    item.category,
    item.publisher,
    item.trustLevel,
    item.version,
    ...item.permissions,
    ...item.permissions.map(getPluginPermissionLabel),
    ...item.keywords
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function formatMarketPermissions(item: ExtensionMarketItem) {
  return formatPluginPermissions(item.permissions);
}

function formatMarketTrust(item: ExtensionMarketItem) {
  if (item.trustLevel === 'official') {
    return '官方发布';
  }

  if (item.trustLevel === 'verified') {
    return '已验证发布者';
  }

  return item.trusted ? '可信发布者' : '社区发布者';
}

function formatShortSha256(value: string) {
  return value ? `${value.slice(0, 12)}...${value.slice(-8)}` : '未提供';
}

function getToolPermissions(tool: ToolItem) {
  return tool.permissions ?? [];
}

function formatToolPermissions(tool: ToolItem) {
  const permissions = getToolPermissions(tool);
  return formatPluginPermissions(permissions);
}

function isMarketItemInstalled(item: ExtensionMarketItem) {
  return installedPluginIds.value.has(item.pluginId);
}

function getInstalledPluginVersion(pluginId: string) {
  return installedPluginVersionById.value.get(pluginId) ?? '';
}

function isMarketItemUpdateAvailable(item: ExtensionMarketItem) {
  const installedVersion = getInstalledPluginVersion(item.pluginId);

  if (!installedVersion) {
    return false;
  }

  return isPluginUpdateAvailable(installedVersion, item.version);
}

function getMarketItemInstallState(item: ExtensionMarketItem): MarketInstallState {
  const installedVersion = getInstalledPluginVersion(item.pluginId);

  if (!installedVersion) {
    return 'available';
  }

  return isPluginUpdateAvailable(installedVersion, item.version) ? 'update' : 'installed';
}

function isMarketItemSelectable(item: ExtensionMarketItem) {
  return getMarketItemInstallState(item) !== 'installed';
}

function isMarketItemBatchSelectable(item: ExtensionMarketItem) {
  return isMarketItemSelectable(item) || Boolean(getInstalledToolForMarketItem(item));
}

function isInstalledToolSelectable(tool: ToolItem) {
  return tool.source === 'plugin' && Boolean(tool.pluginId);
}

function getMarketItemStatusLabel(item: ExtensionMarketItem) {
  const state = getMarketItemInstallState(item);

  if (state === 'update') {
    return '有更新';
  }

  if (state === 'installed') {
    return '已安装';
  }

  return '市场';
}

function formatMarketInstallStatus(item: ExtensionMarketItem, state: MarketInstallState = getMarketItemInstallState(item)) {
  const installedVersion = getInstalledPluginVersion(item.pluginId);

  if (state === 'update') {
    return `已安装 v${installedVersion}，可更新至 v${item.version}`;
  }

  if (state === 'installed') {
    return `已安装 v${installedVersion}，已是最新`;
  }

  return '未安装';
}

function getMarketItemActionLabel(item: ExtensionMarketItem) {
  return getMarketItemInstallState(item) === 'update' ? '更新' : '安装';
}

function isToolUpdateAvailable(tool: ToolItem) {
  if (tool.source !== 'plugin' || !tool.pluginId) {
    return false;
  }

  const marketItem = props.marketItems.find((item) => item.pluginId === tool.pluginId);

  return marketItem ? isMarketItemUpdateAvailable(marketItem) : false;
}

function getCustomAliases(tool: ToolItem) {
  return getToolUserAliases(tool, props.toolAliasSettings);
}

function formatToolAliases(tool: ToolItem) {
  const aliases = getCustomAliases(tool);
  return aliases.length ? aliases.join(' / ') : '无';
}

function formatToolAliasesForInput(tool: ToolItem) {
  return getCustomAliases(tool).join(', ');
}

function parseAliasDraft(tool: ToolItem) {
  const builtInTokens = new Set([tool.defaultAlias, ...tool.keywords].map((value) => normalizeToolAlias(value ?? '')).filter(Boolean));
  const values = aliasDraft.value.split(/[\s,，、/]+/);

  return normalizeToolAliases(values).filter((alias) => !builtInTokens.has(alias));
}

function findAliasConflict(tool: ToolItem, aliases: string[]) {
  const aliasSet = new Set(aliases);

  for (const candidate of props.tools) {
    if (candidate.key === tool.key) {
      continue;
    }

    const reservedAliases = [candidate.defaultAlias, ...getCustomAliases(candidate)]
      .map((value) => normalizeToolAlias(value ?? ''))
      .filter(Boolean);

    const conflict = reservedAliases.find((alias) => aliasSet.has(alias));

    if (conflict) {
      return { alias: conflict, tool: candidate };
    }
  }

  return null;
}

function saveToolAliases(tool: ToolItem) {
  const aliases = parseAliasDraft(tool);
  const conflict = findAliasConflict(tool, aliases);

  if (conflict) {
    aliasStatus.value = `别名 ${conflict.alias} 已被 ${conflict.tool.label} 使用`;
    return;
  }

  const aliasesByTool = { ...props.toolAliasSettings.aliasesByTool };

  if (aliases.length > 0) {
    aliasesByTool[tool.key] = aliases;
  } else {
    delete aliasesByTool[tool.key];
  }

  emit('updateToolAliasSettings', { aliasesByTool });
  aliasDraft.value = aliases.join(', ');
  isEditingAlias.value = false;
  aliasStatus.value = '';
}

async function startEditToolAliases(tool: ToolItem) {
  aliasDraft.value = formatToolAliasesForInput(tool);
  isEditingAlias.value = true;
  aliasStatus.value = '';
  await nextTick();
  aliasInputRef.value?.focus();
}

function cancelEditToolAliases(tool: ToolItem) {
  aliasDraft.value = formatToolAliasesForInput(tool);
  isEditingAlias.value = false;
  aliasStatus.value = '';
}

function updateToolEnabled(tool: ToolItem, enabled: boolean) {
  const disabledToolKeys = enabled
    ? props.extensionSettings.disabledToolKeys.filter((key) => key !== tool.key)
    : Array.from(new Set([...props.extensionSettings.disabledToolKeys, tool.key]));

  emit('updateExtensionSettings', { disabledToolKeys });
}

function openTool(tool: ToolItem | null) {
  if (tool && !isToolDisabled(tool)) {
    emit('openTool', tool);
  }
}

function installMarketItem(item: ExtensionMarketItem | null) {
  if (!item || getMarketItemInstallState(item) === 'installed') {
    return;
  }

  const action = getMarketItemInstallState(item) === 'update' ? '更新' : '安装';
  const confirmed = window.confirm(
    [
      `${action}扩展：${item.label} v${item.version}`,
      `发布者：${item.publisher}（${formatMarketTrust(item)}）`,
      `权限：${formatMarketPermissions(item)}`,
      `包校验：${formatShortSha256(item.sha256)}`,
      '',
      '确认后将下载扩展包、校验 SHA-256，并按插件权限运行。'
    ].join('\n')
  );

  if (confirmed) {
    emit('installMarketExtension', item);
  }
}

function uninstallTool(tool: ToolItem | null) {
  if (!tool || tool.source !== 'plugin') {
    return;
  }

  emit('uninstallExtension', tool);
}

function getInstalledToolForMarketItem(item: ExtensionMarketItem) {
  return props.tools.find((tool) => tool.source === 'plugin' && tool.pluginId === item.pluginId) ?? null;
}

function uninstallMarketItem(item: ExtensionMarketItem | null) {
  const tool = item ? getInstalledToolForMarketItem(item) : null;
  uninstallTool(tool);
}

function isMarketItemSelected(item: ExtensionMarketItem) {
  return selectedMarketPluginIds.value.includes(item.pluginId);
}

function updateMarketSelection(item: ExtensionMarketItem, checked: boolean) {
  if (!isMarketItemBatchSelectable(item)) {
    return;
  }

  const selectedIds = new Set(selectedMarketPluginIds.value);

  if (checked) {
    selectedIds.add(item.pluginId);
  } else {
    selectedIds.delete(item.pluginId);
  }

  selectedMarketPluginIds.value = Array.from(selectedIds);
}

function toggleVisibleMarketSelection(checked: boolean) {
  const selectedIds = new Set(selectedMarketPluginIds.value);

  for (const item of selectableVisibleMarketItems.value) {
    if (checked) {
      selectedIds.add(item.pluginId);
    } else {
      selectedIds.delete(item.pluginId);
    }
  }

  selectedMarketPluginIds.value = Array.from(selectedIds);
}

function installSelectedMarketItems() {
  const items = selectedMarketItems.value;

  if (items.length === 0) {
    return;
  }

  const permissionSet = new Set(items.flatMap((item) => item.permissions));
  const untrustedCount = items.filter((item) => !item.trusted).length;
  const confirmed = window.confirm(
    [
      `安装/更新 ${items.length} 个扩展`,
      `权限集合：${formatPluginPermissions(Array.from(permissionSet))}`,
      `社区发布者：${untrustedCount} 个`,
      '',
      '确认后将逐个下载扩展包、校验 SHA-256，并按插件权限运行。'
    ].join('\n')
  );

  if (!confirmed) {
    return;
  }

  emit('installSelectedMarketExtensions', items);
  selectedMarketPluginIds.value = selectedMarketPluginIds.value.filter((pluginId) => !items.some((item) => item.pluginId === pluginId));
}

function uninstallSelectedMarketItems() {
  const tools = selectedMarketInstalledTools.value;

  if (tools.length === 0) {
    return;
  }

  emit('uninstallSelectedExtensions', tools);
  selectedMarketPluginIds.value = selectedMarketPluginIds.value.filter(
    (pluginId) => !tools.some((tool) => tool.pluginId === pluginId)
  );
}

function isInstalledToolSelected(tool: ToolItem) {
  return Boolean(isInstalledToolSelectable(tool) && tool.pluginId && selectedInstalledPluginIds.value.includes(tool.pluginId));
}

function updateInstalledSelection(tool: ToolItem, checked: boolean) {
  if (!isInstalledToolSelectable(tool) || !tool.pluginId) {
    return;
  }

  const selectedIds = new Set(selectedInstalledPluginIds.value);

  if (checked) {
    selectedIds.add(tool.pluginId);
  } else {
    selectedIds.delete(tool.pluginId);
  }

  selectedInstalledPluginIds.value = Array.from(selectedIds);
}

function toggleVisibleInstalledSelection(checked: boolean) {
  const selectedIds = new Set(selectedInstalledPluginIds.value);

  for (const tool of selectableVisibleInstalledTools.value) {
    if (!tool.pluginId) {
      continue;
    }

    if (checked) {
      selectedIds.add(tool.pluginId);
    } else {
      selectedIds.delete(tool.pluginId);
    }
  }

  selectedInstalledPluginIds.value = Array.from(selectedIds);
}

function uninstallSelectedInstalledTools() {
  const tools = selectedInstalledTools.value;

  if (tools.length === 0) {
    return;
  }

  emit('uninstallSelectedExtensions', tools);
  selectedInstalledPluginIds.value = selectedInstalledPluginIds.value.filter(
    (pluginId) => !tools.some((tool) => tool.pluginId === pluginId)
  );
}

watch(
  () => props.marketItems,
  (items) => {
    const validIds = new Set(items.filter((item) => isMarketItemBatchSelectable(item)).map((item) => item.pluginId));
    selectedMarketPluginIds.value = selectedMarketPluginIds.value.filter((pluginId) => validIds.has(pluginId));
  },
  { deep: true }
);

watch(
  () => props.tools,
  (tools) => {
  const validIds = new Set(
    tools.filter((tool) => isInstalledToolSelectable(tool) && tool.pluginId).map((tool) => tool.pluginId as string)
  );
    selectedInstalledPluginIds.value = selectedInstalledPluginIds.value.filter((pluginId) => validIds.has(pluginId));
  },
  { deep: true }
);

</script>

<template>
  <section class="extension-center">
    <header class="extension-toolbar">
      <div class="extension-title-block">
        <h2>扩展中心</h2>
        <p>{{ enabledToolCount }} / {{ tools.length }} 个组件已启用</p>
        <p v-if="marketUpdateCount > 0" class="extension-update-hint">有 {{ marketUpdateCount }} 个扩展可更新</p>
      </div>

      <label class="extension-search">
        <AppIcon name="search" />
        <input v-model="searchQuery" type="search" placeholder="搜索扩展、指令、搜索词、权限或来源" />
      </label>

      <div class="extension-actions">
        <button
          type="button"
          class="extension-secondary-button"
          :disabled="isLoadingExtensions"
          title="重新读取本机插件并拉取扩展市场最新列表"
          @click="$emit('refreshExtensions')"
        >
          刷新列表
        </button>
        <button type="button" class="extension-primary-button" :disabled="isLoadingExtensions" @click="$emit('installLocalExtension')">
          安装本地
        </button>
      </div>
    </header>

    <div v-if="actionMessage" class="extension-action-message">
      <p>{{ actionMessage }}</p>
      <details v-if="actionDetails.length" class="extension-action-details">
        <summary>查看调试详情</summary>
        <ul>
          <li v-for="detail in actionDetails" :key="detail">{{ detail }}</li>
        </ul>
      </details>
    </div>

    <div class="extension-scopebar">
      <div class="extension-tabs" role="tablist" aria-label="扩展中心">
        <button type="button" :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">
          本机组件
          <span>{{ installedTools.length }}</span>
        </button>
        <button type="button" :class="{ active: activeTab === 'market' }" @click="activeTab = 'market'">
          扩展市场
          <span>{{ marketItems.length }}</span>
        </button>
      </div>

      <div v-if="activeTab === 'installed'" class="extension-filter-row">
        <button type="button" :class="{ active: installedFilter === 'all' }" @click="installedFilter = 'all'">全部</button>
        <button type="button" :class="{ active: installedFilter === 'enabled' }" @click="installedFilter = 'enabled'">启用</button>
        <button type="button" :class="{ active: installedFilter === 'disabled' }" @click="installedFilter = 'disabled'">停用</button>
      </div>

      <div v-else class="extension-filter-row">
        <button type="button" :class="{ active: marketFilter === 'all' }" @click="marketFilter = 'all'">全部</button>
        <button type="button" :class="{ active: marketFilter === 'available' }" @click="marketFilter = 'available'">可安装</button>
        <button type="button" :class="{ active: marketFilter === 'installed' }" @click="marketFilter = 'installed'">已安装</button>
        <button type="button" :class="{ active: marketFilter === 'updates' }" @click="marketFilter = 'updates'">
          有更新
          <span v-if="marketUpdateCount > 0" class="extension-filter-update-count">{{ marketUpdateCount }}</span>
        </button>
      </div>
    </div>

    <main class="extension-workspace">
      <section class="extension-list-panel" aria-label="扩展列表">
        <template v-if="activeTab === 'market'">
          <div class="extension-selection-bar">
            <label class="extension-selection-control">
              <input
                type="checkbox"
                :checked="isAllVisibleMarketSelected"
                :disabled="isLoadingExtensions || selectableVisibleMarketItems.length === 0"
                @change="toggleVisibleMarketSelection(($event.target as HTMLInputElement).checked)"
              />
              <span>选择当前</span>
            </label>
            <span>已选 {{ selectedMarketBatchCount }} 个</span>
            <span v-if="selectableVisibleMarketItems.length === 0" class="extension-selection-hint">当前列表没有可操作项</span>
            <button
              v-if="selectedMarketItems.length > 0 || selectedMarketInstalledTools.length === 0"
              type="button"
              class="extension-secondary-button"
              :disabled="isLoadingExtensions || selectedMarketItems.length === 0"
              @click="installSelectedMarketItems"
            >
              安装/更新选中
            </button>
            <button
              v-if="selectedMarketInstalledTools.length > 0"
              type="button"
              class="extension-text-danger-button"
              :disabled="isLoadingExtensions"
              @click="uninstallSelectedMarketItems"
            >
              卸载选中
            </button>
          </div>

          <p v-if="marketError" class="extension-empty-state">{{ marketError }}</p>

          <div
            v-for="item in visibleMarketItems"
            :key="item.pluginId"
            role="button"
            tabindex="0"
            class="extension-row"
            :class="{ active: selectedMarketItem?.pluginId === item.pluginId, selected: isMarketItemSelected(item) }"
            @click="selectedMarketId = item.pluginId"
            @keydown.enter.prevent="selectedMarketId = item.pluginId"
            @keydown.space.prevent="selectedMarketId = item.pluginId"
          >
            <label v-if="isMarketItemBatchSelectable(item)" class="extension-row-check" @click.stop>
              <input
                type="checkbox"
                :checked="isMarketItemSelected(item)"
                :disabled="isLoadingExtensions"
                :aria-label="`选择 ${item.label}`"
                @change="updateMarketSelection(item, ($event.target as HTMLInputElement).checked)"
              />
            </label>
            <span v-else class="extension-row-check-placeholder" aria-hidden="true"></span>
            <ToolIcon :accent="item.accent" :icon="item.icon" size="sm" />
            <span class="extension-row-main">
              <span class="extension-row-title">
                <strong>{{ item.label }}</strong>
                <em :class="{ 'update-available': getMarketItemInstallState(item) === 'update' }">
                  {{ getMarketItemStatusLabel(item) }}
                </em>
              </span>
              <span class="extension-row-caption">{{ item.caption }}</span>
              <span class="extension-row-meta">
                <span>{{ item.defaultAlias }}</span>
                <span v-if="isMarketItemInstalled(item) && isMarketItemUpdateAvailable(item)">
                  v{{ getInstalledPluginVersion(item.pluginId) }} → v{{ item.version }}
                </span>
                <span v-else>v{{ item.version }}</span>
                <span>{{ item.category }}</span>
              </span>
            </span>
          </div>

          <p v-if="!marketError && visibleMarketItems.length === 0" class="extension-empty-state">暂无可显示扩展</p>
        </template>

        <template v-else>
          <div class="extension-selection-bar">
            <label class="extension-selection-control">
              <input
                type="checkbox"
                :checked="isAllVisibleInstalledSelected"
                :disabled="isLoadingExtensions || selectableVisibleInstalledTools.length === 0"
                @change="toggleVisibleInstalledSelection(($event.target as HTMLInputElement).checked)"
              />
              <span>选择当前</span>
            </label>
            <span>已选 {{ selectedInstalledTools.length }} 个</span>
            <span v-if="selectableVisibleInstalledTools.length === 0" class="extension-selection-hint">当前列表没有可卸载插件</span>
            <button
              type="button"
              class="extension-text-danger-button"
              :disabled="isLoadingExtensions || selectedInstalledTools.length === 0"
              @click="uninstallSelectedInstalledTools"
            >
              卸载选中
            </button>
          </div>

          <div
            v-for="tool in activeInstalledList"
            :key="tool.key"
            role="button"
            tabindex="0"
            class="extension-row"
            :class="{ active: selectedTool?.key === tool.key, selected: isInstalledToolSelected(tool), disabled: isToolDisabled(tool) }"
            @click="selectedInstalledKey = tool.key"
            @keydown.enter.prevent="selectedInstalledKey = tool.key"
            @keydown.space.prevent="selectedInstalledKey = tool.key"
          >
            <label v-if="isInstalledToolSelectable(tool)" class="extension-row-check" @click.stop>
              <input
                type="checkbox"
                :checked="isInstalledToolSelected(tool)"
                :disabled="isLoadingExtensions"
                :aria-label="`选择 ${tool.label}`"
                @change="updateInstalledSelection(tool, ($event.target as HTMLInputElement).checked)"
              />
            </label>
            <label v-else class="extension-row-check readonly" @click.stop>
              <input
                type="checkbox"
                disabled
                :aria-label="`${tool.label} 不可选择`"
              />
            </label>
            <ToolIcon :accent="tool.accent" :icon="tool.icon" size="sm" />
            <span class="extension-row-main">
              <span class="extension-row-title">
                <strong>{{ tool.label }}</strong>
                <em :class="{ 'update-available': isToolUpdateAvailable(tool) }">
                  {{ isToolUpdateAvailable(tool) ? '有更新' : isToolDisabled(tool) ? '已停用' : '已启用' }}
                </em>
              </span>
              <span class="extension-row-caption">{{ tool.caption }}</span>
              <span class="extension-row-meta">
                <span>{{ tool.defaultAlias ?? tool.key }}</span>
                <span v-if="tool.source === 'plugin'">v{{ tool.manifestVersion }}</span>
                <span v-if="formatToolAliases(tool) !== '无'">自定义 {{ formatToolAliases(tool) }}</span>
                <span>{{ tool.category }}</span>
              </span>
            </span>
          </div>

          <p v-if="activeInstalledList.length === 0" class="extension-empty-state">暂无匹配扩展</p>
        </template>
      </section>

      <aside :key="selectedDetailKey" ref="detailPanelRef" class="extension-detail-panel" aria-label="扩展详情">
        <template v-if="activeTab === 'market' && selectedMarketItem">
          <header class="extension-detail-head">
            <ToolIcon :accent="selectedMarketItem.accent" :icon="selectedMarketItem.icon" />
            <div>
              <h3>{{ selectedMarketItem.label }}</h3>
              <p>{{ selectedMarketItem.caption }}</p>
            </div>
          </header>

          <div class="extension-detail-status">
            <span
              :class="{
                disabled: getMarketItemInstallState(selectedMarketItem) === 'available',
                'update-available': getMarketItemInstallState(selectedMarketItem) === 'update'
              }"
            >
              {{ formatMarketInstallStatus(selectedMarketItem) }}
            </span>
            <span>扩展市场</span>
            <span>{{ formatMarketTrust(selectedMarketItem) }}</span>
          </div>

          <section class="extension-detail-section">
            <h4>功能</h4>
            <ul class="extension-detail-points">
              <li v-for="item in marketFeatureItems" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section class="extension-detail-section">
            <h4>使用</h4>
            <ol class="extension-detail-steps">
              <li v-for="item in marketUsageItems" :key="item">{{ item }}</li>
            </ol>
          </section>

          <details class="extension-detail-disclosure" open>
            <summary>命令与搜索词</summary>
            <dl class="extension-detail-list">
              <div>
                <dt>默认指令</dt>
                <dd>{{ selectedMarketItem.defaultAlias }}</dd>
              </div>
              <div>
                <dt>搜索词</dt>
                <dd>{{ selectedMarketItem.keywords.length ? selectedMarketItem.keywords.join(' / ') : '无' }}</dd>
              </div>
            </dl>
          </details>

          <details class="extension-detail-disclosure">
            <summary>版本与权限</summary>
            <dl class="extension-detail-list">
              <div v-for="row in marketDetailRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd>{{ formatMarketPermissions(selectedMarketItem) }}</dd>
              </div>
            </dl>
          </details>

          <footer class="extension-detail-actions">
            <button
              v-if="isMarketItemInstalled(selectedMarketItem)"
              type="button"
              class="extension-text-danger-button"
              :disabled="isLoadingExtensions"
              @click="uninstallMarketItem(selectedMarketItem)"
            >
              卸载
            </button>
            <button
              v-if="getMarketItemInstallState(selectedMarketItem) !== 'installed'"
              type="button"
              class="extension-primary-button"
              :disabled="isLoadingExtensions"
              @click="installMarketItem(selectedMarketItem)"
            >
              {{ getMarketItemActionLabel(selectedMarketItem) }}
            </button>
          </footer>
        </template>

        <template v-else-if="selectedTool">
          <header class="extension-detail-head">
            <ToolIcon :accent="selectedTool.accent" :icon="selectedTool.icon" />
            <div>
              <h3>{{ selectedTool.label }}</h3>
              <p>{{ selectedTool.caption }}</p>
            </div>
          </header>

          <div class="extension-detail-status">
            <span :class="{ disabled: isToolDisabled(selectedTool) }">
              {{ isToolDisabled(selectedTool) ? '已停用' : '已启用' }}
            </span>
            <label class="extension-toggle">
              <input
                type="checkbox"
                :checked="!isToolDisabled(selectedTool)"
                @change="updateToolEnabled(selectedTool, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ isToolDisabled(selectedTool) ? '停用' : '启用' }}</span>
            </label>
          </div>

          <section class="extension-detail-section">
            <h4>功能</h4>
            <ul class="extension-detail-points">
              <li v-for="item in toolFeatureItems" :key="item">{{ item }}</li>
            </ul>
          </section>

          <section class="extension-detail-section">
            <h4>使用</h4>
            <ol class="extension-detail-steps">
              <li v-for="item in toolUsageItems" :key="item">{{ item }}</li>
            </ol>
          </section>

          <section class="extension-alias-editor" aria-label="自定义别名">
            <div class="extension-alias-editor-head">
              <div>
                <strong>自定义别名</strong>
                <input
                  v-if="isEditingAlias"
                  ref="aliasInputRef"
                  v-model="aliasDraft"
                  type="text"
                  placeholder="输入别名，用空格、逗号或斜杠分隔"
                  @keydown.esc.prevent="cancelEditToolAliases(selectedTool)"
                  @keydown.enter.prevent="saveToolAliases(selectedTool)"
                />
                <span v-else>{{ formatToolAliases(selectedTool) }}</span>
              </div>
              <button
                v-if="!isEditingAlias"
                type="button"
                class="extension-icon-button"
                title="编辑自定义别名"
                aria-label="编辑自定义别名"
                @click="startEditToolAliases(selectedTool)"
              >
                <AppIcon name="edit" />
              </button>
              <button
                v-if="isEditingAlias"
                type="button"
                class="extension-icon-button primary"
                title="保存"
                aria-label="保存"
                @click="saveToolAliases(selectedTool)"
              >
                <AppIcon name="check" />
              </button>
              <button
                v-if="isEditingAlias"
                type="button"
                class="extension-icon-button"
                title="取消"
                aria-label="取消"
                @click="cancelEditToolAliases(selectedTool)"
              >
                <AppIcon name="close" />
              </button>
            </div>
            <p v-if="aliasStatus" class="extension-alias-status">{{ aliasStatus }}</p>
          </section>

          <details class="extension-detail-disclosure">
            <summary>命令、版本与权限</summary>
            <dl class="extension-detail-list">
              <div v-for="row in detailRows" :key="row.label">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </details>

          <footer class="extension-detail-actions">
            <button
              v-if="selectedTool.source === 'plugin'"
              type="button"
              class="extension-text-danger-button push-left"
              @click="uninstallTool(selectedTool)"
            >
              卸载
            </button>
            <button
              v-if="isSelectedToolUpdateAvailable && selectedToolMarketItem"
              type="button"
              class="extension-primary-button"
              :disabled="isLoadingExtensions"
              @click="installMarketItem(selectedToolMarketItem)"
            >
              更新到 v{{ selectedToolMarketItem.version }}
            </button>
            <button type="button" class="extension-primary-button" :disabled="isToolDisabled(selectedTool)" @click="openTool(selectedTool)">
              打开
            </button>
          </footer>
        </template>

        <p v-else class="extension-empty-state">请选择一个扩展查看详情</p>
      </aside>
    </main>
  </section>
</template>

<style scoped>
:global(.workspace:has(.extension-center)) {
  overflow: hidden;
}

:global(.workspace:has(.extension-center) .workspace-content) {
  box-sizing: border-box;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.extension-center {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.extension-toolbar,
.extension-scopebar,
.extension-tabs,
.extension-filter-row,
.extension-actions,
.extension-row-title,
.extension-row-meta,
.extension-detail-head,
.extension-detail-status,
.extension-detail-actions,
.extension-alias-editor-head,
.extension-toggle {
  align-items: center;
  display: flex;
}

.extension-toolbar {
  gap: 12px;
}

.extension-title-block {
  min-width: 144px;
}

.extension-title-block h2,
.extension-detail-head h3 {
  color: var(--text-main);
  margin: 0;
}

.extension-title-block h2 {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0;
}

.extension-title-block p,
.extension-detail-head p {
  color: var(--text-muted);
  font-size: 12px;
  margin: 4px 0 0;
}

.extension-update-hint {
  color: #c2410c;
  font-weight: 600;
}

.extension-search {
  align-items: center;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  display: flex;
  flex: 1;
  gap: 8px;
  height: 36px;
  min-width: 220px;
  padding: 0 10px;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.extension-search:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.12);
}

.extension-search .app-icon {
  color: var(--text-muted);
  height: 16px;
  width: 16px;
}

.extension-search input {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  color: var(--text-main);
  flex: 1;
  height: 100%;
  min-width: 0;
  outline: 0;
  padding: 0;
}

.extension-search input:focus,
.extension-search input:focus-visible {
  box-shadow: none;
  outline: 0;
}

.extension-search input::-webkit-search-cancel-button,
.extension-search input::-webkit-search-decoration,
.extension-search input::-webkit-search-results-button,
.extension-search input::-webkit-search-results-decoration {
  appearance: none;
  display: none;
}

.extension-actions,
.extension-tabs,
.extension-filter-row,
.extension-detail-actions {
  gap: 8px;
}

.extension-detail-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-top: auto;
}

.extension-selection-bar {
  align-items: center;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--panel-border);
  color: var(--text-muted);
  display: flex;
  font-size: 12px;
  gap: 10px;
  min-height: 44px;
  padding: 7px 14px;
  position: sticky;
  top: 0;
  z-index: 2;
}

.extension-selection-bar > button {
  margin-left: auto;
}

.extension-selection-hint {
  color: var(--text-muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-selection-control,
.extension-row-check,
.extension-row-check-placeholder {
  align-items: center;
  display: inline-flex;
}

.extension-selection-control {
  color: var(--text-main);
  gap: 6px;
  font-weight: 600;
  white-space: nowrap;
}

.extension-selection-control input,
.extension-row-check input {
  accent-color: var(--brand);
  cursor: pointer;
  height: 15px;
  width: 15px;
}

.extension-selection-control input:disabled,
.extension-row-check input:disabled {
  cursor: not-allowed;
}

.extension-scopebar {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  padding: 6px;
}

.extension-tabs,
.extension-filter-row {
  border-radius: 6px;
  flex-wrap: wrap;
  padding: 0;
  width: auto;
}

.extension-tabs button,
.extension-filter-row button,
.extension-primary-button,
.extension-secondary-button,
.extension-danger-button,
.extension-text-danger-button,
.extension-icon-button {
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  height: 30px;
  padding: 0 12px;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.extension-tabs button,
.extension-filter-row button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  gap: 6px;
  white-space: nowrap;
}

.extension-tabs button:hover,
.extension-filter-row button:hover {
  background: rgba(37, 99, 235, 0.06);
  color: var(--text-main);
}

.extension-tabs button.active,
.extension-filter-row button.active {
  background: var(--panel-bg);
  border-color: rgba(37, 99, 235, 0.22);
  color: var(--text-main);
}

.extension-tabs span {
  color: inherit;
  opacity: 0.72;
}

.extension-tab-update-badge,
.extension-filter-update-count {
  background: #ea580c;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  min-width: 16px;
  opacity: 1;
  padding: 2px 5px;
  text-align: center;
}

.extension-workspace {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) minmax(380px, 440px);
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.extension-list-panel,
.extension-detail-panel {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  min-height: 0;
}

.extension-list-panel {
  overflow: hidden auto;
}

.extension-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow: hidden auto;
  padding: 16px;
}

.extension-row {
  align-items: center;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--panel-border);
  color: var(--text-main);
  cursor: pointer;
  display: grid;
  gap: 12px;
  grid-template-columns: 18px 34px minmax(0, 1fr);
  min-height: 70px;
  padding: 10px 14px;
  text-align: left;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
  width: 100%;
}

.extension-row:hover {
  background: rgba(37, 99, 235, 0.06);
}

.extension-row.selected {
  background: rgba(37, 99, 235, 0.08);
}

.extension-row.active {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.1), transparent 88%);
  box-shadow: inset 3px 0 0 var(--brand);
}

.extension-row.active.selected {
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.16), rgba(37, 99, 235, 0.06) 88%);
}

.extension-row.disabled {
  opacity: 0.72;
}

.extension-row-check,
.extension-row-check-placeholder {
  cursor: pointer;
  justify-content: center;
}

.extension-row-check-placeholder {
  cursor: default;
  height: 15px;
  width: 15px;
}

.extension-row-check.readonly {
  cursor: not-allowed;
  opacity: 0.62;
}

.extension-row-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.extension-row-title {
  gap: 8px;
  min-width: 0;
}

.extension-row-title strong {
  font-size: 14px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-row-title em,
.extension-detail-status > span {
  background: var(--brand-soft);
  border: 1px solid rgba(37, 99, 235, 0.18);
  border-radius: 999px;
  color: var(--brand);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  padding: 2px 7px;
}

.extension-row-title em.update-available,
.extension-detail-status > span.update-available {
  background: rgba(234, 88, 12, 0.12);
  border-color: rgba(234, 88, 12, 0.24);
  color: #c2410c;
}

.extension-detail-status > span.disabled {
  background: rgba(148, 163, 184, 0.16);
  border-color: rgba(148, 163, 184, 0.22);
  color: var(--text-muted);
}

.extension-row-caption {
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-row-meta {
  color: var(--text-muted);
  flex-wrap: wrap;
  font-size: 11px;
  gap: 6px;
}

.extension-row-meta span {
  background: var(--panel-soft);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  padding: 1px 7px;
}

.extension-action-message,
.extension-empty-state {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  margin: 0;
  padding: 12px;
}

.extension-action-message p {
  margin: 0;
}

.extension-action-details {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 8px;
}

.extension-action-details summary {
  color: var(--brand);
  cursor: pointer;
  font-weight: 600;
}

.extension-action-details ul {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding-left: 18px;
}

.extension-action-details li {
  overflow-wrap: anywhere;
}

.extension-empty-state {
  border-style: dashed;
  text-align: center;
}

.extension-detail-head {
  gap: 12px;
  min-width: 0;
  padding-bottom: 2px;
}

.extension-detail-head > div {
  min-width: 0;
}

.extension-detail-status {
  border-bottom: 1px solid var(--panel-border);
  border-top: 1px solid var(--panel-border);
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-start;
  padding: 10px 0;
}

.extension-toggle {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  gap: 6px;
}

.extension-detail-list {
  display: grid;
  gap: 7px;
  margin: 0;
}

.extension-detail-list div {
  display: grid;
  gap: 10px;
  grid-template-columns: 76px minmax(0, 1fr);
}

.extension-detail-list dt {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.extension-detail-list dd {
  color: var(--text-main);
  font-size: 13px;
  font-weight: 500;
  margin: 0;
  overflow-wrap: anywhere;
}

.extension-detail-section,
.extension-detail-disclosure {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  display: grid;
  gap: 10px;
  padding: 12px;
}

.extension-detail-section h4,
.extension-detail-disclosure summary {
  color: var(--text-main);
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}

.extension-detail-disclosure summary {
  cursor: pointer;
}

.extension-detail-disclosure .extension-detail-list {
  margin-top: 10px;
}

.extension-detail-points,
.extension-detail-steps {
  color: var(--text-main);
  display: grid;
  font-size: 13px;
  gap: 7px;
  line-height: 1.55;
  margin: 0;
  padding-left: 18px;
}

.extension-detail-points li,
.extension-detail-steps li {
  padding-left: 2px;
}

.extension-alias-editor {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 12px;
}

.extension-alias-editor-head {
  gap: 10px;
  justify-content: space-between;
}

.extension-alias-editor-head > div {
  align-items: baseline;
  display: grid;
  gap: 10px;
  grid-template-columns: 76px minmax(0, 1fr);
  min-width: 0;
}

.extension-alias-editor-head strong {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.extension-alias-editor-head span,
.extension-alias-status {
  color: var(--text-muted);
  font-size: 12px;
}

.extension-alias-editor-head span {
  color: var(--text-main);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.extension-alias-editor-head input {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  color: var(--text-main);
  font-size: 13px;
  height: 28px;
  min-width: 0;
  outline: 0;
  padding: 0 8px;
  width: 100%;
}

.extension-alias-editor-head input:focus,
.extension-alias-editor-head input:focus-visible {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.12);
}

.extension-alias-status {
  margin: 0;
  padding-left: 86px;
}

.extension-icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  display: inline-flex;
  flex-shrink: 0;
  height: 28px;
  justify-content: center;
  padding: 0;
  width: 28px;
}

.extension-icon-button:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.18);
  color: var(--brand);
}

.extension-icon-button.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}

.extension-icon-button.primary:hover:not(:disabled) {
  filter: brightness(0.96);
}

.extension-icon-button .app-icon {
  height: 15px;
  width: 15px;
}

.extension-primary-button {
  background: var(--brand);
  border: 1px solid var(--brand);
  color: #ffffff;
}

.extension-primary-button:hover:not(:disabled) {
  filter: brightness(0.96);
}

.extension-primary-button:disabled,
.extension-secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.extension-secondary-button {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  color: var(--text-main);
}

.extension-secondary-button:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.35);
  color: var(--brand);
}

.extension-danger-button {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.22);
  color: #b91c1c;
}

.extension-danger-button:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.12);
  border-color: rgba(220, 38, 38, 0.34);
}

.extension-text-danger-button {
  background: rgba(220, 38, 38, 0.06);
  border: 1px solid rgba(220, 38, 38, 0.16);
  color: #b91c1c;
  min-width: 52px;
  padding: 0 10px;
}

.extension-text-danger-button.push-left {
  margin-right: auto;
}

.extension-text-danger-button:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.1);
  border-color: rgba(220, 38, 38, 0.28);
}

@media (max-width: 1180px) {
  .extension-workspace {
    grid-template-columns: minmax(360px, 1fr) minmax(340px, 400px);
  }
}

@media (max-width: 980px) {
  .extension-toolbar {
    align-items: stretch;
    display: grid;
  }

  .extension-actions {
    justify-content: flex-end;
  }

  .extension-workspace {
    grid-template-columns: 1fr;
  }

  .extension-detail-panel {
    min-height: 320px;
  }
}
</style>
