<script setup lang="ts">
import { useWindowControls } from '../../composables/useWindowControls';

const { closeWindow, isMaximized, minimizeWindow, toggleMaximizeWindow } = useWindowControls();
</script>

<template>
  <div class="window-controls" aria-label="窗口控制">
    <button class="window-control" type="button" aria-label="最小化" @click="minimizeWindow">
      <span class="window-control-icon minimize" aria-hidden="true"></span>
    </button>
    <button
      class="window-control"
      type="button"
      :aria-label="isMaximized ? '还原' : '最大化'"
      @click="toggleMaximizeWindow"
    >
      <span class="window-control-icon" :class="isMaximized ? 'restore' : 'maximize'" aria-hidden="true"></span>
    </button>
    <button class="window-control close" type="button" aria-label="关闭" @click="closeWindow">
      <span class="window-control-icon close" aria-hidden="true"></span>
    </button>
  </div>
</template>
