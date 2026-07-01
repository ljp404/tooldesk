<script setup lang="ts">
import { computed, useSlots } from 'vue';

defineProps<{
  copyStatus?: string;
  fill?: boolean;
}>();

const slots = useSlots();
const hasActions = computed(() => Boolean(slots.actions));
const hasStatus = computed(() => Boolean(slots.status));
</script>

<template>
  <section class="tool-panel" :class="{ 'tool-panel-fill': fill }">
    <div v-if="hasActions" class="tool-panel-head">
      <div class="tool-actions">
        <slot name="actions" />
      </div>
      <span v-if="copyStatus" class="tool-copy-toast" role="status">{{ copyStatus }}</span>
    </div>

    <slot />

    <div v-if="hasStatus" class="tool-statusbar">
      <slot name="status" />
    </div>
  </section>
</template>
