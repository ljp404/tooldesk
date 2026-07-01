<script setup lang="ts">
import { computed, ref } from 'vue';
import { highlightJson } from '../../utils/jsonHighlighter';

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    modelValue: string;
    placeholder?: string;
    readonly?: boolean;
  }>(),
  {
    disabled: false,
    placeholder: '',
    readonly: false
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const scrollLeft = ref(0);
const scrollTop = ref(0);

const highlighted = computed(() => highlightJson(props.modelValue));

function handleScroll(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  scrollLeft.value = target.scrollLeft;
  scrollTop.value = target.scrollTop;
}

function handleInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div class="json-code http-client-json-code">
    <pre
      class="json-highlight"
      aria-hidden="true"
      :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }"
      v-html="highlighted"
    />
    <textarea
      :value="modelValue"
      spellcheck="false"
      :readonly="readonly"
      :disabled="disabled"
      :placeholder="placeholder"
      @input="handleInput"
      @scroll="handleScroll"
    />
  </div>
</template>
