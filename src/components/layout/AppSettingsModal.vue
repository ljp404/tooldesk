<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import {
  BAIDU_OCR_API_VARIANT_ORDER,
  BAIDU_OCR_PROVIDER_ORDER,
  getBaiduOcrApiVariantLabel,
  getOcrConfigSourceLabel,
  getBaiduOcrProviderLabel,
  type BaiduOcrApiVariant,
  type BaiduOcrProvider,
  type BaiduOcrSettings,
  type OcrConfigStatus
} from '../../types/baiduOcr';
import {
  getDefaultTranslateSettings,
  getTranslateConfigSourceLabel,
  getTranslateProviderLabel,
  TRANSLATE_PROVIDER_ORDER,
  type TranslateConfigStatus,
  type TranslateProvider,
  type TranslateSettings
} from '../../types/translate';
import {
  GLOBAL_SHORTCUT_DEFINITIONS,
  getGlobalShortcutDefinition,
  getDefaultGlobalShortcutsSettings,
  type GlobalShortcutBinding,
  type GlobalShortcutId,
  type GlobalShortcutsSettings
} from '../../types/globalShortcuts';
import type { ToolItem } from '../../types/toolbox';
import PluginToolHost from '../toolbox/PluginToolHost.vue';

type BuiltinSettingsSection = 'general' | 'shortcut' | 'screenshot' | 'translate' | 'superClipboard' | 'sync' | 'about';
type PluginSettingsSection = `plugin-settings:${string}`;
type SettingsSection = BuiltinSettingsSection | PluginSettingsSection;

interface SuperClipboardSettings {
  enabled: boolean;
  ignoreDuplicates: boolean;
  maxImageBytes: number;
  maxItems: number;
  pollIntervalMs: number;
}

interface ScreenshotSettings {
  autoCopy: boolean;
  enabled: boolean;
  ocrEnabled: boolean;
  saveToFile: boolean;
}

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

type StorageStatus = {
  message: string;
  type: 'success' | 'error' | 'info';
};

type StorageDirectoryKind = 'cache' | 'data';

interface StorageDirectoryItem {
  configuredPath: string;
  currentPath: string;
  defaultPath: string;
  pendingPath: string;
  requiresRestart: boolean;
}

interface StorageDirectoryConfig {
  cache: StorageDirectoryItem;
  configPath: string;
  data: StorageDirectoryItem;
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
  const qiniu = value?.qiniu ?? DEFAULT_MUSIC_CLOUD_SETTINGS.qiniu;

  return {
    provider: value?.provider === 'qiniu' ? 'qiniu' : 'none',
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

function toPlainMusicCloudSettings(value: MusicCloudSettings): MusicCloudSettings {
  return {
    provider: value.provider === 'qiniu' ? 'qiniu' : 'none',
    qiniu: {
      accessKey: value.qiniu.accessKey,
      bucket: value.qiniu.bucket,
      domain: value.qiniu.domain,
      prefix: value.qiniu.prefix,
      region: value.qiniu.region,
      secretKey: value.qiniu.secretKey
    }
  };
}

type SyncClassification = 'local' | 'sensitive' | 'syncable';

interface SyncManifestItem {
  classification: SyncClassification;
  description: string;
  exists: boolean;
  id: string;
  label: string;
  relativePath?: string;
  size: number;
  updatedAt?: string;
}

interface PluginLocalStorageSyncItem {
  localStorage: Record<string, unknown>;
  schemaVersion: 1;
  updatedAt?: string;
}

const PLUGIN_SYNC_META_KEY = 'tooldesk-plugin-sync-meta';
const CORE_SYNC_META_KEY = 'tooldesk-core-sync-meta';

const props = defineProps<{
  baiduOcrSettings: BaiduOcrSettings;
  closeToTray: boolean;
  globalShortcutsSettings: GlobalShortcutsSettings;
  musicCloudSettings: MusicCloudSettings;
  ocrConfigStatus: OcrConfigStatus;
  pluginAutoUpdateEnabled: boolean;
  screenshotSettings: ScreenshotSettings;
  superClipboardSettings: SuperClipboardSettings;
  syncCloudSettings: SyncCloudSettings;
  shortcutSupported: boolean;
  tools: ToolItem[];
  translateConfigStatus: TranslateConfigStatus;
  translateSettings: TranslateSettings;
}>();

const emit = defineEmits<{
  appSettingsSynced: [
    settings: {
      baiduOcr: BaiduOcrSettings;
      closeToTray: boolean;
      globalShortcuts: GlobalShortcutsSettings;
      keepass: TooldeskKeePassSettings;
      localLibrary: TooldeskLocalLibrarySettings;
      musicCloud: MusicCloudSettings;
      ocrConfigStatus: OcrConfigStatus;
      pluginAutoUpdateEnabled: boolean;
      screenshot: ScreenshotSettings;
      superClipboard: SuperClipboardSettings;
      syncCloud: SyncCloudSettings;
      translate: TranslateSettings;
      translateConfigStatus: TranslateConfigStatus;
    }
  ];
  close: [];
  updateCloseToTray: [value: boolean];
  updateBaiduOcrSettings: [value: Partial<BaiduOcrSettings>];
  updateGlobalShortcutsSettings: [value: GlobalShortcutsSettings];
  updatePluginAutoUpdateEnabled: [value: boolean];
  updateScreenshotSettings: [value: Partial<ScreenshotSettings>];
  updateSuperClipboardSettings: [value: Partial<SuperClipboardSettings>];
  updateTranslateSettings: [value: Partial<TranslateSettings>];
}>();

function cloneTranslateSettings(value: TranslateSettings) {
  const defaults = getDefaultTranslateSettings();

  try {
    return structuredClone(value);
  } catch {
    return {
      ...defaults,
      ...value,
      aliyun: { ...defaults.aliyun, ...(value.aliyun ?? {}) },
      baidu: { ...defaults.baidu, ...(value.baidu ?? {}) },
      tencent: { ...defaults.tencent, ...(value.tencent ?? {}) }
    };
  }
}

const activeSection = ref<SettingsSection>('general');
const bindingsDraft = ref<GlobalShortcutBinding[]>(
  props.globalShortcutsSettings.bindings.map((binding) => ({ ...binding }))
);
const screenshotDraft = ref({ ...props.screenshotSettings });
const baiduOcrDraft = ref({ ...props.baiduOcrSettings });
const translateDraft = ref(cloneTranslateSettings(props.translateSettings));
const superClipboardDraft = ref({ ...props.superClipboardSettings });
const recordingBindingId = ref<GlobalShortcutId | null>(null);
const appVersion = ref('');
const updateStatus = ref('');
const isCheckingUpdate = ref(false);
const isValidatingOcr = ref(false);
const isValidatingTranslate = ref(false);
const isLoadingSyncManifest = ref(false);
const musicCloudDraft = ref<MusicCloudSettings>(normalizeMusicCloudSettings(props.musicCloudSettings));
const syncLoginNameDraft = ref(props.syncCloudSettings.loginName);
const syncPasswordDraft = ref(props.syncCloudSettings.syncPassword);
const syncManifest = ref<SyncManifestItem[]>([]);
const pluginSyncManifestItems = ref<SyncManifestItem[]>([]);
const syncStatus = ref<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
const musicCloudStatus = ref<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
const ocrValidationStatus = ref<{ type: 'success' | 'error'; message: string } | null>(null);
const translateValidationStatus = ref<{ type: 'success' | 'error'; message: string } | null>(null);
const storageDirectories = ref<StorageDirectoryConfig | null>(null);
const storageStatus = ref<StorageStatus | null>(null);
const choosingStorageKind = ref<StorageDirectoryKind | null>(null);
const isClearingCache = ref(false);
const pluginSettingsTools = computed(() =>
  props.tools.filter((tool) => tool.source === 'plugin' && tool.pluginId && tool.settings?.entryUrl)
);
const activePluginSettingsTool = computed(() => {
  if (!activeSection.value.startsWith('plugin-settings:')) {
    return null;
  }

  const pluginId = activeSection.value.slice('plugin-settings:'.length);
  return pluginSettingsTools.value.find((tool) => tool.pluginId === pluginId) ?? null;
});
const activePluginSettingsHostTool = computed<ToolItem | null>(() => {
  const tool = activePluginSettingsTool.value;

  if (!tool?.settings) {
    return null;
  }

  return {
    ...tool,
    accent: tool.settings.accent,
    entryUrl: tool.settings.entryUrl,
    icon: tool.settings.icon,
    label: tool.settings.label
  };
});
const syncCloudLastSyncedLabel = computed(() => {
  const value = props.syncCloudSettings.lastSyncedAt;

  if (!value) {
    return '最近同步：从未';
  }

  return `最近同步：${formatSyncDate(value)}`;
});
const dataDirectoryItem = computed(() => storageDirectories.value?.data ?? null);
const cacheDirectoryItem = computed(() => storageDirectories.value?.cache ?? null);
const isDataDirectoryCustom = computed(() => Boolean(dataDirectoryItem.value?.configuredPath));
const isCacheDirectoryCustom = computed(() => Boolean(cacheDirectoryItem.value?.configuredPath));

watch(
  () => props.syncCloudSettings,
  (value) => {
    syncLoginNameDraft.value = value.loginName;
    syncPasswordDraft.value = value.syncPassword;
  },
  { deep: true }
);

watch(
  () => props.musicCloudSettings,
  (value) => {
    musicCloudDraft.value = normalizeMusicCloudSettings(value);
  },
  { deep: true }
);

async function updateMusicCloudSettings() {
  if (!window.tooldeskShortcut?.setAppSettings) {
    return;
  }

  const settings = await window.tooldeskShortcut.setAppSettings({
    musicCloud: toPlainMusicCloudSettings(musicCloudDraft.value)
  });
  emit('appSettingsSynced', settings);
}

async function validateMusicCloudSettings() {
  if (!window.tooldeskShortcut?.validateMusicCloudStorage) {
    musicCloudStatus.value = { type: 'error', message: '音乐云存储能力不可用' };
    return;
  }

  try {
    await updateMusicCloudSettings();
    const result = await window.tooldeskShortcut.validateMusicCloudStorage();
    musicCloudStatus.value = {
      type: 'success',
      message: `七牛云配置可用：${result.bucket} / ${result.region}`
    };
  } catch (error) {
    musicCloudStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '音乐云存储配置无效'
    };
  }
}

function formatStorageSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function getStorageDirectoryTitle(kind: StorageDirectoryKind) {
  return kind === 'data' ? '数据目录' : '缓存目录';
}

function getStorageDirectoryDescription(kind: StorageDirectoryKind) {
  return kind === 'data'
    ? '保存设置、超级剪贴板、插件和插件数据。'
    : '保存 Chromium 缓存、音乐缓存和可重新生成的临时文件。';
}

async function loadStorageDirectories() {
  if (!window.tooldeskShortcut?.getStorageDirectories) {
    return;
  }

  try {
    storageDirectories.value = await window.tooldeskShortcut.getStorageDirectories();
  } catch (error) {
    storageStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '读取存储目录失败'
    };
  }
}

