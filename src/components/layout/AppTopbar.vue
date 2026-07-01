<script setup lang="ts">
import { ref } from 'vue';
import logoUrl from '../../assets/logo.png';
import AppIcon from '../ui/AppIcon.vue';
import WindowControls from './WindowControls.vue';
import type { MainView, ThemeMode, ToolItem } from '../../types/toolbox';
import { getAppRuntime } from '../../utils/platform';

defineProps<{
  activeSearchIndex: number;
  searchOpen: boolean;
  searchResults: ToolItem[];
  searchText: string;
  theme: ThemeMode;
}>();

const emit = defineEmits<{
  clearSearch: [];
  openSettings: [];
  openSearchResult: [tool: ToolItem];
  searchBlur: [];
  searchFocus: [];
  searchKeydown: [event: KeyboardEvent];
  'update:searchText': [value: string];
  setView: [view: MainView];
  toggleTheme: [];
}>();

const searchInput = ref<HTMLInputElement | null>(null);
const isDesktopWindow = getAppRuntime() === 'tauri';

function focusSearch() {
  searchInput.value?.focus();
}

function handleSearchFocusOut() {
  window.setTimeout(() => {
    if (!searchInput.value?.closest('.search-box')?.contains(document.activeElement)) {
      emit('searchBlur');
    }
  }, 0);
}

defineExpose({ focusSearch });
</script>

<template>
  <header class="topbar" :class="{ 'has-window-controls': isDesktopWindow }">
    <div class="brand">
      <img class="brand-icon" :src="logoUrl" alt="" />
      <div>
        <h1>tooldesk</h1>
      </div>
    </div>

    <label class="search-box" @focusout="handleSearchFocusOut">
      <span>搜索工具</span>
      <AppIcon class="search-icon" name="search" />
      <input
        ref="searchInput"
        :value="searchText"
        type="search"
        placeholder="搜索工具"
        @focus="$emit('searchFocus')"
        @input="$emit('update:searchText', ($event.target as HTMLInputElement).value)"
        @keydown="$emit('searchKeydown', $event)"
      />

      <div v-if="searchOpen" class="global-search-panel">
        <div v-if="searchResults.length > 0" class="global-search-list" role="listbox">
          <button
            v-for="(tool, index) in searchResults"
            :key="tool.key"
            class="global-search-item"
            :class="{ active: index === activeSearchIndex }"
            type="button"
            role="option"
            :aria-selected="index === activeSearchIndex"
            @mousedown.prevent
            @click="$emit('openSearchResult', tool)"
          >
            <span class="global-search-icon" :class="tool.accent" aria-hidden="true">
              <AppIcon :name="tool.icon" />
            </span>
            <span class="global-search-copy">
              <strong>{{ tool.label }}</strong>
              <small>{{ tool.caption }}</small>
            </span>
            <kbd v-if="tool.defaultAlias">{{ tool.defaultAlias }}</kbd>
          </button>
        </div>
        <div v-else class="global-search-empty">
          <span>没有匹配的工具</span>
          <button type="button" @mousedown.prevent @click="$emit('clearSearch')">清空</button>
        </div>
      </div>
    </label>

    <div class="top-actions">
      <button class="icon-button" type="button" aria-label="打开扩展中心" title="扩展中心" @click="$emit('setView', 'extensions')">
        <AppIcon name="toolbox" />
      </button>
      <button class="icon-button" type="button" aria-label="查看我的收藏" @click="$emit('setView', 'favorites')">
        <AppIcon name="favorite" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="theme === 'dark' ? '切换浅色主题' : '切换深色主题'"
        @click="$emit('toggleTheme')"
      >
        <AppIcon :name="theme === 'dark' ? 'moon' : 'sun'" />
      </button>
      <button class="icon-button" type="button" aria-label="打开设置" @click.stop="$emit('openSettings')">
        <AppIcon name="settings" />
      </button>
    </div>

    <WindowControls v-if="isDesktopWindow" />
  </header>
</template>
