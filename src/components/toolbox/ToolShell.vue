<script setup lang="ts">
defineProps<{
  breadcrumbHidden?: boolean;
  categoryLabel: string;
  chromeHidden?: boolean;
  showBreadcrumb?: boolean;
  toolLabel: string;
}>();

defineEmits<{
  back: [];
}>();
</script>

<template>
  <section
    class="tool-detail"
    :class="{ 'tool-breadcrumb-hidden': breadcrumbHidden, 'tool-chrome-hidden': chromeHidden }"
  >
    <nav v-if="showBreadcrumb" class="tool-breadcrumb" aria-label="工具路径">
      <button class="tool-breadcrumb-link" type="button" @click="$emit('back')">{{ categoryLabel }}</button>
      <span class="tool-breadcrumb-separator" aria-hidden="true">›</span>
      <span class="tool-breadcrumb-current">{{ toolLabel }}</span>
    </nav>

    <slot />
  </section>
</template>
