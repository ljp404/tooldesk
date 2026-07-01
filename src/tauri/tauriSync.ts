import { invoke } from '@tauri-apps/api/core';
import { getAppSettings, setAppSettings } from './tauriStorage';
import { readTextFile, showOpenDialog, showSaveDialog, writeTextFile } from './tauriFile';
import { installMarketPlugin, listPluginTools } from './tauriPlugins';
import { getServiceGatewayBucket, postServiceGateway } from './tauriServiceGateway';

type EncryptedCloudSnapshot = {
  alg: 'aes-256-gcm';
  data: string;
  exportedAt: string;
  iv: string;
  kdf: 'pbkdf2';
  salt: string;
  schemaVersion: 1;
  tag: string;
};

type SyncItemEnvelope = {
  schemaVersion: 1;
  updatedAt: string;
  value: unknown;
};

const CORE_SYNC_META_KEY = 'tooldesk-core-sync-meta';

function nowText() {
  return new Date().toISOString();
}

function normalizeLoginName(value: string) {
  return value.trim().toLowerCase();
}

function getCloudSyncEncryptionMaterial(loginName: string, syncPassword?: string) {
  return syncPassword?.trim() || loginName;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (item) => item.charCodeAt(0));
}

function textToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToText(value: ArrayBuffer) {
  return new TextDecoder().decode(value);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', textToBytes(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveCloudSyncKey(loginName: string, salt: Uint8Array, syncPassword?: string) {
  const material = getCloudSyncEncryptionMaterial(loginName, syncPassword);
  const baseKey = await crypto.subtle.importKey('raw', textToBytes(material), 'PBKDF2', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      hash: 'SHA-256',
      iterations: 210_000,
      name: 'PBKDF2',
      salt: bytesToArrayBuffer(salt)
    },
    baseKey,
    { length: 256, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt']
  );
}

function splitAesGcmCiphertext(encrypted: ArrayBuffer) {
  const bytes = new Uint8Array(encrypted);
  const tagLength = 16;

  if (bytes.length <= tagLength) {
    throw new Error('云端同步快照加密数据无效');
  }

  return {
    data: bytes.slice(0, -tagLength),
    tag: bytes.slice(-tagLength)
  };
}

function joinAesGcmCiphertext(data: Uint8Array, tag: Uint8Array) {
  const merged = new Uint8Array(data.length + tag.length);
  merged.set(data, 0);
  merged.set(tag, data.length);
  return merged;
}

async function encryptCloudSnapshot(
  snapshot: TooldeskSyncSnapshot,
  loginName: string,
  syncPassword?: string
): Promise<EncryptedCloudSnapshot> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCloudSyncKey(loginName, salt, syncPassword);
  const encrypted = await crypto.subtle.encrypt({ iv, name: 'AES-GCM', tagLength: 128 }, key, textToBytes(JSON.stringify(snapshot)));
  const { data, tag } = splitAesGcmCiphertext(encrypted);

  return {
    alg: 'aes-256-gcm',
    data: bytesToBase64(data),
    exportedAt: snapshot.exportedAt,
    iv: bytesToBase64(iv),
    kdf: 'pbkdf2',
    salt: bytesToBase64(salt),
    schemaVersion: 1,
    tag: bytesToBase64(tag)
  };
}

async function decryptCloudSnapshot(
  payload: EncryptedCloudSnapshot,
  loginName: string,
  syncPassword?: string
): Promise<TooldeskSyncSnapshot> {
  if (payload.alg !== 'aes-256-gcm' || payload.kdf !== 'pbkdf2' || payload.schemaVersion !== 1) {
    throw new Error('云端同步快照加密格式不受支持');
  }

  try {
    const key = await deriveCloudSyncKey(loginName, base64ToBytes(payload.salt), syncPassword);
    const encrypted = joinAesGcmCiphertext(base64ToBytes(payload.data), base64ToBytes(payload.tag));
    const plaintext = await crypto.subtle.decrypt(
      { iv: base64ToBytes(payload.iv), name: 'AES-GCM', tagLength: 128 },
      key,
      encrypted
    );

    return JSON.parse(bytesToText(plaintext)) as TooldeskSyncSnapshot;
  } catch {
    throw new Error('同步密码错误');
  }
}

