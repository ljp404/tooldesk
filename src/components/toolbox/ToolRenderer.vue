<script setup lang="ts">
import { computed } from 'vue';
import { toolViewRegistry } from '../../tools';
import type { ToolItem, ToolKey } from '../../types/toolbox';
import PluginToolHost from './PluginToolHost.vue';

const props = withDefaults(
  defineProps<{
    shortcutContent?: string;
    shortcutContentVersion?: number;
    toolClass?: string | Record<string, boolean>;
    toolKey: ToolKey;
    tool?: ToolItem;
  }>(),
  {
    shortcutContent: '',
    shortcutContentVersion: 0,
    toolClass: '',
    tool: undefined
  }
);

defineEmits<{
  'chrome-hidden-change': [hidden: boolean];
}>();

const activeRegistration = computed(() => toolViewRegistry[props.toolKey]);
const pluginTool = computed(() => (props.tool?.key === props.toolKey && props.tool.source === 'plugin' ? props.tool : undefined));
</script>

<template>
  <component
    :is="activeRegistration.component"
    v-if="activeRegistration?.acceptsShortcutContent"
    :class="toolClass"
    :shortcut-content="shortcutContent"
    :shortcut-content-version="shortcutContentVersion"
  />
  <component
    :is="activeRegistration.component"
    v-else-if="activeRegistration"
    :class="toolClass"
  />
  <PluginToolHost
    v-else-if="pluginTool"
    :class="toolClass"
    :shortcut-content="shortcutContent"
    :shortcut-content-version="shortcutContentVersion"
    :tool="pluginTool"
    @chrome-hidden-change="$emit('chrome-hidden-change', $event)"
  />
</template>
