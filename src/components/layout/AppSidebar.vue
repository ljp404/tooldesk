<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue';
import type { CategoryItem, CategoryKey, MainView } from '../../types/toolbox';

type SidebarIcon = 'all' | 'calendar' | 'calculator' | 'code' | 'document' | 'image' | 'text';

defineProps<{
  activeCategory: CategoryKey;
  activeView: MainView;
  categories: CategoryItem[];
}>();

defineEmits<{
  selectCategory: [category: CategoryKey];
}>();

function getCategoryIcon(category: CategoryItem): SidebarIcon {
  const icons: Record<CategoryKey, SidebarIcon> = {
    all: 'all',
    dev: 'code',
    document: 'document',
    finance: 'calculator',
    image: 'image',
    life: 'calendar',
    text: 'text'
  };

  return icons[category.key];
}
</script>

<template>
  <aside class="sidebar">
    <div class="category-block">
      <div class="block-title">
        <span>工具分类</span>
      </div>
      <nav class="category-nav" aria-label="工具分类">
        <button
          v-for="category in categories"
          :key="category.key"
          class="category-item"
          :class="{ active: activeCategory === category.key && activeView === 'all' }"
          type="button"
          @click="$emit('selectCategory', category.key)"
        >
          <AppIcon class="sidebar-icon" :name="getCategoryIcon(category)" />
          {{ category.label }}
        </button>
      </nav>
    </div>
  </aside>
</template>