function wrapSyncItem(value: unknown, updatedAt = nowText()): SyncItemEnvelope {
  return {
    schemaVersion: 1,
    updatedAt,
    value
  };
}

function unwrapSyncItem(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    'value' in value
  ) {
    return (value as { value: unknown }).value;
  }

  return value;
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

function readCoreSyncMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(CORE_SYNC_META_KEY) ?? '{}') as unknown;
    return meta && typeof meta === 'object' ? meta as Record<string, { hash?: string; updatedAt?: string }> : {};
  } catch {
    return {};
  }
}

function writeCoreSyncMeta(meta: Record<string, { hash?: string; updatedAt?: string }>) {
  localStorage.setItem(CORE_SYNC_META_KEY, JSON.stringify(meta));
}

async function getTrackedCoreSyncUpdatedAt(id: string, value: unknown, fallback: string) {
  const meta = readCoreSyncMeta();
  const hash = stableStringify(value);
  const previous = meta[id];
  const updatedAt = previous?.hash === hash && previous.updatedAt
    ? previous.updatedAt
    : await getLocalSyncItemUpdatedAt(id, fallback);

  meta[id] = { hash, updatedAt };
  writeCoreSyncMeta(meta);

  return updatedAt;
}

function trackImportedCoreSyncItem(id: string, value: unknown, updatedAt: string) {
  const meta = readCoreSyncMeta();
  meta[id] = {
    hash: stableStringify(value),
    updatedAt
  };
  writeCoreSyncMeta(meta);
}

function isSyncItemEnvelope(value: unknown): value is SyncItemEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (value as { updatedAt?: unknown }).updatedAt === 'string' &&
    'value' in value
  );
}

function isPluginSyncItemKey(key: string) {
  return key.startsWith('plugin:');
}

function normalizePluginSyncItem(value: unknown) {
  const item = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const localStorage = item.localStorage && typeof item.localStorage === 'object'
    ? item.localStorage as Record<string, unknown>
    : {};

  return {
    localStorage,
    schemaVersion: 1,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : nowText()
  };
}

function pickClientSyncItems(items?: Record<string, unknown>) {
  const pluginItems: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(items ?? {})) {
    if (isPluginSyncItemKey(key)) {
      pluginItems[key] = normalizePluginSyncItem(unwrapSyncItem(value));
    }
  }

  return pluginItems;
}

function sanitizeAppSettings(settings: TooldeskAppSettings) {
  return {
    closeToTray: settings.closeToTray,
    globalShortcuts: settings.globalShortcuts,
    pluginAutoUpdateEnabled: settings.pluginAutoUpdateEnabled,
    screenshot: settings.screenshot,
    superClipboard: settings.superClipboard
  };
}

function getSyncItemUpdatedAt(value: unknown, fallback: string) {
  return value && typeof value === 'object' && typeof (value as { updatedAt?: unknown }).updatedAt === 'string'
    ? String((value as { updatedAt: string }).updatedAt)
    : fallback;
}

function compareIsoTime(left: string, right: string) {
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function pickNewerSyncItem(localValue: unknown, cloudValue: unknown, localFallback: string, cloudFallback: string) {
  if (localValue === undefined) {
    return cloudValue;
  }

  if (cloudValue === undefined) {
    return localValue;
  }

  return compareIsoTime(getSyncItemUpdatedAt(localValue, localFallback), getSyncItemUpdatedAt(cloudValue, cloudFallback)) >= 0
    ? localValue
    : cloudValue;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeInstalledPluginMetadata(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = getRecord(item);
      const pluginId = typeof record.pluginId === 'string' ? record.pluginId.trim() : '';
      const version = typeof record.version === 'string' ? record.version.trim() : '';

      return pluginId ? { pluginId, version } : null;
    })
    .filter((item): item is { pluginId: string; version: string } => Boolean(item));
}

