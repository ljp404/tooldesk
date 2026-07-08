<script setup lang="ts">
/* eslint-disable vue/no-v-html -- highlightJson escapes user text before adding spans */
import { computed, ref } from 'vue';
import { highlightJson } from '../../utils/jsonHighlighter';

const props = defineProps<{
  value: string;
}>();

const scrollLeft = ref(0);
const scrollTop = ref(0);

const lineCount = computed(() => Math.max(1, props.value.split('\n').length));
const highlighted = computed(() => highlightJson(props.value));

function handleScroll(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  scrollLeft.value = target.scrollLeft;
  scrollTop.value = target.scrollTop;
}
</script>

<template>
  <div class="json-editor json-code-viewer">
    <div class="json-gutter" aria-hidden="true">
      <div class="json-gutter-inner" :style="{ transform: `translateY(-${scrollTop}px)` }">
        <span v-for="line in lineCount" :key="line">{{ line }}</span>
      </div>
    </div>
    <div class="json-code">
      <pre
        class="json-highlight"
        aria-hidden="true"
        :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }"
        v-html="highlighted"
      />
      <textarea
        :value="value"
        readonly
        spellcheck="false"
        wrap="off"
        tabindex="0"
        @scroll="handleScroll"
      />
    </div>
  </div>
</template>
