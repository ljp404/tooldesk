<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue';
import ToolIcon from '../ui/ToolIcon.vue';
import type { MainView, ToolGroup, ToolItem, ToolKey } from '../../types/toolbox';

defineProps<{
  activeView: MainView;
  favoriteTools: ToolKey[];
  filteredToolCount: number;
  groups: ToolGroup[];
}>();

defineEmits<{
  openTool: [tool: ToolItem];
  setView: [view: MainView];
  toggleFavorite: [tool: ToolItem];
}>();
</script>

<template>
  <section class="tool-home">
    <div class="home-toolbar">
      <div class="content-tabs">
        <button :class="{ active: activeView === 'all' }" type="button" @click="$emit('setView', 'all')">
          全部工具
        </button>
        <button :class="{ active: activeView === 'recent' }" type="button" @click="$emit('setView', 'recent')">
          最近使用
        </button>
        <button :class="{ active: activeView === 'favorites' }" type="button" @click="$emit('setView', 'favorites')">
          我的收藏
        </button>
      </div>

      <div class="sort-row">
        <span>{{ filteredToolCount }} 个工具</span>
      </div>
    </div>

    <template v-if="groups.length > 0">
      <section v-for="group in groups" :key="group.category.key" class="tool-section">
        <h2>{{ group.category.label }}</h2>
        <div class="tool-grid">
          <article v-for="tool in group.tools" :key="tool.key" class="tool-card">
            <button
              class="favorite-button"
              :class="{ active: favoriteTools.includes(tool.key) }"
              type="button"
              :aria-label="favoriteTools.includes(tool.key) ? `取消收藏 ${tool.label}` : `收藏 ${tool.label}`"
              :aria-pressed="favoriteTools.includes(tool.key)"
              @click="$emit('toggleFavorite', tool)"
            >
              <AppIcon :name="favoriteTools.includes(tool.key) ? 'favorite-filled' : 'favorite'" />
            </button>
            <button class="card-main" type="button" :aria-label="`打开 ${tool.label}`" @click="$emit('openTool', tool)">
              <ToolIcon :accent="tool.accent" :icon="tool.icon" />
              <span>
                <strong>{{ tool.label }}</strong>
                <small>{{ tool.caption }}</small>
              </span>
            </button>
          </article>
        </div>
      </section>
    </template>

    <p v-else class="empty-state">没有匹配的工具。</p>
  </section>
</template>