function getItemTimestamp(value: unknown, fallback: string) {
  const updatedAt = getRecord(value).updatedAt;
  const createdAt = getRecord(value).createdAt;
  return typeof updatedAt === 'string' || typeof updatedAt === 'number'
    ? String(updatedAt)
    : typeof createdAt === 'string' || typeof createdAt === 'number'
      ? String(createdAt)
      : fallback;
}

function compareFlexibleTime(left: unknown, right: unknown) {
  const leftTime = typeof left === 'number' ? left : new Date(String(left ?? '')).getTime();
  const rightTime = typeof right === 'number' ? right : new Date(String(right ?? '')).getTime();
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function mergeArrayById(localItems: unknown[], cloudItems: unknown[], localFallback: string, cloudFallback: string) {
  const merged = new Map<string, unknown>();

  for (const item of cloudItems) {
    const id = getRecord(item).id;

    if (typeof id === 'string' && id) {
      merged.set(id, item);
    }
  }

  for (const item of localItems) {
    const id = getRecord(item).id;

    if (typeof id !== 'string' || !id) {
      continue;
    }

    const existing = merged.get(id);

    if (!existing || compareFlexibleTime(getItemTimestamp(item, localFallback), getItemTimestamp(existing, cloudFallback)) >= 0) {
      merged.set(id, item);
    }
  }

  return Array.from(merged.values());
}

function mergeHttpCollections(localValue: unknown, cloudValue: unknown, localUpdatedAt: string, cloudUpdatedAt: string) {
  const local = getRecord(localValue);
  const cloud = getRecord(cloudValue);
  const localGroups = Array.isArray(local.groups) ? local.groups : [];
  const cloudGroups = Array.isArray(cloud.groups) ? cloud.groups : [];
  const groupsById = new Map<string, Record<string, unknown>>();

  for (const group of cloudGroups) {
    const record = getRecord(group);

    if (typeof record.id === 'string' && record.id) {
      groupsById.set(record.id, record);
    }
  }

  for (const group of localGroups) {
    const localGroup = getRecord(group);
    const id = localGroup.id;

    if (typeof id !== 'string' || !id) {
      continue;
    }

    const cloudGroup = groupsById.get(id);
    const newerGroup = !cloudGroup || compareFlexibleTime(getItemTimestamp(localGroup, localUpdatedAt), getItemTimestamp(cloudGroup, cloudUpdatedAt)) >= 0
      ? localGroup
      : cloudGroup;
    const requests = mergeArrayById(
      Array.isArray(localGroup.requests) ? localGroup.requests : [],
      Array.isArray(cloudGroup?.requests) ? cloudGroup.requests : [],
      localUpdatedAt,
      cloudUpdatedAt
    );

    groupsById.set(id, {
      ...newerGroup,
      requests
    });
  }

  const preferLocal = compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0;

  return {
    activeGroupId: preferLocal ? local.activeGroupId : cloud.activeGroupId,
    activeRequestId: preferLocal ? local.activeRequestId : cloud.activeRequestId,
    groups: Array.from(groupsById.values())
  };
}

function mergeHttpEnvironments(localValue: unknown, cloudValue: unknown, localUpdatedAt: string, cloudUpdatedAt: string) {
  const local = getRecord(localValue);
  const cloud = getRecord(cloudValue);
  const environments = mergeArrayById(
    Array.isArray(local.environments) ? local.environments : [],
    Array.isArray(cloud.environments) ? cloud.environments : [],
    localUpdatedAt,
    cloudUpdatedAt
  );
  const preferLocal = compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0;

  return {
    activeEnvId: preferLocal ? local.activeEnvId : cloud.activeEnvId,
    environments
  };
}

function mergeHttpPluginItem(localItem: unknown, cloudItem: unknown, localUpdatedAt: string, cloudUpdatedAt: string) {
  const local = normalizePluginSyncItem(localItem);
  const cloud = normalizePluginSyncItem(cloudItem);

  if (!local) {
    return cloudItem;
  }

  if (!cloud) {
    return localItem;
  }

  const localStorage: Record<string, unknown> = {
    ...cloud.localStorage,
    ...local.localStorage
  };

  localStorage['tooldesk-http-collections'] = mergeHttpCollections(
    local.localStorage['tooldesk-http-collections'],
    cloud.localStorage['tooldesk-http-collections'],
    localUpdatedAt,
    cloudUpdatedAt
  );
  localStorage['tooldesk-http-environments'] = mergeHttpEnvironments(
    local.localStorage['tooldesk-http-environments'],
    cloud.localStorage['tooldesk-http-environments'],
    localUpdatedAt,
    cloudUpdatedAt
  );
  localStorage['tooldesk-http-history'] = mergeArrayById(
    Array.isArray(local.localStorage['tooldesk-http-history']) ? local.localStorage['tooldesk-http-history'] as unknown[] : [],
    Array.isArray(cloud.localStorage['tooldesk-http-history']) ? cloud.localStorage['tooldesk-http-history'] as unknown[] : [],
    localUpdatedAt,
    cloudUpdatedAt
  ).slice(0, 50);

  return {
    localStorage,
    schemaVersion: 1,
    updatedAt: compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0 ? localUpdatedAt : cloudUpdatedAt
  };
}

function mergePluginItem(key: string, localValue: unknown, cloudValue: unknown, localUpdatedAt: string, cloudUpdatedAt: string) {
  if (key === 'plugin:tooldesk-http-client') {
    return mergeHttpPluginItem(localValue, cloudValue, localUpdatedAt, cloudUpdatedAt);
  }

  const local = normalizePluginSyncItem(localValue);
  const cloud = normalizePluginSyncItem(cloudValue);

  if (!local || !cloud) {
    return pickNewerSyncItem(localValue, cloudValue, localUpdatedAt, cloudUpdatedAt);
  }

  return {
    localStorage: compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0 ? local.localStorage : cloud.localStorage,
    schemaVersion: 1,
    updatedAt: compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0 ? localUpdatedAt : cloudUpdatedAt
  };
}

function mergeInstalledPlugins(localValue: unknown, cloudValue: unknown) {
  const pluginsById = new Map<string, { pluginId: string; version: string }>();

  for (const item of normalizeInstalledPluginMetadata(cloudValue)) {
    pluginsById.set(item.pluginId, item);
  }

  for (const item of normalizeInstalledPluginMetadata(localValue)) {
    pluginsById.set(item.pluginId, item);
  }

  return Array.from(pluginsById.values()).sort((current, next) => current.pluginId.localeCompare(next.pluginId));
}

function mergeSyncSnapshots(localSnapshot: TooldeskSyncSnapshot, cloudSnapshot?: TooldeskSyncSnapshot | null): TooldeskSyncSnapshot {
  if (!cloudSnapshot?.items || typeof cloudSnapshot.items !== 'object') {
    return localSnapshot;
  }

  const exportedAt = nowText();
  const items: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(cloudSnapshot.items), ...Object.keys(localSnapshot.items)]);

  for (const key of keys) {
    const localValue = localSnapshot.items[key];
    const cloudValue = cloudSnapshot.items[key];
    const localUpdatedAt = getSyncItemUpdatedAt(localValue, localSnapshot.exportedAt);
    const cloudUpdatedAt = getSyncItemUpdatedAt(cloudValue, cloudSnapshot.exportedAt);
    const mergedValue = key === 'installed-plugins'
      ? mergeInstalledPlugins(unwrapSyncItem(localValue), unwrapSyncItem(cloudValue))
      : isPluginSyncItemKey(key)
        ? mergePluginItem(key, unwrapSyncItem(localValue), unwrapSyncItem(cloudValue), localUpdatedAt, cloudUpdatedAt)
        : pickNewerSyncItem(localValue, cloudValue, localSnapshot.exportedAt, cloudSnapshot.exportedAt);
    const mergedUpdatedAt = compareIsoTime(localUpdatedAt, cloudUpdatedAt) >= 0 ? localUpdatedAt : cloudUpdatedAt;

    items[key] = isSyncItemEnvelope(mergedValue) ? mergedValue : wrapSyncItem(mergedValue, mergedUpdatedAt);
  }

  return {
    exportedAt,
    items,
    schemaVersion: 1
  };
}

