<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  getAllowedPluginApis,
  isHostVersionCompatible,
  PLUGIN_HOST_API_VERSION,
  PLUGIN_SDK_VERSION
} from '../../shared/plugin/pluginApiReference';
import { PLUGIN_ERROR_CODES } from '../../shared/plugin/pluginErrorCodes';
import type { PluginErrorCode } from '../../shared/plugin/pluginErrorCodes';
import type { ToolItem } from '../../types/toolbox';
import { frameMemoryExtra, readFrameMemory, startComponentMemoryReporter } from '../../utils/memoryDiagnostics';

type PluginFrameElement = {
  contentWindow: ({
    performance?: {
      memory?: {
        jsHeapSizeLimit?: number;
        totalJSHeapSize?: number;
        usedJSHeapSize?: number;
      };
    };
    postMessage: (message: unknown, targetOrigin: string) => void;
  }) | null;
};

type PluginMessageTarget = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

type PluginMessageEvent = {
  data: unknown;
  origin?: string;
  source: PluginMessageTarget | null;
};

type PluginApiRequest = {
  args?: unknown[];
  chromeHidden?: boolean;
  method?: string;
  pluginId?: string;
  requestId?: string;
  source?: string;
  subscriptionId?: string;
  type?: string;
};

function resolvePluginMessageOrigin(entryUrl: string) {
  if (!entryUrl) {
    return '';
  }

  try {
    const url = new URL(entryUrl);
    if (url.origin && url.origin !== 'null') {
      return url.origin;
    }

    return `${url.protocol}//${url.hostname}`;
  } catch {
    return '';
  }
}

const props = defineProps<{
  shortcutContent?: string;
  shortcutContentVersion?: number;
  tool: ToolItem;
}>();

const emit = defineEmits<{
  'chrome-hidden-change': [hidden: boolean];
}>();

const frameRef = ref<PluginFrameElement | null>(null);
let pluginMessageTarget: PluginMessageTarget | null = null;
const pluginSubscriptions = new Map<string, () => void>();
const appVersion = ref('');
const pluginSdkError = ref('');
const isPluginChromeHidden = ref(false);
const isCompactMode = new URLSearchParams(window.location.search).get('compact') === '1';
const isTaskbarCalendarPopup = isCompactMode && props.tool.pluginId === 'tooldesk-calendar';
let stopTaskbarCalendarPopupOpenedListener: (() => void) | undefined;
let stopPluginMemoryReporter: (() => void) | undefined;

const hostCompatibilityWarning = computed(() => {
  const requiredVersion = props.tool.minHostVersion;

  if (!requiredVersion || !appVersion.value) {
    return '';
  }

  if (isHostVersionCompatible(requiredVersion, appVersion.value)) {
    return '';
  }

  return `此插件要求 Tooldesk ${requiredVersion} 或更高版本，当前为 ${appVersion.value}。`;
});

const pluginEntryUrl = computed(() => {
  if (!props.tool.entryUrl) {
    return '';
  }

  try {
    const url = new URL(props.tool.entryUrl);

    if (isCompactMode) {
      url.searchParams.set('compact', '1');
    }

    return url.toString();
  } catch {
    const params = [
      ...(isCompactMode ? ['compact=1'] : [])
    ];

    if (params.length === 0) {
      return props.tool.entryUrl;
    }

    const separator = props.tool.entryUrl.includes('?') ? '&' : '?';
    return `${props.tool.entryUrl}${separator}${params.join('&')}`;
  }
});

const pluginFrameOrigin = computed(() => resolvePluginMessageOrigin(pluginEntryUrl.value));

const pluginStorageMethods = new Set(['getPluginStorageItem', 'removePluginStorageItem', 'setPluginStorageItem']);
function getPluginPermissions() {
  return Array.from(props.tool.permissions ?? []).map((permission) => String(permission));
}

function getPluginAllowedApis() {
  return getAllowedPluginApis(getPluginPermissions());
}

function getPluginStorageNamespace() {
  return `tooldesk-${String(props.tool.pluginId ?? props.tool.key)
    .replace(/^plugin:/, '')
    .replace(/^tooldesk-/, '')
    .replace(/-(client|player)$/, '')}`;
}

function isAllowedPluginStorageKey(value: unknown) {
  const key = String(value ?? '').trim();

  if (!/^[a-z0-9._:-]{3,120}$/i.test(key)) {
    return false;
  }

  if (props.tool.sync?.localStorageKeys.includes(key)) {
    return true;
  }

  return key.startsWith(`${getPluginStorageNamespace()}-`);
}

