import { onMounted, ref } from 'vue';
import type { ExtensionMarketItem } from '../types/toolbox';

const marketItems = ref<ExtensionMarketItem[]>([]);
const isLoadingMarketItems = ref(false);
const marketError = ref('');

function hasUrlProtocol(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:');
}

function hasImageExtension(value: string) {
  return /\.(?:svg|png|webp|jpe?g|ico)(?:[?#].*)?$/i.test(value);
}

function normalizeMarketIcon(value?: string) {
  const icon = String(value ?? '').trim();

  if (!icon) {
    return 'toolbox';
  }

  if (hasUrlProtocol(icon)) {
    return icon;
  }

  return hasImageExtension(icon) ? 'toolbox' : icon;
}

function normalizeMarketItem(item: TooldeskPluginMarketItem): ExtensionMarketItem | null {
  if (!item.pluginId || !item.label || !item.version || !item.downloadUrl || !item.sha256) {
    return null;
  }

  return {
    accent: item.accent || 'blue',
    caption: item.caption || item.label,
    category: (item.category || 'dev') as ExtensionMarketItem['category'],
    defaultAlias: item.defaultAlias || item.pluginId,
    downloadUrl: item.downloadUrl,
    icon: normalizeMarketIcon(item.icon),
    keywords: item.keywords ?? [],
    label: item.label,
    manifestUrl: item.manifestUrl,
    permissions: item.permissions ?? [],
    pluginId: item.pluginId,
    publisher: item.publisher || 'tooldesk',
    sha256: item.sha256,
    signature: item.signature,
    signatureUrl: item.signatureUrl,
    trusted: Boolean(item.trusted),
    trustLevel: item.trustLevel === 'official' || item.trustLevel === 'verified' ? item.trustLevel : 'community',
    updatedAt: item.updatedAt,
    version: item.version,
    windowIcon: item.windowIcon
  };
}

async function loadRemoteMarketItems() {
  if (!window.tooldeskShortcut?.listPluginMarket) {
    throw new Error('Plugin market API is unavailable.');
  }

  const catalog = await window.tooldeskShortcut.listPluginMarket();

  if (catalog.error) {
    throw new Error(catalog.error);
  }

  return catalog.items
    .map(normalizeMarketItem)
    .filter((item): item is ExtensionMarketItem => Boolean(item));
}

export function useExtensionMarket() {
  async function refreshMarketItems() {
    isLoadingMarketItems.value = true;
    marketError.value = '';

    try {
      marketItems.value = await loadRemoteMarketItems();
    } catch (error) {
      marketError.value = error instanceof Error ? error.message : '扩展市场加载失败';
      marketItems.value = [];
    } finally {
      isLoadingMarketItems.value = false;
    }
  }

  onMounted(() => {
    void refreshMarketItems();
  });

  return {
    isLoadingMarketItems,
    marketError,
    marketItems,
    refreshMarketItems
  };
}