async function postSupabaseFunction<T>(payload: unknown): Promise<T> {
  return postServiceGateway<T>(payload as Record<string, unknown>, { timeoutMs: 15_000 });
}

async function listInstalledPluginMetadata() {
  const tools = await listPluginTools();

  return tools
    .filter((tool) => Boolean(tool.installPath))
    .map((tool) => ({
      pluginId: tool.pluginId,
      version: tool.manifestVersion
    }));
}

export async function getSyncManifest(): Promise<TooldeskSyncManifestItem[]> {
  return invoke('get_sync_manifest');
}

async function getLocalSyncItemUpdatedAt(id: string, fallback: string) {
  try {
    return (await getSyncManifest()).find((item) => item.id === id)?.updatedAt ?? fallback;
  } catch {
    return fallback;
  }
}

async function installMissingSnapshotPlugins(value: unknown) {
  const incomingPlugins = normalizeInstalledPluginMetadata(value);

  if (!incomingPlugins.length) {
    return;
  }

  const installedPluginIds = new Set(
    (await listPluginTools())
      .filter((tool) => Boolean(tool.installPath))
      .map((tool) => tool.pluginId)
      .filter((pluginId): pluginId is string => Boolean(pluginId))
  );

  for (const item of incomingPlugins) {
    if (!installedPluginIds.has(item.pluginId)) {
      const result = await installMarketPlugin(item.pluginId);

      if (result.error) {
        throw new Error(`安装同步扩展失败：${item.pluginId}，${result.error}`);
      }

      installedPluginIds.add(item.pluginId);
    }
  }
}