function updateStorageStatus(config: StorageDirectoryConfig, message: string) {
  storageDirectories.value = config;
  const requiresRestart = config.data.requiresRestart || config.cache.requiresRestart;

  storageStatus.value = {
    type: requiresRestart ? 'info' : 'success',
    message: requiresRestart ? `${message}，重启后生效。` : message
  };
}

async function chooseStorageDirectory(kind: StorageDirectoryKind) {
  if (!window.tooldeskShortcut?.chooseStorageDirectory || choosingStorageKind.value) {
    return;
  }

  choosingStorageKind.value = kind;

  try {
    const previousPath = storageDirectories.value?.[kind].pendingPath;
    const config = await window.tooldeskShortcut.chooseStorageDirectory(kind);
    storageDirectories.value = config;

    if (config[kind].pendingPath !== previousPath) {
      updateStorageStatus(config, `${getStorageDirectoryTitle(kind)}已更新`);
    }
  } catch (error) {
    storageStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : `${getStorageDirectoryTitle(kind)}选择失败`
    };
  } finally {
    choosingStorageKind.value = null;
  }
}

async function resetStorageDirectory(kind: StorageDirectoryKind) {
  if (!window.tooldeskShortcut?.resetStorageDirectory) {
    return;
  }

  try {
    const config = await window.tooldeskShortcut.resetStorageDirectory(kind);
    updateStorageStatus(config, `${getStorageDirectoryTitle(kind)}已恢复默认`);
  } catch (error) {
    storageStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : `${getStorageDirectoryTitle(kind)}恢复默认失败`
    };
  }
}

async function openStorageDirectory(kind: StorageDirectoryKind) {
  const targetPath = storageDirectories.value?.[kind].currentPath;

  if (!targetPath) {
    return;
  }

  const errorMessage = await window.tooldeskShortcut?.openPath(targetPath);

  if (errorMessage) {
    storageStatus.value = { type: 'error', message: errorMessage };
  }
}

function clearCacheWithConfirm() {
  if (isClearingCache.value) {
    return;
  }

  requestSettingsConfirm({
    confirmLabel: '清理缓存',
    message: '将删除缓存目录中的 Chromium 缓存、音乐缓存和临时文件，不会删除设置、插件或超级剪贴板数据。',
    title: '清理缓存',
    variant: 'danger',
    onConfirm: runClearAppCache
  });
}

async function runClearAppCache() {
  if (!window.tooldeskShortcut?.clearAppCache || isClearingCache.value) {
    return;
  }

  isClearingCache.value = true;

  try {
    const result = await window.tooldeskShortcut.clearAppCache();
    storageStatus.value = {
      type: 'success',
      message: `缓存已清理，释放 ${formatStorageSize(result.bytesFreed)}。`
    };
    void loadStorageDirectories();
  } catch (error) {
    storageStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '清理缓存失败'
    };
  } finally {
    isClearingCache.value = false;
  }
}

function handleClose() {
  emit('close');
}
watch(
  () => pluginSettingsTools.value.map((tool) => tool.pluginId).join('|'),
  () => {
    if (activeSection.value.startsWith('plugin-settings:') && !activePluginSettingsTool.value) {
      activeSection.value = 'general';
    }
  },
  { immediate: true }
);

function getPluginSettingsSection(tool: ToolItem): PluginSettingsSection {
  return `plugin-settings:${tool.pluginId ?? tool.key}`;
}

type SettingsConfirmState = {
  confirmLabel: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  title: string;
  variant: 'danger' | 'primary';
};

const settingsConfirm = ref<SettingsConfirmState | null>(null);
const isSettingsConfirmRunning = ref(false);

function requestSettingsConfirm(state: SettingsConfirmState) {
  settingsConfirm.value = state;
}

function dismissSettingsConfirm() {
  if (isSettingsConfirmRunning.value) {
    return;
  }

  settingsConfirm.value = null;
}

async function acceptSettingsConfirm() {
  const state = settingsConfirm.value;

  if (!state || isSettingsConfirmRunning.value) {
    return;
  }

  isSettingsConfirmRunning.value = true;

  try {
    await state.onConfirm();
    settingsConfirm.value = null;
  } finally {
    isSettingsConfirmRunning.value = false;
  }
}

let stopShortcutRecordedListener: (() => void) | undefined;
let baiduOcrPersistTimer: number | undefined;
let translatePersistTimer: number | undefined;
let isShortcutRecordingKeydownBound = false;

watch(
  () => props.globalShortcutsSettings,
  (value) => {
    bindingsDraft.value = value.bindings.map((binding) => ({ ...binding }));
  },
  { deep: true }
);

watch(
  () => props.screenshotSettings,
  (value) => {
    screenshotDraft.value = { ...value };
  },
  { deep: true }
);

function updateScreenshotDraft(patch: Partial<ScreenshotSettings>) {
  screenshotDraft.value = {
    ...screenshotDraft.value,
    ...patch
  };
  emit('updateScreenshotSettings', patch);
}

watch(
  () => props.baiduOcrSettings,
  (value) => {
    baiduOcrDraft.value = { ...value };
  },
  { deep: true }
);

function updateBaiduOcrDraft(patch: Partial<BaiduOcrSettings>) {
  baiduOcrDraft.value = {
    ...baiduOcrDraft.value,
    ...patch
  };
  ocrValidationStatus.value = null;
  scheduleBaiduOcrPersist();
}

function persistBaiduOcrDraft() {
  emit('updateBaiduOcrSettings', { ...baiduOcrDraft.value });
}

async function persistBaiduOcrDraftNow() {
  if (baiduOcrPersistTimer) {
    window.clearTimeout(baiduOcrPersistTimer);
    baiduOcrPersistTimer = undefined;
  }

  const nextSettings = { ...baiduOcrDraft.value };
  emit('updateBaiduOcrSettings', nextSettings);

  if (window.tooldeskShortcut?.setAppSettings) {
    await window.tooldeskShortcut.setAppSettings({ baiduOcr: nextSettings });
  }
}

function scheduleBaiduOcrPersist() {
  if (baiduOcrPersistTimer) {
    window.clearTimeout(baiduOcrPersistTimer);
  }

  baiduOcrPersistTimer = window.setTimeout(() => {
    baiduOcrPersistTimer = undefined;
    void persistBaiduOcrDraftNow();
  }, 500);
}

function updateBaiduOcrProvider(provider: BaiduOcrProvider) {
  updateBaiduOcrDraft({ provider });
  persistBaiduOcrDraft();
}

function updateBaiduOcrApiVariant(apiVariant: BaiduOcrApiVariant) {
  updateBaiduOcrDraft({ apiVariant });
  persistBaiduOcrDraft();
}

const isOcrEnvLocked = computed(() => props.ocrConfigStatus.source === 'env');
const isTranslateEnvLocked = computed(() => props.translateConfigStatus.source === 'env');

const showOcrConfiguredBanner = computed(() => props.ocrConfigStatus.configured);
const ocrSourceLabel = computed(() => getOcrConfigSourceLabel(props.ocrConfigStatus.source));

