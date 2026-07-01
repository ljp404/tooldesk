<script setup lang="ts">
import type { ToolItem } from '../../types/toolbox';
import ToolShell from './ToolShell.vue';

withDefaults(defineProps<{
  activeToolMeta: ToolItem;
  breadcrumbHidden?: boolean;
  categoryLabel: string;
  chromeHidden?: boolean;
  showBreadcrumb?: boolean;
}>(), {
  showBreadcrumb: true
});

defineEmits<{
  back: [];
}>();
</script>

<template>
  <ToolShell
    :category-label="categoryLabel"
    :breadcrumb-hidden="breadcrumbHidden"
    :chrome-hidden="chromeHidden"
    :show-breadcrumb="showBreadcrumb"
    :tool-label="activeToolMeta.label"
    @back="$emit('back')"
  >
    <slot />
  </ToolShell>
</template>