async function handlePluginStorageApi(method: string, args: unknown[]) {
  const key = args[0];

  if (!isAllowedPluginStorageKey(key)) {
    throw new Error(`Plugin storage key is not allowed: ${String(key ?? '')}`);
  }

  const storageKey = String(key).trim();

  if (!window.tooldeskShortcut?.getPluginStorageItem || !window.tooldeskShortcut.setPluginStorageItem || !window.tooldeskShortcut.removePluginStorageItem) {
    throw new Error('Plugin storage API is unavailable.');
  }

  if (method === 'getPluginStorageItem') {
    return window.tooldeskShortcut.getPluginStorageItem(storageKey);
  }

  if (method === 'setPluginStorageItem') {
    return window.tooldeskShortcut.setPluginStorageItem(storageKey, String(args[1] ?? ''));
  }

  return window.tooldeskShortcut.removePluginStorageItem(storageKey);
}

function invokeHostApiMethod(method: string, args: unknown[]) {
  const shortcutApi = window.tooldeskShortcut as unknown as Record<string, unknown> | undefined;

  if (shortcutApi && typeof shortcutApi[method] === 'function') {
    if (method === 'runPluginTool') {
      const payload = args[0] && typeof args[0] === 'object' ? { ...(args[0] as Record<string, unknown>) } : {};
      payload.pluginId = props.tool.pluginId;
      return (shortcutApi[method] as (payload: Record<string, unknown>) => unknown).call(shortcutApi, payload);
    }

    return (shortcutApi[method] as (...items: unknown[]) => unknown).call(shortcutApi, ...args);
  }

  return null;
}

function getPluginMessageTarget(target?: PluginMessageTarget | null) {
  return target ?? pluginMessageTarget ?? frameRef.value?.contentWindow ?? null;
}

function postPluginMessage(message: Record<string, unknown>, target?: PluginMessageTarget | null) {
  getPluginMessageTarget(target)?.postMessage(
    {
      source: 'tooldesk-host',
      ...message
    },
    '*'
  );
}