const showTranslateConfiguredBanner = computed(() => props.translateConfigStatus.configured);
const translateSourceLabel = computed(() => getTranslateConfigSourceLabel(props.translateConfigStatus.source));

const canClearUserOcrCredentials = computed(() => {
  if (isOcrEnvLocked.value) {
    return false;
  }

  return Boolean(baiduOcrDraft.value.apiKey.trim() || baiduOcrDraft.value.secretKey.trim());
});

const canClearUserTranslateCredentials = computed(() => {
  if (isTranslateEnvLocked.value) {
    return false;
  }

  const draft = translateDraft.value;

  return Boolean(
    draft.baidu.appId.trim() ||
      draft.baidu.secretKey.trim() ||
      draft.tencent.secretId.trim() ||
      draft.tencent.secretKey.trim() ||
      draft.aliyun.accessKeyId.trim() ||
      draft.aliyun.accessKeySecret.trim()
  );
});

const ocrClearDisabledTitle = computed(() => {
  if (!isOcrEnvLocked.value) {
    return '';
  }

  return '当前由环境变量管理，无法在此清除';
});

const translateClearDisabledTitle = computed(() => {
  if (!isTranslateEnvLocked.value) {
    return '';
  }

  return '当前由环境变量管理，无法在此清除';
});

function clearBaiduOcrUserCredentials() {
  if (!canClearUserOcrCredentials.value) {
    return;
  }

  requestSettingsConfirm({
    confirmLabel: '清除',
    message: '将删除本机已保存的百度 OCR 密钥，并立即写入设置。',
    title: '清除本机 OCR 密钥',
    variant: 'danger',
    onConfirm: runClearBaiduOcrUserCredentials
  });
}

async function runClearBaiduOcrUserCredentials() {
  if (baiduOcrPersistTimer) {
    window.clearTimeout(baiduOcrPersistTimer);
    baiduOcrPersistTimer = undefined;
  }

  ocrValidationStatus.value = null;

  if (!window.tooldeskShortcut?.clearUserApiKeys) {
    return;
  }

  const settings = await window.tooldeskShortcut.clearUserApiKeys({ ocr: true, translate: false });
  baiduOcrDraft.value = { ...settings.baiduOcr };
  emit('appSettingsSynced', settings);
}

function clearTranslateUserCredentials() {
  if (!canClearUserTranslateCredentials.value) {
    return;
  }

  requestSettingsConfirm({
    confirmLabel: '清除',
    message: '将删除本机已保存的翻译 API 密钥，并立即写入设置。',
    title: '清除本机翻译密钥',
    variant: 'danger',
    onConfirm: runClearTranslateUserCredentials
  });
}

async function runClearTranslateUserCredentials() {
  if (translatePersistTimer) {
    window.clearTimeout(translatePersistTimer);
    translatePersistTimer = undefined;
  }

  translateValidationStatus.value = null;

  if (!window.tooldeskShortcut?.clearUserApiKeys) {
    return;
  }

  const settings = await window.tooldeskShortcut.clearUserApiKeys({ ocr: false, translate: true });
  translateDraft.value = cloneTranslateSettings(settings.translate);
  emit('appSettingsSynced', settings);
}

watch(
  () => props.translateSettings,
  (value) => {
    translateDraft.value = cloneTranslateSettings(value);
  },
  { deep: true }
);

function updateTranslateDraft(patch: Partial<TranslateSettings>) {
  translateDraft.value = {
    ...translateDraft.value,
    ...patch,
    aliyun: {
      ...translateDraft.value.aliyun,
      ...(patch.aliyun ?? {})
    },
    baidu: {
      ...translateDraft.value.baidu,
      ...(patch.baidu ?? {})
    },
    tencent: {
      ...translateDraft.value.tencent,
      ...(patch.tencent ?? {})
    }
  };
  translateValidationStatus.value = null;
  scheduleTranslatePersist();
}

function updateTranslateProvider(provider: TranslateProvider) {
  updateTranslateDraft({ provider });
  emit('updateTranslateSettings', cloneTranslateSettings(translateDraft.value));
}

function persistTranslateDraft() {
  emit('updateTranslateSettings', cloneTranslateSettings(translateDraft.value));
}

async function persistTranslateDraftNow() {
  if (translatePersistTimer) {
    window.clearTimeout(translatePersistTimer);
    translatePersistTimer = undefined;
  }

  const nextSettings = cloneTranslateSettings(translateDraft.value);
  emit('updateTranslateSettings', nextSettings);

  if (window.tooldeskShortcut?.setAppSettings) {
    await window.tooldeskShortcut.setAppSettings({ translate: nextSettings });
  }
}

function scheduleTranslatePersist() {
  if (translatePersistTimer) {
    window.clearTimeout(translatePersistTimer);
  }

  translatePersistTimer = window.setTimeout(() => {
    translatePersistTimer = undefined;
    void persistTranslateDraftNow();
  }, 500);
}

async function validateBaiduOcrDraft() {
  if (isOcrEnvLocked.value || isValidatingOcr.value) {
    return;
  }

  isValidatingOcr.value = true;
  ocrValidationStatus.value = null;

  try {
    const result = await window.tooldeskShortcut?.validateBaiduOcrSettings({ ...baiduOcrDraft.value });

    if (result?.ok) {
      await persistBaiduOcrDraftNow();
      ocrValidationStatus.value = { type: 'success', message: '验证通过' };
    } else {
      ocrValidationStatus.value = { type: 'error', message: result?.message || '桌面验证能力不可用' };
    }
  } catch (error) {
    ocrValidationStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '验证失败'
    };
  } finally {
    isValidatingOcr.value = false;
  }
}

async function validateTranslateDraft() {
  if (isTranslateEnvLocked.value || isValidatingTranslate.value) {
    return;
  }

  isValidatingTranslate.value = true;
  translateValidationStatus.value = null;

  try {
    const result = await window.tooldeskShortcut?.validateTranslateSettings(cloneTranslateSettings(translateDraft.value));

    if (result?.ok) {
      await persistTranslateDraftNow();
      translateValidationStatus.value = { type: 'success', message: '验证通过' };
    } else {
      translateValidationStatus.value = { type: 'error', message: result?.message || '桌面验证能力不可用' };
    }
  } catch (error) {
    translateValidationStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '验证失败'
    };
  } finally {
    isValidatingTranslate.value = false;
  }
}

watch(
  () => props.superClipboardSettings,
  (value) => {
    superClipboardDraft.value = { ...value };
  },
  { deep: true }
);

function updateSuperClipboardDraft(patch: Partial<SuperClipboardSettings>) {
  superClipboardDraft.value = {
    ...superClipboardDraft.value,
    ...patch
  };
  emit('updateSuperClipboardSettings', patch);
}

function getBindingDraft(id: GlobalShortcutId) {
  return bindingsDraft.value.find((binding) => binding.id === id);
}

function updateBindingDraft(id: GlobalShortcutId, patch: Partial<GlobalShortcutBinding>) {
  bindingsDraft.value = bindingsDraft.value.map((binding) =>
    binding.id === id ? { ...binding, ...patch } : binding
  );
}

function applyRecordedShortcut(id: GlobalShortcutId, accelerator: string) {
  const conflict = bindingsDraft.value.find(
    (binding) => binding.id !== id && binding.enabled && binding.accelerator === accelerator
  );

  if (conflict) {
    const conflictName = GLOBAL_SHORTCUT_DEFINITIONS.find((def) => def.id === conflict.id)?.label || conflict.id;
    alert(`快捷键冲突\n\n${accelerator} 已被"${conflictName}"使用，请设置其他快捷键。`);
    return;
  }

  updateBindingDraft(id, { accelerator });
  stopShortcutRecording();
  saveGlobalShortcuts();
}

function normalizeShortcutKey(event: KeyboardEvent) {
  if (event.code === 'Space') {
    return 'Space';
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.replace('Key', '');
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.replace('Digit', '');
  }

  const keyMap: Record<string, string> = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Escape: 'Escape',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab'
  };

  if (keyMap[event.key]) {
    return keyMap[event.key];
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
    return event.key;
  }

  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }

  return '';
}

function recordShortcutFromKeydown(id: GlobalShortcutId, event: KeyboardEvent) {
  if (event.key === 'Tab') {
    return;
  }

  event.preventDefault();

  const key = normalizeShortcutKey(event);
  const isModifierOnly = ['Alt', 'Control', 'Meta', 'Shift'].includes(event.key);

  if (!key || isModifierOnly) {
    return;
  }

  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : ''
  ].filter(Boolean);

  if (modifiers.length === 0) {
    return;
  }

  const newAccelerator = [...modifiers, key].join('+');
  applyRecordedShortcut(id, newAccelerator);
}

function handleBindingKeydown(id: GlobalShortcutId, event: KeyboardEvent) {
  recordShortcutFromKeydown(id, event);
}

function handleShortcutRecordingWindowKeydown(event: KeyboardEvent) {
  const recordingId = recordingBindingId.value;

  if (!recordingId || event.key === 'Tab') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  recordShortcutFromKeydown(recordingId, event);
}

