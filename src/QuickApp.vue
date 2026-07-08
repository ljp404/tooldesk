<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolShell from './components/toolbox/ToolShell.vue';
import ToolRenderer from './components/toolbox/ToolRenderer.vue';
import QuickLauncher from './components/quick/QuickLauncher.vue';
import ToolWindowTopbar from './components/layout/ToolWindowTopbar.vue';
import { useToolRegistry } from './composables/useToolRegistry';
import { getCategoryLabel } from './tools';
import type { ShortcutContentKind, ShortcutContentPayload, ToolItem } from './types/toolbox';
import { getAppRuntime } from './utils/platform';

type QuickViewKind = ShortcutContentKind | 'launcher';

const initialQuickKind = getInitialQuickKind();
const isLauncherWindow = initialQuickKind === 'launcher';
const quickKind = ref<QuickViewKind>(initialQuickKind);
const shortcutContent = ref('');
const shortcutContentVersion = ref(0);
let stopWindowStateListener: (() => void) | undefined;
let stopClipboardContentListener: (() => void) | undefined;
let quickWindowShown = false;
const { refreshPluginTools, tools } = useToolRegistry();

const isLauncherOpen = computed(() => quickKind.value === 'launcher');
const isCompactMode = computed(() => new URLSearchParams(window.location.search).get('compact') === '1');
const quickTool = computed(() => tools.value.find((tool) => tool.key === quickKind.value) ?? null);
const isToolMissing = computed(() => !isLauncherOpen.value && !quickTool.value);
const isTaskbarCalendarPopup = computed(() => isCompactMode.value && quickTool.value?.pluginId === 'tooldesk-calendar');
const quickInstance = computed(() => {
  const instance = new URLSearchParams(window.location.search).get('instance');
  return instance && Number(instance) > 1 ? instance : '';
});

const quickTitle = computed(() => {
  if (isLauncherOpen.value) {
    return 'tooldesk 搜索';
  }

  if (!quickTool.value) {
    return '组件未安装';
  }

  return quickInstance.value ? `${quickTool.value.label} (${quickInstance.value})` : quickTool.value.label;
});
const quickIconName = computed(() => quickTool.value?.windowIcon ?? quickTool.value?.icon ?? 'toolbox');
const quickAccent = computed(() => quickTool.value?.accent ?? 'blue');
const quickCategoryLabel = computed(() => (quickTool.value ? getCategoryLabel(quickTool.value.category) : ''));

watch(
  quickTitle,
  (title) => {
    document.title = title;
  },
  { immediate: true }
);

function applySavedTheme() {
  const savedTheme = localStorage.getItem('tooldesk-theme');
  document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light';
}

function getInitialQuickKind(): QuickViewKind {
  const quick = new URLSearchParams(window.location.search).get('quick');

  if (quick === 'launcher') {
    return 'launcher';
  }

  if (quick) {
    return quick as ShortcutContentKind;
  }

  return 'launcher';
}

function applyShortcutPayload(payload: ShortcutContentPayload) {
  if (payload.kind === 'launcher') {
    if (!isLauncherWindow) {
      return;
    }

    quickKind.value = 'launcher';
  } else if (tools.value.some((tool) => tool.key === payload.kind) || String(payload.kind).startsWith('plugin:')) {
    quickKind.value = payload.kind;
  }

  shortcutContent.value = payload.content;
  shortcutContentVersion.value = payload.triggeredAt;
}

function setWindowMaximizedState(maximized: boolean) {
  document.documentElement.dataset.windowMaximized = maximized ? 'true' : 'false';
}

function setQuickCompactState() {
  document.documentElement.dataset.quickCompact = isCompactMode.value ? 'true' : 'false';
}

function setQuickLauncherState() {
  document.documentElement.dataset.quickLauncher = isLauncherOpen.value ? 'true' : 'false';
}

function setTaskbarCalendarPopupState() {
  document.documentElement.dataset.taskbarCalendarPopup = isTaskbarCalendarPopup.value ? 'true' : 'false';
}

