<script setup lang="ts">
import AppIcon from './AppIcon.vue';

withDefaults(
  defineProps<{
    accent?: string;
    icon: string;
    size?: 'sm' | 'md';
  }>(),
  {
    accent: 'blue',
    size: 'md'
  }
);
</script>

<template>
  <span class="tool-ui-icon" :class="[accent, `tool-ui-icon-${size}`]" aria-hidden="true">
    <AppIcon :name="icon" />
  </span>
</template>