function postPluginApiError(
  requestId: string,
  code: PluginErrorCode,
  message: string,
  target?: PluginMessageTarget | null
) {
  postPluginMessage(
    {
      code,
      error: message,
      ok: false,
      requestId,
      type: 'api:result'
    },
    target
  );
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function postHostReady(target?: PluginMessageTarget | null) {
  postPluginMessage(
      {
        appVersion: appVersion.value || undefined,
        hostApiVersion: PLUGIN_HOST_API_VERSION,
        permissions: getPluginPermissions(),
        pluginId: props.tool.pluginId,
        sdkVersion: PLUGIN_SDK_VERSION,
        type: 'host:ready'
    },
    target
  );
}

function postLaunchContext(target?: PluginMessageTarget | null) {
  postPluginMessage(
    {
      appVersion: appVersion.value || undefined,
      content: props.shortcutContent ?? '',
      hostApiVersion: PLUGIN_HOST_API_VERSION,
      pluginId: props.tool.pluginId,
      sdkVersion: PLUGIN_SDK_VERSION,
      toolKey: props.tool.key,
      triggeredAt: props.shortcutContentVersion ?? 0,
      type: 'launch-context'
    },
    target
  );
}

function resolvePluginMessageTarget(event: PluginMessageEvent) {
  if (event.source && typeof event.source.postMessage === 'function') {
    return event.source;
  }

  return frameRef.value?.contentWindow ?? pluginMessageTarget;
}

function belongsToThisPluginHost(data: PluginApiRequest) {
  const messagePluginId = String(data.pluginId ?? '').trim();
  const hostPluginId = String(props.tool.pluginId ?? '').trim();

  if (!hostPluginId) {
    return true;
  }

  if (!messagePluginId) {
    return true;
  }

  return messagePluginId === hostPluginId;
}

function isTrustedPluginMessage(event: PluginMessageEvent, data: PluginApiRequest) {
  const source = event.source as PluginMessageTarget | null;

  if (!source || typeof source.postMessage !== 'function' || !frameRef.value) {
    return false;
  }

  if (!belongsToThisPluginHost(data)) {
    return false;
  }

  const messagePluginId = String(data.pluginId ?? '').trim();
  const hostPluginId = String(props.tool.pluginId ?? '').trim();

  if (hostPluginId && messagePluginId && hostPluginId === messagePluginId) {
    return true;
  }

  const origin = String(event.origin ?? '');
  const expectedOrigin = pluginFrameOrigin.value;

  if (expectedOrigin && origin && origin === expectedOrigin) {
    return true;
  }

  if ((!origin || origin === 'null') && hostPluginId) {
    return true;
  }

  const frameWindow = frameRef.value?.contentWindow;

  if (frameWindow && source === frameWindow) {
    return true;
  }

  if (pluginMessageTarget && source === pluginMessageTarget) {
    return true;
  }

  return false;
}

function resetTaskbarCalendarToToday() {
  postPluginMessage({ type: 'calendar:reset-to-today' });
}

async function handlePluginApiRequest(data: PluginApiRequest, target?: PluginMessageTarget | null) {
  const requestId = data.requestId;
  const method = String(data.method ?? '').trim();

  if (!requestId || !method) {
    return;
  }

  if (!getPluginAllowedApis().has(method)) {
    postPluginApiError(requestId, PLUGIN_ERROR_CODES.PLUGIN_API_DENIED, `Plugin API is not allowed: ${method}`, target);
    return;
  }

  if (pluginStorageMethods.has(method)) {
    try {
      const result = await handlePluginStorageApi(method, Array.isArray(data.args) ? data.args : []);
      postPluginMessage(
        {
          ok: true,
          requestId,
          result,
          type: 'api:result'
        },
        target
      );
    } catch (error) {
      postPluginApiError(
        requestId,
        PLUGIN_ERROR_CODES.PLUGIN_STORAGE_DENIED,
        error instanceof Error ? error.message : 'Plugin storage failed',
        target
      );
    }
    return;
  }

  const args = Array.isArray(data.args) ? data.args : [];
  const hostInvoker = invokeHostApiMethod(method, args);

  if (hostInvoker === null) {
    postPluginApiError(
      requestId,
      PLUGIN_ERROR_CODES.PLUGIN_API_UNAVAILABLE,
      `Plugin API is unavailable: ${method}`,
      target
    );
    return;
  }

  try {
    const result = await hostInvoker;
    postPluginMessage(
      {
        ok: true,
        requestId,
        result,
        type: 'api:result'
      },
      target
    );
  } catch (error) {
    postPluginApiError(
      requestId,
      PLUGIN_ERROR_CODES.PLUGIN_API_DENIED,
      getErrorMessage(error, 'Plugin API failed'),
      target
    );
  }
}

function handlePluginApiSubscribe(data: PluginApiRequest, target?: PluginMessageTarget | null) {
  const requestId = data.requestId;
  const method = String(data.method ?? '').trim();

  if (!requestId || !method) {
    return;
  }

  if (!getPluginAllowedApis().has(method)) {
    postPluginApiError(requestId, PLUGIN_ERROR_CODES.PLUGIN_API_DENIED, `Plugin API is not allowed: ${method}`, target);
    return;
  }

  try {
    const subscriptionId = `${method}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const unsubscribeResult = invokeHostApiMethod(method, [
      () => {
        postPluginMessage(
          {
            method,
            subscriptionId,
            type: 'api:event'
          },
          target
        );
      }
    ]);

    if (unsubscribeResult === null) {
      postPluginApiError(
        requestId,
        PLUGIN_ERROR_CODES.PLUGIN_API_UNAVAILABLE,
        `Plugin API is unavailable: ${method}`,
        target
      );
      return;
    }

    if (typeof unsubscribeResult !== 'function') {
      postPluginApiError(
        requestId,
        PLUGIN_ERROR_CODES.PLUGIN_API_UNAVAILABLE,
        `Plugin API is not subscribable: ${method}`,
        target
      );
      return;
    }

    const unsubscribe = unsubscribeResult as () => void;
    pluginSubscriptions.set(subscriptionId, unsubscribe);
    postPluginMessage(
      {
        ok: true,
        requestId,
        result: subscriptionId,
        type: 'api:result'
      },
      target
    );
  } catch (error) {
    postPluginApiError(
      requestId,
      PLUGIN_ERROR_CODES.PLUGIN_API_DENIED,
      error instanceof Error ? error.message : 'Plugin API failed',
      target
    );
  }
}

function handlePluginApiUnsubscribe(data: PluginApiRequest) {
  const subscriptionId = String(data.subscriptionId ?? '').trim();

  if (!subscriptionId) {
    return;
  }

  pluginSubscriptions.get(subscriptionId)?.();
  pluginSubscriptions.delete(subscriptionId);
}

function handlePluginMessage(event: PluginMessageEvent) {
  const data = event.data as PluginApiRequest;

  if (data?.source !== 'tooldesk-plugin' || !isTrustedPluginMessage(event, data)) {
    return;
  }

  const target = resolvePluginMessageTarget(event);

  if (target) {
    pluginMessageTarget = target;
  }

  if (data.type === 'host:ready:get') {
    postHostReady(target);
    return;
  }

  if (data.type === 'permissions:get') {
    postPluginMessage(
      {
        permissions: getPluginPermissions(),
        pluginId: props.tool.pluginId,
        requestId: data.requestId,
        type: 'permissions:result'
      },
      target
    );
    return;
  }

  if (data.type === 'launch-context:get') {
    postLaunchContext(target);
    return;
  }

  if (data.type === 'plugin:ui-state') {
    isPluginChromeHidden.value = data.chromeHidden === true;
    emit('chrome-hidden-change', isPluginChromeHidden.value);
    return;
  }

  if (data.type === 'api:invoke') {
    void handlePluginApiRequest(data, target);
    return;
  }

  if (data.type === 'api:subscribe') {
    handlePluginApiSubscribe(data, target);
    return;
  }

  if (data.type === 'api:unsubscribe') {
    handlePluginApiUnsubscribe(data);
  }
}

const messageListener = (event: Event) => {
  const messageEvent = event as Event & {
    data?: unknown;
    origin?: string;
    source?: PluginMessageTarget | null;
  };

  handlePluginMessage({
    data: messageEvent.data,
    origin: messageEvent.origin,
    source: messageEvent.source ?? null
  });
};

function handleFrameLoad() {
  pluginSdkError.value = '';
  isPluginChromeHidden.value = false;
  emit('chrome-hidden-change', false);
  pluginMessageTarget = frameRef.value?.contentWindow ?? null;
  stopPluginMemoryReporter?.();
  stopPluginMemoryReporter = startComponentMemoryReporter(() => ({
    context: String(props.tool.pluginId ?? props.tool.key),
    extra: {
      ...frameMemoryExtra(readFrameMemory(frameRef.value?.contentWindow ?? null)),
      label: props.tool.label,
      toolKey: props.tool.key
    },
    source: 'plugin-iframe'
  }));

  void nextTick(() => {
    postHostReady();
    postLaunchContext();
  });
}

onMounted(() => {
  window.addEventListener('message', messageListener);
  void window.tooldeskShortcut?.getAppVersion?.().then((version) => {
    appVersion.value = String(version ?? '').trim();
    void nextTick(postLaunchContext);
  });
  if (!window.tooldeskShortcut?.getAppVersion) {
    void nextTick(postLaunchContext);
  }

  if (isTaskbarCalendarPopup) {
    stopTaskbarCalendarPopupOpenedListener = window.tooldeskShortcut?.onTaskbarCalendarPopupOpened?.(() => {
      resetTaskbarCalendarToToday();
    });
  }
});

watch(
  () => props.shortcutContentVersion,
  () => postLaunchContext()
);

onBeforeUnmount(() => {
  window.removeEventListener('message', messageListener);
  stopTaskbarCalendarPopupOpenedListener?.();
  stopPluginMemoryReporter?.();
  for (const unsubscribe of pluginSubscriptions.values()) {
    unsubscribe();
  }
  pluginSubscriptions.clear();
});
</script>

<template>
  <div class="tool-content tool-fill-content plugin-tool-host" :class="{ 'plugin-chrome-hidden': isPluginChromeHidden }">
    <p v-if="hostCompatibilityWarning" class="plugin-host-warning">{{ hostCompatibilityWarning }}</p>
    <p v-if="pluginSdkError" class="plugin-host-warning">{{ pluginSdkError }}</p>
    <iframe
      v-if="pluginEntryUrl"
      ref="frameRef"
      class="plugin-tool-frame"
      :src="pluginEntryUrl"
      :title="tool.label"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
      @load="handleFrameLoad"
    />
  </div>
</template>

<style scoped>
.plugin-tool-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0;
}

.plugin-host-warning {
  background: #fff7ed;
  border-bottom: 1px solid #fed7aa;
  color: #9a3412;
  font-size: 12px;
  font-weight: 700;
  margin: 0;
  padding: 8px 12px;
}

.plugin-tool-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
  background: #ffffff;
}
</style>