function bindShortcutRecordingKeydown() {
  if (isShortcutRecordingKeydownBound) {
    return;
  }

  window.addEventListener('keydown', handleShortcutRecordingWindowKeydown, true);
  isShortcutRecordingKeydownBound = true;
}

function unbindShortcutRecordingKeydown() {
  if (!isShortcutRecordingKeydownBound) {
    return;
  }

  window.removeEventListener('keydown', handleShortcutRecordingWindowKeydown, true);
  isShortcutRecordingKeydownBound = false;
}

function startShortcutRecording(id: GlobalShortcutId) {
  if (!props.shortcutSupported || recordingBindingId.value === id) {
    return;
  }

  recordingBindingId.value = id;
  bindShortcutRecordingKeydown();
  void window.tooldeskShortcut?.suspendShortcut();
}

function stopShortcutRecording() {
  if (!recordingBindingId.value) {
    return;
  }

  recordingBindingId.value = null;
  unbindShortcutRecordingKeydown();
  void window.tooldeskShortcut?.resumeShortcut();
}

function saveGlobalShortcuts() {
  if (!props.shortcutSupported) {
    return;
  }

  emit('updateGlobalShortcutsSettings', {
    bindings: bindingsDraft.value.map((binding) => ({ ...binding }))
  });
}

function getShortcutDisplayValue(id: GlobalShortcutId) {
  const binding = getBindingDraft(id);

  if (!binding?.enabled) {
    return '';
  }

  if (recordingBindingId.value === id) {
    return '请按下快捷键';
  }

  return binding.accelerator || getGlobalShortcutDefinition(id)?.defaultAccelerator || '';
}

function enableAndRecordBinding(id: GlobalShortcutId) {
  if (!props.shortcutSupported) {
    return;
  }

  if (id === 'screenshot' && !screenshotDraft.value.enabled) {
    return;
  }

  updateBindingDraft(id, { enabled: true });
  saveGlobalShortcuts();
  startShortcutRecording(id);
}

function clearBindingShortcut(id: GlobalShortcutId) {
  const definition = getGlobalShortcutDefinition(id);

  updateBindingDraft(id, {
    accelerator: definition?.defaultAccelerator ?? '',
    enabled: false
  });
  stopShortcutRecording();
  saveGlobalShortcuts();
}

function restoreDefaultShortcuts() {
  bindingsDraft.value = getDefaultGlobalShortcutsSettings().bindings.map((binding) => ({ ...binding }));
  stopShortcutRecording();
  saveGlobalShortcuts();
}

function isBindingDisabled(id: GlobalShortcutId) {
  if (!props.shortcutSupported) {
    return true;
  }

  if (id === 'screenshot' && !screenshotDraft.value.enabled) {
    return true;
  }

  const binding = getBindingDraft(id);
  return !binding?.enabled;
}

async function checkForUpdates() {
  if (!window.tooldeskShortcut) {
    updateStatus.value = '桌面更新能力不可用';
    return;
  }

  isCheckingUpdate.value = true;
  updateStatus.value = '正在检查更新...';

  try {
    const result = await window.tooldeskShortcut.checkForUpdates();
    if (result.success) {
      updateStatus.value = result.message || (result.hasUpdate ? '发现新版本' : '已是最新版本');
    } else {
      updateStatus.value = result.message || '检查更新失败';
    }
  } catch (error) {
    updateStatus.value = `检查更新失败: ${error instanceof Error ? error.message : '未知错误'}`;
  } finally {
    setTimeout(() => {
      isCheckingUpdate.value = false;
      setTimeout(() => {
        updateStatus.value = '';
      }, 5000);
    }, 2000);
  }
}

function getSyncClassificationLabel(classification: SyncClassification) {
  const labels: Record<SyncClassification, string> = {
    local: '本机数据',
    sensitive: '敏感数据',
    syncable: '可同步'
  };

  return labels[classification];
}

