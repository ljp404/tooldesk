<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import ToolIcon from '../ui/ToolIcon.vue';
import WindowControls from './WindowControls.vue';
import { getAppRuntime } from '../../utils/platform';

defineProps<{
  title: string;
  iconName: string;
  accent?: string;
}>();

const isPinned = ref(false);
const isDesktopWindow = getAppRuntime() === 'tauri';

async function togglePin() {
  isPinned.value = !isPinned.value;
  await window.tooldeskShortcut?.setWindowPinned(isPinned.value);
}

onMounted(async () => {
  if (!window.tooldeskShortcut) {
    return;
  }

  void window.tooldeskShortcut.isWindowPinned().then((value) => {
    isPinned.value = value;
  });
});
</script>

<template>
  <header v-if="isDesktopWindow" class="tool-window-topbar">
    <div class="tool-window-drag-region">
      <ToolIcon :accent="accent" :icon="iconName" />
      <span class="tool-window-title">{{ title }}</span>
    </div>

    <div class="tool-window-actions">
      <button
        class="icon-button"
        type="button"
        :class="{ active: isPinned }"
        :aria-label="isPinned ? '取消固定' : '固定窗口'"
        :title="isPinned ? '取消固定：关闭置顶，打开其他工具时可能被关闭' : '固定窗口：置顶显示，打开其他工具时保留'"
        @click="togglePin"
      >
        <AppIcon name="pin" />
      </button>
    </div>

    <WindowControls />
  </header>
</template>