export async function exportLocalSyncSnapshot(
  options: Pick<TooldeskSyncCloudOptions, 'localItems'> = {}
): Promise<TooldeskSyncSnapshot> {
  const exportedAt = nowText();
  const settings = await getAppSettings();
  const appSettings = sanitizeAppSettings(settings);
  const installedPlugins = await listInstalledPluginMetadata();
  const appSettingsUpdatedAt = await getTrackedCoreSyncUpdatedAt('app-settings', appSettings, exportedAt);
  const installedPluginsUpdatedAt = await getTrackedCoreSyncUpdatedAt('installed-plugins', installedPlugins, exportedAt);
  const items: Record<string, unknown> = {
    'app-settings': wrapSyncItem(appSettings, appSettingsUpdatedAt),
    'installed-plugins': wrapSyncItem(installedPlugins, installedPluginsUpdatedAt)
  };

  for (const [key, value] of Object.entries(pickClientSyncItems(options.localItems))) {
    items[key] = wrapSyncItem(value, getSyncItemUpdatedAt(value, exportedAt));
  }

  return {
    exportedAt,
    items,
    schemaVersion: 1
  };
}

export async function importLocalSyncSnapshot(snapshot: TooldeskSyncSnapshot): Promise<{
  clientItems?: Record<string, unknown>;
  importedAt: string;
}> {
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.items || typeof snapshot.items !== 'object') {
    throw new Error('同步快照格式无效');
  }

  const incomingSettings = unwrapSyncItem(snapshot.items['app-settings']);

  if (incomingSettings && typeof incomingSettings === 'object') {
    await setAppSettings(incomingSettings as Partial<TooldeskAppSettings>);
    trackImportedCoreSyncItem(
      'app-settings',
      sanitizeAppSettings(await getAppSettings()),
      getSyncItemUpdatedAt(snapshot.items['app-settings'], snapshot.exportedAt)
    );
  }

  await installMissingSnapshotPlugins(unwrapSyncItem(snapshot.items['installed-plugins']));
  trackImportedCoreSyncItem(
    'installed-plugins',
    await listInstalledPluginMetadata(),
    getSyncItemUpdatedAt(snapshot.items['installed-plugins'], snapshot.exportedAt)
  );

  return {
    clientItems: pickClientSyncItems(snapshot.items),
    importedAt: nowText()
  };
}