function formatSyncSize(size: number) {
  if (!size) {
    return '-';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatSyncDate(value?: string) {
  if (!value) {
    return '-';
  }

  const normalizedValue = value.trim();
  const date = /^\d+$/.test(normalizedValue)
    ? new Date(Number(normalizedValue))
    : new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('zh-CN', { hour12: false });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function measureJsonStorageValue(value: unknown) {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

async function readPluginStorageValue(key: string) {
  const value = await window.tooldeskShortcut?.getPluginStorageItem?.(key);

  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringifyPluginStorageValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

async function loadPluginSyncManifestItems() {
  const nextItems: SyncManifestItem[] = [];

  for (const tool of getSyncablePluginTools()) {
    let size = 0;
    let exists = false;
    const meta = readPluginSyncMeta()[tool.pluginId ? getPluginSyncItemKey(tool.pluginId) : ''];

    for (const key of tool.sync?.localStorageKeys ?? []) {
      const value = await readPluginStorageValue(key);

      if (value !== undefined) {
        exists = true;
        size += measureJsonStorageValue(value);
      }
    }

    nextItems.push({
      classification: 'syncable',
      description: `${tool.label} 声明的插件本地同步数据。`,
      exists,
      id: `plugin-sync:${tool.pluginId}:localStorage`,
      label: `${tool.label}数据`,
      size,
      updatedAt: meta?.updatedAt ?? ''
    });
  }

  pluginSyncManifestItems.value = nextItems;
}

const displaySyncManifest = computed(() => {
  const coreMeta = readCoreSyncMeta();
  const lastSyncedAt = props.syncCloudSettings.lastSyncedAt ?? '';
  const coreItems = syncManifest.value.map((item) => {
    if (item.updatedAt || (item.id !== 'app-settings' && item.id !== 'installed-plugins')) {
      return item;
    }

    return {
      ...item,
      updatedAt: coreMeta[item.id]?.updatedAt || lastSyncedAt
    };
  });

  return [
    ...coreItems,
    ...pluginSyncManifestItems.value
  ];
});

async function loadSyncManifest(options: { silent?: boolean } = {}) {
  if (!window.tooldeskShortcut?.getSyncManifest || isLoadingSyncManifest.value) {
    if (!options.silent) {
      syncStatus.value = { type: 'error', message: '同步清单能力不可用' };
    }
    return;
  }

  isLoadingSyncManifest.value = true;

  try {
    syncManifest.value = await window.tooldeskShortcut.getSyncManifest();
    await loadPluginSyncManifestItems();
    if (!options.silent) {
      syncStatus.value = { type: 'info', message: '同步清单已刷新' };
    }
  } catch (error) {
    if (!options.silent) {
      syncStatus.value = {
        type: 'error',
        message: error instanceof Error ? error.message : '读取同步清单失败'
      };
    }
  } finally {
    isLoadingSyncManifest.value = false;
  }
}

function syncCloudSnapshot() {
  void runCloudSync();
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

function readCoreSyncMeta() {
  const meta = readLocalStorageJson(CORE_SYNC_META_KEY);
  return meta && typeof meta === 'object' ? meta as Record<string, { hash?: string; updatedAt?: string }> : {};
}

function writePluginSyncMeta(meta: Record<string, { hash?: string; updatedAt?: string }>) {
  localStorage.setItem(PLUGIN_SYNC_META_KEY, JSON.stringify(meta));
}

function getPluginSyncItemKey(pluginId: string) {
  return `plugin:${pluginId}`;
}

function getSyncablePluginTools() {
  return props.tools.filter((tool) =>
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

function normalizePluginSyncItem(value: unknown): PluginLocalStorageSyncItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<PluginLocalStorageSyncItem>;

  if (record.schemaVersion !== 1 || !record.localStorage || typeof record.localStorage !== 'object') {
    return null;
  }

  return {
    localStorage: record.localStorage,
    schemaVersion: 1
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

    const hash = stableStringify(pluginItem.localStorage);
    const meta = readPluginSyncMeta();
    meta[getPluginSyncItemKey(tool.pluginId)] = {
      hash,
      updatedAt: pluginItem.updatedAt ?? new Date().toISOString()
    };
    writePluginSyncMeta(meta);
  }
}

async function runCloudSync() {
  if (!window.tooldeskShortcut?.syncCloudSnapshot) {
    syncStatus.value = { type: 'error', message: '云端同步能力不可用' };
    return;
  }

  const savedLoginName = props.syncCloudSettings.loginName.trim();
  const loginName = syncLoginNameDraft.value.trim() || savedLoginName || window.prompt('请输入手机号或登录名，用于区分你的云端同步空间')?.trim() || '';
  const syncPassword = syncPasswordDraft.value.trim();

  if (!loginName) {
    syncStatus.value = { type: 'info', message: '已取消云端同步' };
    return;
  }

  if (!syncPassword) {
    syncStatus.value = { type: 'error', message: '请先输入同步密码' };
    return;
  }

  syncStatus.value = { type: 'info', message: '正在从云端同步...' };

  try {
    await window.tooldeskShortcut.setAppSettings({
      syncCloud: {
        ...props.syncCloudSettings,
        loginName,
        syncPassword
      }
    });
    const result = await window.tooldeskShortcut.syncCloudSnapshot({
      localItems: await collectPluginSyncItems(),
      loginName,
      syncPassword
    });
    await applyPluginSyncItems(result.clientItems);
    syncStatus.value = { type: 'success', message: `${result.message}：${formatSyncDate(result.lastSyncedAt)}` };
    const settings = await window.tooldeskShortcut.getAppSettings();
    emit('appSettingsSynced', settings);
    void loadSyncManifest({ silent: true });
  } catch (error) {
    syncStatus.value = {
      type: 'error',
      message: getErrorMessage(error, '云端同步失败')
    };
  }
}

async function exportSyncSnapshot() {
  if (!window.tooldeskShortcut?.exportLocalSyncSnapshotToFile) {
    syncStatus.value = { type: 'error', message: '导出同步快照能力不可用' };
    return;
  }

  try {
    const result = await window.tooldeskShortcut.exportLocalSyncSnapshotToFile({
      localItems: await collectPluginSyncItems()
    });

    if (result.canceled) {
      syncStatus.value = { type: 'info', message: '已取消导出同步快照' };
      return;
    }

    syncStatus.value = { type: 'success', message: '同步快照已导出' };
    void loadSyncManifest({ silent: true });
  } catch (error) {
    syncStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '导出同步快照失败'
    };
  }
}

async function importSyncSnapshot() {
  if (!window.tooldeskShortcut?.importLocalSyncSnapshotFromFile) {
    syncStatus.value = { type: 'error', message: '导入同步快照能力不可用' };
    return;
  }

  try {
    const result = await window.tooldeskShortcut.importLocalSyncSnapshotFromFile();

    if (result.canceled || !result.importedAt) {
      syncStatus.value = { type: 'info', message: '已取消导入同步快照' };
      return;
    }

    await applyPluginSyncItems(result.clientItems);
    syncStatus.value = { type: 'success', message: `已导入同步快照：${formatSyncDate(result.importedAt)}` };
    void loadSyncManifest({ silent: true });
  } catch (error) {
    syncStatus.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '导入同步快照失败'
    };
  }
}

onMounted(() => {
  stopShortcutRecordedListener = window.tooldeskShortcut?.onShortcutRecorded((accelerator) => {
    const recordingId = recordingBindingId.value;

    if (recordingId) {
      applyRecordedShortcut(recordingId, accelerator);
    }
  });

  // 获取应用版本
  void window.tooldeskShortcut?.getAppVersion().then((version) => {
    appVersion.value = version;
  });

  void loadStorageDirectories();
  void loadSyncManifest({ silent: true });
});

onBeforeUnmount(() => {
  if (baiduOcrPersistTimer) {
    void persistBaiduOcrDraftNow();
  }
  if (translatePersistTimer) {
    void persistTranslateDraftNow();
  }
  stopShortcutRecordedListener?.();
  stopShortcutRecording();
});
</script>

<template>
  <div class="settings-mask" role="presentation">
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-head">
        <h2 id="settings-title">设置</h2>
        <button class="icon-button" type="button" aria-label="关闭设置" @click="handleClose">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="settings-body">
        <aside class="settings-nav" aria-label="设置菜单">
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'general' }"
            type="button"
            @click="activeSection = 'general'"
          >
            <AppIcon name="settings" />
            常规
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'shortcut' }"
            type="button"
            @click="activeSection = 'shortcut'"
          >
            <AppIcon name="all" />
            快捷键
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'screenshot' }"
            type="button"
            @click="activeSection = 'screenshot'"
          >
            <AppIcon name="screenshot" />
            截图
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'translate' }"
            type="button"
            @click="activeSection = 'translate'"
          >
            <AppIcon name="translate" />
            翻译
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'superClipboard' }"
            type="button"
            @click="activeSection = 'superClipboard'"
          >
            <AppIcon name="clipboard" />
            超级剪切板
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'sync' }"
            type="button"
            @click="activeSection = 'sync'"
          >
            <AppIcon name="cloud" />
            账号与同步
          </button>
          <button
            v-for="tool in pluginSettingsTools"
            :key="tool.pluginId"
            class="settings-nav-item"
            :class="{ active: activeSection === getPluginSettingsSection(tool) }"
            type="button"
            @click="activeSection = getPluginSettingsSection(tool)"
          >
            <AppIcon :name="tool.settings?.icon ?? tool.icon" />
            {{ tool.settings?.label ?? tool.label }}
          </button>
          <button
            class="settings-nav-item"
            :class="{ active: activeSection === 'about' }"
            type="button"
            @click="activeSection = 'about'"
          >
            <AppIcon name="settings" />
            关于 tooldesk
          </button>
        </aside>

        <section v-if="activeSection === 'general'" class="settings-content" aria-label="常规设置">
          <div class="settings-section-title">
            <h3>常规</h3>
            <p>配置主窗口关闭后的桌面端行为</p>
          </div>

          <label class="settings-switch-row">
            <span>
              <strong>关闭主窗口时最小化到托盘</strong>
              <small>开启后点击关闭按钮不会退出程序，全局快捷键会继续生效。</small>
            </span>
            <input
              :checked="closeToTray"
              type="checkbox"
              role="switch"
              @change="$emit('updateCloseToTray', ($event.target as HTMLInputElement).checked)"
            />
          </label>

          <label class="settings-switch-row">
            <span>
              <strong>插件自动更新</strong>
              <small>开启后启动时可自动检查并更新已安装的第三方插件。</small>
            </span>
            <input
              :checked="pluginAutoUpdateEnabled"
              type="checkbox"
              role="switch"
              @change="$emit('updatePluginAutoUpdateEnabled', ($event.target as HTMLInputElement).checked)"
            />
          </label>

          <div class="settings-storage-panel">
            <div class="settings-storage-head">
              <div>
                <strong>存储位置</strong>
                <small>数据目录保存用户内容，缓存目录只保存可重新生成的临时内容。</small>
              </div>
              <button
                type="button"
                class="settings-button-secondary"
                :disabled="isClearingCache"
                @click="clearCacheWithConfirm"
              >
                {{ isClearingCache ? '清理中...' : '清理缓存' }}
              </button>
            </div>

            <div
              v-for="kind in (['data', 'cache'] as StorageDirectoryKind[])"
              :key="kind"
              class="settings-storage-row"
            >
              <div class="settings-storage-copy">
                <strong>{{ getStorageDirectoryTitle(kind) }}</strong>
                <small>{{ getStorageDirectoryDescription(kind) }}</small>
              </div>

              <div class="settings-storage-path" :title="storageDirectories?.[kind].currentPath || ''">
                {{ storageDirectories?.[kind].currentPath || '暂未读取到目录' }}
              </div>

              <p
                v-if="storageDirectories?.[kind].pendingPath && storageDirectories[kind].pendingPath !== storageDirectories[kind].currentPath"
                class="settings-storage-pending"
              >
                下次启动：{{ storageDirectories[kind].pendingPath }}
              </p>

              <div class="settings-storage-actions">
                <button
                  type="button"
                  class="settings-button-secondary"
                  :disabled="Boolean(choosingStorageKind)"
                  @click="chooseStorageDirectory(kind)"
                >
                  {{ choosingStorageKind === kind ? '选择中...' : '选择目录' }}
                </button>
                <button
                  type="button"
                  class="settings-button-secondary"
                  :disabled="!storageDirectories"
                  @click="openStorageDirectory(kind)"
                >
                  打开目录
                </button>
                <button
                  type="button"
                  class="settings-button-secondary"
                  :disabled="!storageDirectories || (kind === 'data' ? !isDataDirectoryCustom : !isCacheDirectoryCustom)"
                  @click="resetStorageDirectory(kind)"
                >
                  恢复默认
                </button>
              </div>
            </div>

            <p v-if="storageStatus" class="settings-sync-status" :class="`is-${storageStatus.type}`">
              {{ storageStatus.message }}
            </p>
          </div>
        </section>

        <section v-else-if="activeSection === 'screenshot'" class="settings-content" aria-label="截图设置">
          <div class="settings-section-title">
            <h3>截图</h3>
          </div>

          <label class="settings-switch-row">
            <span>
              <strong>启用截图功能</strong>
              <small>关闭后隐藏托盘截图入口，并注销截图全局快捷键。</small>
            </span>
            <input
              :checked="screenshotDraft.enabled"
              type="checkbox"
              role="switch"
              @change="updateScreenshotDraft({ enabled: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <label class="settings-switch-row">
            <span>
              <strong>截图后自动复制到剪贴板</strong>
            </span>
            <input
              :checked="screenshotDraft.autoCopy"
              type="checkbox"
              role="switch"
              @change="updateScreenshotDraft({ autoCopy: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <label class="settings-switch-row">
            <span>
              <strong>保存截图文件</strong>
              <small>保存为 PNG 到系统图片目录下的 tooldesk-screenshots 文件夹。</small>
            </span>
            <input
              :checked="screenshotDraft.saveToFile"
              type="checkbox"
              role="switch"
              @change="updateScreenshotDraft({ saveToFile: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <label class="settings-switch-row">
            <span>
              <strong>框选时识别文字</strong>
            </span>
            <input
              :checked="screenshotDraft.ocrEnabled"
              type="checkbox"
              role="switch"
              @change="updateScreenshotDraft({ ocrEnabled: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <p v-if="showOcrConfiguredBanner" class="settings-info-banner">
            OCR 已配置，当前来源：{{ ocrSourceLabel }}
            <template v-if="ocrConfigStatus.source === 'env'">，由环境变量管理，无法在此修改密钥。</template>
          </p>

          <p v-else-if="ocrConfigStatus.provider === 'local'" class="settings-warning">
            全局配置指定本地 OCR 模型，当前版本尚未接入，请改用百度 OCR。
          </p>

          <label class="settings-field">
            <span>识别厂商</span>
            <select
              :value="baiduOcrDraft.provider"
              :disabled="isOcrEnvLocked"
              @change="updateBaiduOcrProvider(($event.target as HTMLSelectElement).value as BaiduOcrProvider)"
            >
              <option v-for="provider in BAIDU_OCR_PROVIDER_ORDER" :key="provider" :value="provider">
                {{ getBaiduOcrProviderLabel(provider) }}
              </option>
            </select>
          </label>

          <label class="settings-field">
            <span>识别接口</span>
            <select
              :value="baiduOcrDraft.apiVariant"
              @change="updateBaiduOcrApiVariant(($event.target as HTMLSelectElement).value as BaiduOcrApiVariant)"
            >
              <option v-for="variant in BAIDU_OCR_API_VARIANT_ORDER" :key="variant" :value="variant">
                {{ getBaiduOcrApiVariantLabel(variant) }}
              </option>
            </select>
          </label>

          <label class="settings-field">
            <span>百度 OCR API Key</span>
            <input
              :value="baiduOcrDraft.apiKey"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :disabled="isOcrEnvLocked"
              placeholder="在百度智能云 OCR 应用详情中获取"
              @input="updateBaiduOcrDraft({ apiKey: ($event.target as HTMLInputElement).value.trim() })"
              @change="persistBaiduOcrDraft"
            />
          </label>

          <label class="settings-field">
            <span>百度 OCR Secret Key</span>
            <input
              :value="baiduOcrDraft.secretKey"
              type="password"
              spellcheck="false"
              autocomplete="off"
              :disabled="isOcrEnvLocked"
              placeholder="与 API Key 配对的 Secret Key"
              @input="updateBaiduOcrDraft({ secretKey: ($event.target as HTMLInputElement).value.trim() })"
              @change="persistBaiduOcrDraft"
            />
            <small v-if="ocrConfigStatus.source === 'env'">
              打包部署时可将 tooldesk.config.json 放在程序目录或 resources 目录。
            </small>
          </label>

          <div class="settings-inline-action">
            <p
              v-if="ocrValidationStatus"
              class="settings-validation-message"
              :class="`is-${ocrValidationStatus.type}`"
            >
              {{ ocrValidationStatus.message }}
            </p>
            <div class="settings-inline-action-buttons">
              <button
                type="button"
                class="settings-button-ghost-danger"
                :disabled="!canClearUserOcrCredentials"
                :title="ocrClearDisabledTitle"
                @click="clearBaiduOcrUserCredentials"
              >
                清除密钥
              </button>
              <button
                type="button"
                class="settings-button-secondary"
                :disabled="isOcrEnvLocked || isValidatingOcr"
                @click="validateBaiduOcrDraft"
              >
                {{ isValidatingOcr ? '验证中...' : '验证' }}
              </button>
            </div>
          </div>

        </section>

        <section v-else-if="activeSection === 'translate'" class="settings-content" aria-label="翻译设置">
          <div class="settings-section-title">
            <h3>翻译 API</h3>
          </div>

          <p v-if="showTranslateConfiguredBanner" class="settings-info-banner">
            翻译 API 已配置，当前来源：{{ translateSourceLabel }}
            <template v-if="translateConfigStatus.source === 'env'">，由环境变量管理，无法在此修改密钥。</template>
          </p>

          <label class="settings-field">
            <span>翻译厂商</span>
            <select
              :value="translateDraft.provider"
              :disabled="isTranslateEnvLocked"
              @change="updateTranslateProvider(($event.target as HTMLSelectElement).value as TranslateProvider)"
            >
              <option v-for="provider in TRANSLATE_PROVIDER_ORDER" :key="provider" :value="provider">
                {{ getTranslateProviderLabel(provider) }}
              </option>
            </select>
          </label>

          <template v-if="translateDraft.provider === 'baidu'">
            <label class="settings-field">
              <span>百度翻译 App ID</span>
              <input
                :value="translateDraft.baidu.appId"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                placeholder="在百度翻译开放平台获取"
                @input="updateTranslateDraft({ baidu: { ...translateDraft.baidu, appId: ($event.target as HTMLInputElement).value.trim() } })"
                @change="persistTranslateDraft"
              />
            </label>
            <label class="settings-field">
              <span>百度翻译密钥</span>
              <input
                :value="translateDraft.baidu.secretKey"
                type="password"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                placeholder="与 App ID 配对的密钥"
                @input="updateTranslateDraft({ baidu: { ...translateDraft.baidu, secretKey: ($event.target as HTMLInputElement).value.trim() } })"
                @change="persistTranslateDraft"
              />
            </label>
          </template>

          <template v-else-if="translateDraft.provider === 'tencent'">
            <label class="settings-field">
              <span>腾讯云 SecretId</span>
              <input
                v-model.trim="translateDraft.tencent.secretId"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                @change="persistTranslateDraft"
              />
            </label>
            <label class="settings-field">
              <span>腾讯云 SecretKey</span>
              <input
                v-model.trim="translateDraft.tencent.secretKey"
                type="password"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                @change="persistTranslateDraft"
              />
            </label>
            <label class="settings-field">
              <span>地域 Region</span>
              <input
                v-model.trim="translateDraft.tencent.region"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                placeholder="例如 ap-guangzhou"
                @change="persistTranslateDraft"
              />
            </label>
          </template>

          <template v-else>
            <label class="settings-field">
              <span>阿里云 AccessKey ID</span>
              <input
                v-model.trim="translateDraft.aliyun.accessKeyId"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                @change="persistTranslateDraft"
              />
            </label>
            <label class="settings-field">
              <span>阿里云 AccessKey Secret</span>
              <input
                v-model.trim="translateDraft.aliyun.accessKeySecret"
                type="password"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                @change="persistTranslateDraft"
              />
            </label>
            <label class="settings-field">
              <span>地域 Region</span>
              <input
                v-model.trim="translateDraft.aliyun.region"
                type="text"
                spellcheck="false"
                autocomplete="off"
                :disabled="isTranslateEnvLocked"
                placeholder="例如 cn-hangzhou"
                @change="persistTranslateDraft"
              />
            </label>
          </template>

          <small v-if="translateConfigStatus.source === 'env'">
            打包部署时可将 tooldesk.config.json 放在程序目录或 resources 目录。
          </small>

          <div class="settings-inline-action">
            <p
              v-if="translateValidationStatus"
              class="settings-validation-message"
              :class="`is-${translateValidationStatus.type}`"
            >
              {{ translateValidationStatus.message }}
            </p>
            <div class="settings-inline-action-buttons">
              <button
                type="button"
                class="settings-button-ghost-danger"
                :disabled="!canClearUserTranslateCredentials"
                :title="translateClearDisabledTitle"
                @click="clearTranslateUserCredentials"
              >
                清除密钥
              </button>
              <button
                type="button"
                class="settings-button-secondary"
                :disabled="isTranslateEnvLocked || isValidatingTranslate"
                @click="validateTranslateDraft"
              >
                {{ isValidatingTranslate ? '验证中...' : '验证' }}
              </button>
            </div>
          </div>

        </section>

        <section v-else-if="activeSection === 'superClipboard'" class="settings-content" aria-label="超级剪切板设置">
          <div class="settings-section-title">
            <h3>超级剪切板</h3>
            <p>后台监听系统剪贴板，内容 AES-256 加密后保存在本机 userData 目录。</p>
          </div>

          <label class="settings-switch-row">
            <span>
              <strong>启用超级剪切板</strong>
              <small>关闭后停止监听，不再记录新的剪贴板内容。</small>
            </span>
            <input
              :checked="superClipboardDraft.enabled"
              type="checkbox"
              role="switch"
              @change="updateSuperClipboardDraft({ enabled: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <label class="settings-switch-row">
            <span>
              <strong>忽略重复内容</strong>
              <small>相同内容不会重复写入历史。</small>
            </span>
            <input
              :checked="superClipboardDraft.ignoreDuplicates"
              type="checkbox"
              role="switch"
              @change="updateSuperClipboardDraft({ ignoreDuplicates: ($event.target as HTMLInputElement).checked })"
            />
          </label>

          <label class="settings-field">
            <span>最大保存条数</span>
            <input
              v-model.number="superClipboardDraft.maxItems"
              type="number"
              min="50"
              max="5000"
              step="50"
              @change="updateSuperClipboardDraft({ maxItems: superClipboardDraft.maxItems })"
            />
          </label>

          <label class="settings-field">
            <span>监听间隔（毫秒）</span>
            <input
              v-model.number="superClipboardDraft.pollIntervalMs"
              type="number"
              min="400"
              max="5000"
              step="100"
              @change="updateSuperClipboardDraft({ pollIntervalMs: superClipboardDraft.pollIntervalMs })"
            />
          </label>
        </section>

        <section v-else-if="activeSection === 'sync'" class="settings-content settings-content--sync" aria-label="账号与同步">
          <div class="settings-section-title settings-sync-title">
            <div>
              <h3>账号与同步</h3>
              <p>云端同步使用独立同步目录，快照会加密后保存。</p>
            </div>
            <span class="settings-sync-last-time">{{ syncCloudLastSyncedLabel }}</span>
          </div>

          <div class="settings-sync-actions">
            <div class="settings-sync-account-fields">
              <label class="settings-field">
                <span>手机号/登录名</span>
                <input
                  v-model.trim="syncLoginNameDraft"
                  type="text"
                  placeholder="用于区分同步空间"
                  autocomplete="username"
                />
              </label>
              <label class="settings-field">
                <span>同步密码</span>
                <input
                  v-model.trim="syncPasswordDraft"
                  type="password"
                  placeholder="用于加密/解密同步快照"
                  autocomplete="current-password"
                />
              </label>
            </div>
            <div class="settings-inline-action-buttons">
              <button type="button" class="settings-button-secondary" @click="exportSyncSnapshot">
                导出快照
              </button>
              <button type="button" class="settings-button-secondary" @click="importSyncSnapshot">
                导入快照
              </button>
              <button type="button" class="settings-button-primary" @click="syncCloudSnapshot">
                同步云端
              </button>
            </div>
          </div>

          <div class="settings-sync-storage">
            <div class="settings-section-title">
              <h3>音乐云存储</h3>
              <p>音乐文件使用独立存储服务，当前先支持七牛云。</p>
            </div>

            <label class="settings-field">
              <span>存储服务</span>
              <select v-model="musicCloudDraft.provider" @change="updateMusicCloudSettings">
                <option value="none">不启用</option>
                <option value="qiniu">七牛云 Kodo</option>
                <option value="webdav" disabled>WebDAV（后续支持）</option>
                <option value="aliyundrive" disabled>阿里云盘（后续支持）</option>
              </select>
            </label>

            <div v-if="musicCloudDraft.provider === 'qiniu'" class="settings-sync-account-fields">
              <label class="settings-field">
                <span>AccessKey</span>
                <input
                  v-model.trim="musicCloudDraft.qiniu.accessKey"
                  type="text"
                  autocomplete="off"
                  @change="updateMusicCloudSettings"
                />
              </label>
              <label class="settings-field">
                <span>SecretKey</span>
                <input
                  v-model.trim="musicCloudDraft.qiniu.secretKey"
                  type="password"
                  autocomplete="off"
                  @change="updateMusicCloudSettings"
                />
              </label>
              <label class="settings-field">
                <span>Bucket</span>
                <input
                  v-model.trim="musicCloudDraft.qiniu.bucket"
                  type="text"
                  autocomplete="off"
                  @change="updateMusicCloudSettings"
                />
              </label>
              <label class="settings-field">
                <span>Region</span>
                <select v-model="musicCloudDraft.qiniu.region" @change="updateMusicCloudSettings">
                  <option value="z0">华东 z0</option>
                  <option value="z1">华北 z1</option>
                  <option value="z2">华南 z2</option>
                  <option value="na0">北美 na0</option>
                  <option value="as0">东南亚 as0</option>
                </select>
              </label>
              <label class="settings-field">
                <span>访问域名</span>
                <input
                  v-model.trim="musicCloudDraft.qiniu.domain"
                  type="text"
                  placeholder="https://cdn.example.com"
                  autocomplete="off"
                  @change="updateMusicCloudSettings"
                />
              </label>
              <label class="settings-field">
                <span>存储路径前缀</span>
                <input
                  v-model.trim="musicCloudDraft.qiniu.prefix"
                  type="text"
                  placeholder="tooldesk/music/"
                  autocomplete="off"
                  @change="updateMusicCloudSettings"
                />
              </label>
            </div>

            <div v-if="musicCloudDraft.provider === 'qiniu'" class="settings-inline-action">
              <p
                v-if="musicCloudStatus"
                class="settings-validation-message"
                :class="`is-${musicCloudStatus.type}`"
              >
                {{ musicCloudStatus.message }}
              </p>
              <p v-else class="settings-validation-message">
                配置保存后可用于后续音乐文件上传、下载和本地缓存。
              </p>
              <button type="button" class="settings-button-secondary" @click="validateMusicCloudSettings">
                测试配置
              </button>
            </div>
          </div>

          <p v-if="syncStatus" class="settings-sync-status" :class="`is-${syncStatus.type}`">
            {{ syncStatus.message }}
          </p>

          <div class="settings-sync-table-wrap">
            <div class="settings-sync-table" role="table" aria-label="本地同步清单">
              <div class="settings-sync-table-row settings-sync-table-head" role="row">
                <span role="columnheader">数据项</span>
                <span role="columnheader">类型</span>
                <span role="columnheader">状态</span>
                <span role="columnheader">大小</span>
                <span role="columnheader">更新时间</span>
              </div>
              <div
                v-for="item in displaySyncManifest"
                :key="item.id"
                class="settings-sync-table-row"
                role="row"
              >
                <span role="cell" :title="`${item.label}：${item.description}`">
                  <strong :title="item.label">{{ item.label }}</strong>
                  <small :title="item.description">{{ item.description }}</small>
                </span>
                <span role="cell">
                  <mark class="settings-sync-tag" :class="`is-${item.classification}`">
                    {{ getSyncClassificationLabel(item.classification) }}
                  </mark>
                </span>
                <span role="cell">{{ item.exists ? '已存在' : '未生成' }}</span>
                <span role="cell">{{ formatSyncSize(item.size) }}</span>
                <span role="cell">{{ formatSyncDate(item.updatedAt) }}</span>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activePluginSettingsHostTool" class="settings-content settings-content--plugin" :aria-label="activePluginSettingsHostTool.label">
          <PluginToolHost :tool="activePluginSettingsHostTool" />
        </section>

        <section v-else-if="activeSection === 'about'" class="settings-content" aria-label="关于 tooldesk">
          <div class="settings-about-section">
            <div class="settings-about-row">
              <div>
                <strong>版本信息</strong>
                <small>{{ appVersion || '加载中...' }}</small>
              </div>
              <button
                class="settings-about-button"
                type="button"
                :disabled="isCheckingUpdate"
                @click="checkForUpdates"
              >
                {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
              </button>
            </div>
            <p v-if="updateStatus" class="settings-about-status">{{ updateStatus }}</p>
          </div>
        </section>

        <section v-else class="settings-content settings-content-shortcuts" aria-label="快捷键配置">
          <div class="settings-shortcut-panel">
            <p v-if="!shortcutSupported" class="settings-shortcut-banner">
              全局快捷键需要桌面桥接正常后配置和测试。
            </p>

            <div class="settings-shortcut-rows">
              <div
                v-for="definition in GLOBAL_SHORTCUT_DEFINITIONS"
                :key="definition.id"
                class="settings-shortcut-row"
              >
                <div class="settings-shortcut-row-label">
                  <span>{{ definition.label }}</span>
                  <small>{{ definition.description }}</small>
                  <small v-if="definition.id === 'screenshot' && !screenshotDraft.enabled">
                    截图功能已关闭，此快捷键不会注册
                  </small>
                </div>

                <div class="settings-shortcut-row-control">
                  <div class="settings-shortcut-key-cell">
                    <p
                      v-if="definition.id === 'screenshot' && !screenshotDraft.enabled"
                      class="settings-shortcut-muted"
                    >
                      不可用
                    </p>

                    <template v-else>
                      <button
                        v-if="!getBindingDraft(definition.id)?.enabled"
                        class="settings-shortcut-set-btn"
                        type="button"
                        :disabled="!shortcutSupported"
                        @click="enableAndRecordBinding(definition.id)"
                      >
                        点击设置
                      </button>

                      <div
                        v-else
                        class="settings-shortcut-input-wrap"
                        :class="{
                          'is-recording': recordingBindingId === definition.id,
                          'is-disabled': isBindingDisabled(definition.id)
                        }"
                      >
                        <button
                          class="settings-shortcut-recorder"
                          type="button"
                          :disabled="isBindingDisabled(definition.id)"
                          :aria-label="`${definition.label}快捷键`"
                          @blur="stopShortcutRecording"
                          @focus="startShortcutRecording(definition.id)"
                          @keydown="handleBindingKeydown(definition.id, $event)"
                        >
                          <template v-if="recordingBindingId === definition.id">
                            <span class="settings-shortcut-recording-dot" aria-hidden="true"></span>
                            <span>请按下快捷键</span>
                          </template>
                          <template v-else>
                            <span class="settings-shortcut-combo">{{ getShortcutDisplayValue(definition.id) }}</span>
                          </template>
                        </button>
                        <button
                          v-if="recordingBindingId !== definition.id"
                          class="settings-shortcut-clear"
                          type="button"
                          aria-label="清除快捷键"
                          :disabled="!shortcutSupported || isBindingDisabled(definition.id)"
                          @mousedown.prevent
                          @click="clearBindingShortcut(definition.id)"
                        >
                          ×
                        </button>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-shortcut-footer">
              <button
                class="settings-shortcut-restore"
                type="button"
                :disabled="!shortcutSupported"
                @click="restoreDefaultShortcuts"
              >
                恢复默认
              </button>
            </div>
          </div>
        </section>
      </div>

    </section>

    <div
      v-if="settingsConfirm"
      class="settings-confirm-layer"
      role="presentation"
      @click.self="dismissSettingsConfirm"
    >
      <section
        class="settings-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="`settings-confirm-title-${settingsConfirm.variant}`"
        aria-describedby="settings-confirm-message"
      >
        <header class="settings-confirm-head">
          <h3 :id="`settings-confirm-title-${settingsConfirm.variant}`">{{ settingsConfirm.title }}</h3>
          <button
            class="settings-confirm-close icon-button"
            type="button"
            aria-label="关闭"
            :disabled="isSettingsConfirmRunning"
            @click="dismissSettingsConfirm"
          >
            <AppIcon name="close" />
          </button>
        </header>
        <p id="settings-confirm-message" class="settings-confirm-message">{{ settingsConfirm.message }}</p>
        <footer class="settings-confirm-foot">
          <button
            type="button"
            class="settings-button-secondary"
            :disabled="isSettingsConfirmRunning"
            @click="dismissSettingsConfirm"
          >
            取消
          </button>
          <button
            type="button"
            class="settings-button-primary"
            :class="{ 'is-danger': settingsConfirm.variant === 'danger' }"
            :disabled="isSettingsConfirmRunning"
            @click="acceptSettingsConfirm"
          >
            {{ isSettingsConfirmRunning ? '处理中...' : settingsConfirm.confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>


<style scoped>
.settings-button-ghost-danger {
  align-items: center;
  background: transparent;
  border: 1px solid rgba(220, 38, 38, 0.32);
  border-radius: 6px;
  color: #dc2626;
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  font-weight: 500;
  height: 34px;
  justify-content: center;
  min-width: 88px;
  padding: 0 14px;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.settings-button-ghost-danger:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.06);
  border-color: rgba(220, 38, 38, 0.48);
}

.settings-button-ghost-danger:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.settings-inline-link {
  align-self: flex-start;
  background: transparent;
  border: 0;
  color: var(--brand);
  font-size: 12px;
  font-weight: 600;
  padding: 0;
}

.settings-inline-link:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-inline-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  white-space: nowrap;
}