function openQuickTool(tool: ToolItem) {
  quickKind.value = tool.key;
  shortcutContent.value = '';
  shortcutContentVersion.value = Date.now();
  const query = new URLSearchParams({ quick: tool.key });
  window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
}

async function showQuickWindowWhenReady() {
  if (quickWindowShown || isCompactMode.value || isToolMissing.value) {
    return;
  }

  quickWindowShown = true;
  await nextTick();
  await window.tooldeskShortcut?.showCurrentWindow?.();
}

onMounted(() => {
  applySavedTheme();
  document.documentElement.dataset.desktopShell = getAppRuntime() === 'tauri' ? 'true' : 'false';
  document.documentElement.dataset.runtime = getAppRuntime();
  setQuickCompactState();
  setQuickLauncherState();
  setTaskbarCalendarPopupState();
  document.body.classList.add('quick-body');
  setWindowMaximizedState(false);
  window.addEventListener('storage', applySavedTheme);
  void Promise.all([
    refreshPluginTools(),
    window.tooldeskShortcut?.getLastContent().then((payload) => {
      if (payload) {
        applyShortcutPayload(payload);
      }
    })
  ]).finally(() => {
    if (isToolMissing.value) {
      void window.tooldeskShortcut?.closeCurrentWindow?.();
      return;
    }

    // Launcher is pre-warmed hidden; Rust shows it only when the shortcut opens it.
    if (!isLauncherWindow) {
      void showQuickWindowWhenReady();
    }
  });
  if (isLauncherWindow) {
    stopClipboardContentListener = window.tooldeskShortcut?.onClipboardContent(applyShortcutPayload);
  }
  void window.tooldeskShortcut?.isWindowMaximized().then(setWindowMaximizedState);
  stopWindowStateListener = window.tooldeskShortcut?.onWindowMaximizedChange(setWindowMaximizedState);
});

onBeforeUnmount(() => {
  document.body.classList.remove('quick-body');
  delete document.documentElement.dataset.quickCompact;
  delete document.documentElement.dataset.quickLauncher;
  delete document.documentElement.dataset.taskbarCalendarPopup;
  window.removeEventListener('storage', applySavedTheme);
  stopClipboardContentListener?.();
  stopWindowStateListener?.();
});

watch(isLauncherOpen, setQuickLauncherState);
watch(isTaskbarCalendarPopup, setTaskbarCalendarPopupState);
watch(isToolMissing, (missing) => {
  if (missing) {
    void window.tooldeskShortcut?.closeCurrentWindow?.();
  }
});
</script>

<template>
  <main
    class="quick-shell"
    :class="{ 'quick-shell-launcher': isLauncherOpen, 'quick-shell-compact': isCompactMode }"
    :aria-label="quickTitle"
  >
    <ToolWindowTopbar v-if="!isLauncherOpen && !isCompactMode" :title="quickTitle" :icon-name="quickIconName" :accent="quickAccent" />
    
    <QuickLauncher
      v-if="isLauncherOpen"
      :shortcut-content="shortcutContent"
      :shortcut-content-version="shortcutContentVersion"
      :tools="tools"
      @open-tool="openQuickTool"
    />

    <ToolRenderer
      v-else-if="isCompactMode && quickTool"
      :shortcut-content="shortcutContent"
      :shortcut-content-version="shortcutContentVersion"
      tool-class="quick-compact-tool"
      :tool-key="quickTool.key"
      :tool="quickTool"
    />

    <ToolShell v-else-if="quickTool" :category-label="quickCategoryLabel" :tool-label="quickTool.label">
      <ToolRenderer
        :shortcut-content="shortcutContent"
        :shortcut-content-version="shortcutContentVersion"
        tool-class="quick-tool-panel"
        :tool-key="quickTool.key"
        :tool="quickTool"
      />
    </ToolShell>
  </main>
</template>