export async function exportLocalSyncSnapshotToFile(
  options: Pick<TooldeskSyncCloudOptions, 'localItems'> = {}
): Promise<{ canceled: boolean; exportedAt?: string; filePath?: string }> {
  const snapshot = await exportLocalSyncSnapshot(options);
  const datePart = snapshot.exportedAt.slice(0, 10);
  const result = await showSaveDialog({
    defaultPath: `tooldesk-sync-snapshot-${datePart}.json`,
    filters: [{ extensions: ['json'], name: 'JSON 文件' }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await writeTextFile(result.filePath, `${JSON.stringify(snapshot, null, 2)}\n`);

  return {
    canceled: false,
    exportedAt: snapshot.exportedAt,
    filePath: result.filePath
  };
}

export async function importLocalSyncSnapshotFromFile(): Promise<{
  canceled: boolean;
  clientItems?: Record<string, unknown>;
  filePath?: string;
  importedAt?: string;
}> {
  const result = await showOpenDialog({
    filters: [{ extensions: ['json'], name: 'JSON 文件' }],
    properties: ['openFile']
  });
  const filePath = result.filePaths[0];

  if (result.canceled || !filePath) {
    return { canceled: true };
  }

  const snapshot = JSON.parse(await readTextFile(filePath)) as TooldeskSyncSnapshot;
  const importResult = await importLocalSyncSnapshot(snapshot);

  return {
    canceled: false,
    filePath,
    ...importResult
  };
}

export async function syncCloudSnapshot(options: TooldeskSyncCloudOptions = {}): Promise<{
  accountHash: string;
  clientItems?: Record<string, unknown>;
  lastSyncedAt: string;
  message: string;
  objectKey: string;
}> {
  const savedSettings = await getAppSettings();
  const loginName = normalizeLoginName(options.loginName ?? savedSettings.syncCloud.loginName ?? '');
  const syncPassword = options.syncPassword ?? savedSettings.syncCloud.syncPassword ?? '';

  if (!loginName) {
    throw new Error('请先输入手机号或登录名');
  }

  if (!syncPassword.trim()) {
    throw new Error('请先输入同步密码');
  }

  const accountHash = await sha256Hex(loginName);
  const objectKey = `tooldesk/sync/v1/${accountHash}/snapshot.enc.json`;
  const bucket = await getServiceGatewayBucket();
  const localSnapshot = await exportLocalSyncSnapshot({ localItems: pickClientSyncItems(options.localItems) });
  const pullResult = await postSupabaseFunction<{
    exists?: boolean;
    payload?: EncryptedCloudSnapshot;
  }>({
    accountHash,
    action: 'pull',
    bucket,
    client: 'tooldesk',
    objectKey,
    schemaVersion: 1
  });

  let message = '本地快照已上传云端';
  let cloudSnapshot: TooldeskSyncSnapshot | null = null;

  if (pullResult.exists && pullResult.payload) {
    cloudSnapshot = await decryptCloudSnapshot(pullResult.payload, loginName, syncPassword);
    message = '本地与云端已同步';
  }

  const mergedSnapshot = mergeSyncSnapshots(localSnapshot, cloudSnapshot);
  const importResult = await importLocalSyncSnapshot(mergedSnapshot);
  const encryptedSnapshot = await encryptCloudSnapshot(mergedSnapshot, loginName, syncPassword);

  await postSupabaseFunction<unknown>({
    accountHash,
    action: 'push',
    bucket,
    client: 'tooldesk',
    objectKey,
    payload: encryptedSnapshot,
    schemaVersion: 1
  });

  const lastSyncedAt = nowText();
  await setAppSettings({
    syncCloud: {
      ...savedSettings.syncCloud,
      autoSyncEnabled: true,
      lastSyncedAt,
      lastSyncMessage: message,
      loginName,
      syncPassword
    }
  });

  return {
    accountHash,
    clientItems: importResult.clientItems,
    lastSyncedAt,
    message,
    objectKey
  };
}