.settings-storage-panel {
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  padding: 12px;
}

.settings-storage-head {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.settings-storage-head > div,
.settings-storage-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.settings-storage-head strong,
.settings-storage-copy strong {
  color: var(--text-main);
  font-size: 14px;
  font-weight: 600;
}

.settings-storage-head small,
.settings-storage-copy small {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.settings-storage-row {
  border-top: 1px solid var(--panel-border);
  display: grid;
  gap: 9px;
  padding-top: 12px;
}

.settings-storage-path {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  color: var(--text-main);
  font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 8px 10px;
}

.settings-storage-pending {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  overflow-wrap: anywhere;
}

.settings-storage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-confirm-layer {
  align-items: center;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 24px;
  position: fixed;
  z-index: 1001;
}

.settings-confirm-dialog {
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
  display: grid;
  gap: 0;
  grid-template-rows: auto 1fr auto;
  max-width: calc(100vw - 48px);
  overflow: hidden;
  width: min(400px, 100%);
}

.settings-confirm-head {
  align-items: center;
  border-bottom: 1px solid var(--panel-border);
  display: flex;
  justify-content: space-between;
  min-height: 48px;
  padding: 0 16px;
}

.settings-confirm-head h3 {
  color: var(--text-main);
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.settings-confirm-close:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.settings-confirm-message {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.65;
  margin: 0;
  padding: 16px;
}

.settings-confirm-foot {
  align-items: center;
  border-top: 1px solid var(--panel-border);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
}

.settings-button-primary.is-danger {
  background: #dc2626;
  border-color: #dc2626;
}

.settings-button-primary.is-danger:hover:not(:disabled) {
  background: #b91c1c;
  border-color: #b91c1c;
}

.settings-content--plugin {
  align-content: stretch;
  gap: 0;
  overflow: hidden;
  padding: 0;
}

.settings-content--plugin :deep(.plugin-tool-host) {
  height: 100%;
  min-height: 0;
}

.settings-content--plugin :deep(.plugin-tool-frame) {
  min-height: 0;
}

.settings-content--sync {
  align-content: start;
  min-height: 0;
}

.settings-sync-title {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}

.settings-sync-title > div {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.settings-sync-last-time {
  color: var(--text-muted);
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1.5;
  padding-top: 2px;
  white-space: nowrap;
}

.settings-button-primary,
.settings-button-secondary {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.settings-button-primary {
  align-items: center;
  background: #2563eb;
  border: 1px solid #2563eb;
  border-radius: 6px;
  color: #ffffff;
  display: inline-flex;
  height: 34px;
  justify-content: center;
  min-width: 76px;
  padding: 0 16px;
}

.settings-button-primary:hover {
  background: #1d4ed8;
  border-color: #1d4ed8;
}

.settings-button-secondary {
  align-items: center;
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  color: var(--text-main);
  display: inline-flex;
  height: 34px;
  justify-content: center;
  min-width: 76px;
  padding: 0 16px;
}

.settings-button-secondary:hover {
  border-color: rgba(37, 99, 235, 0.35);
  background: rgba(37, 99, 235, 0.08);
  color: var(--brand);
}

.settings-button-secondary:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.settings-inline-action {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 34px;
}

.settings-inline-action-buttons {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.settings-sync-actions {
  align-items: stretch;
  display: grid;
  gap: 12px;
}

.settings-sync-account-fields {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.settings-sync-storage {
  border-top: 1px solid var(--panel-border);
  display: grid;
  gap: 12px;
  padding-top: 14px;
}

.settings-sync-local-toggle {
  align-items: center;
  color: var(--text-muted);
  display: inline-flex;
  font-size: 13px;
  gap: 8px;
  min-width: 0;
}

.settings-sync-local-toggle input {
  accent-color: var(--brand);
  height: 15px;
  margin: 0;
  width: 15px;
}

.settings-sync-status {
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  padding: 9px 11px;
}

.settings-sync-status.is-success {
  background: rgba(22, 163, 74, 0.07);
  border-color: rgba(22, 163, 74, 0.24);
  color: #15803d;
}

.settings-sync-status.is-error {
  background: rgba(220, 38, 38, 0.07);
  border-color: rgba(220, 38, 38, 0.24);
  color: #b91c1c;
}

.settings-sync-status.is-info {
  background: rgba(37, 99, 235, 0.07);
  border-color: rgba(37, 99, 235, 0.22);
  color: #1d4ed8;
}

.settings-sync-table {
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
}

.settings-sync-table-wrap {
  min-height: auto;
  overflow: visible;
}

.settings-sync-table-row {
  align-items: center;
  background: var(--panel-bg);
  border-top: 1px solid var(--panel-border);
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(120px, 1fr) 70px 52px 56px minmax(96px, 0.75fr);
  min-height: 48px;
  padding: 9px 12px;
}

.settings-sync-table-row:first-child {
  border-top: 0;
}

.settings-sync-table-head {
  background: var(--panel-soft);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 600;
  min-height: 36px;
  position: sticky;
  top: 0;
  z-index: 1;
}

.settings-sync-table-row span {
  color: var(--text-muted);
  font-size: 12px;
  min-width: 0;
}

.settings-sync-table-row strong {
  color: var(--text-main);
  display: block;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-sync-table-row small {
  color: var(--text-soft);
  display: block;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-sync-tag {
  background: var(--panel-soft);
  border: 1px solid var(--panel-border);
  border-radius: 999px;
  color: var(--text-muted);
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  line-height: 1;
  padding: 5px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-sync-tag.is-syncable {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.22);
  color: #1d4ed8;
}

.settings-sync-tag.is-local {
  background: rgba(100, 116, 139, 0.09);
  border-color: rgba(100, 116, 139, 0.24);
  color: #475569;
}

.settings-sync-tag.is-sensitive {
  background: rgba(220, 38, 38, 0.07);
  border-color: rgba(220, 38, 38, 0.22);
  color: #b91c1c;
}

.settings-validation-message {
  color: var(--text-soft);
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  min-width: 0;
  word-break: break-word;
}

.settings-validation-message.is-success {
  color: #16a34a;
}

.settings-validation-message.is-error {
  color: #dc2626;
}

.settings-save-success {
  color: #16a34a;
  font-size: 13px;
  font-weight: 500;
}

.settings-button-primary:disabled {
  background: #94a3b8;
  border-color: #94a3b8;
  cursor: not-allowed;
  opacity: 0.65;
}
</style>
