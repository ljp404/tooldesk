<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolPanel from '../../components/toolbox/ToolPanel.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import { useInitialToolContent } from '../../composables/useInitialToolContent';
import { translateLanguages } from './languages';
import { translateText } from './translateClient';
import './translatorTool.css';

const props = defineProps<{
  shortcutContent?: string;
  shortcutContentVersion?: number;
}>();

const sourceText = ref('');
const targetText = ref('');
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null);
const sourceLanguage = ref('auto');
const targetLanguage = ref('zh-CN');
const isTranslating = ref(false);
const translateError = ref('');
let translateRequestId = 0;
let autoTranslateTimer: number | undefined;

const canTranslate = computed(() => sourceText.value.trim().length > 0);

function acceptsShortcutContent(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 5000) {
    return false;
  }

  if (/^\d{10,13}$/.test(trimmed)) {
    return false;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  return /[\u4e00-\u9fffA-Za-z]/.test(trimmed);
}

useInitialToolContent({
  accepts: acceptsShortcutContent,
  apply: (content) => {
    sourceText.value = content;
    targetText.value = '';
    translateError.value = '';
  },
  shortcutContent: () => props.shortcutContent,
  shortcutContentVersion: () => props.shortcutContentVersion
});

function swapLanguages() {
  if (sourceLanguage.value === 'auto') {
    sourceLanguage.value = targetLanguage.value;
    targetLanguage.value = 'en';
  } else {
    const previousSource = sourceLanguage.value;
    sourceLanguage.value = targetLanguage.value;
    targetLanguage.value = previousSource;
  }

  if (targetText.value.trim()) {
    sourceText.value = targetText.value;
    targetText.value = '';
  }
}

async function runTranslate() {
  if (!canTranslate.value) {
    translateRequestId += 1;
    isTranslating.value = false;
    targetText.value = '';
    translateError.value = '';
    return;
  }

  const requestId = translateRequestId + 1;
  translateRequestId = requestId;
  isTranslating.value = true;
  translateError.value = '';
  const text = sourceText.value;
  const from = sourceLanguage.value;
  const to = targetLanguage.value;

  try {
    const translatedText = await translateText({
      from,
      text,
      to
    });

    if (requestId !== translateRequestId) {
      return;
    }

    targetText.value = translatedText;
  } catch (error) {
    if (requestId !== translateRequestId) {
      return;
    }

    translateError.value = error instanceof Error ? error.message : '翻译失败';
    targetText.value = '';
  } finally {
    if (requestId === translateRequestId) {
      isTranslating.value = false;
    }
  }
}

function scheduleAutoTranslate() {
  if (autoTranslateTimer) {
    window.clearTimeout(autoTranslateTimer);
    autoTranslateTimer = undefined;
  }

  if (!sourceText.value.trim()) {
    translateRequestId += 1;
    isTranslating.value = false;
    targetText.value = '';
    translateError.value = '';
    return;
  }

  translateError.value = '';
  autoTranslateTimer = window.setTimeout(() => {
    autoTranslateTimer = undefined;
    void runTranslate();
  }, 500);
}

function clearAll() {
  if (autoTranslateTimer) {
    window.clearTimeout(autoTranslateTimer);
    autoTranslateTimer = undefined;
  }

  translateRequestId += 1;
  isTranslating.value = false;
  sourceText.value = '';
  targetText.value = '';
  translateError.value = '';
}

watch([sourceText, sourceLanguage, targetLanguage], scheduleAutoTranslate);

onMounted(() => {
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      sourceTextareaRef.value?.focus({ preventScroll: true });
    });
  });
});

onBeforeUnmount(() => {
  if (autoTranslateTimer) {
    window.clearTimeout(autoTranslateTimer);
  }
});
</script>

<template>
  <ToolPanel class="translator-panel" fill>
    <div class="tool-content translator-layout">
      <div class="translator-toolbar">
        <label class="translator-lang-field">
          <span>源语言</span>
          <select v-model="sourceLanguage">
            <option v-for="language in translateLanguages" :key="`from-${language.code}`" :value="language.code">
              {{ language.label }}
            </option>
          </select>
        </label>

        <button class="translator-swap-button" type="button" title="交换语言" aria-label="交换语言" @click="swapLanguages">
          <AppIcon name="translate-swap" />
        </button>

        <label class="translator-lang-field">
          <span>目标语言</span>
          <select v-model="targetLanguage">
            <option
              v-for="language in translateLanguages.filter((item) => item.code !== 'auto')"
              :key="`to-${language.code}`"
              :value="language.code"
            >
              {{ language.label }}
            </option>
          </select>
        </label>
      </div>

      <div class="translator-columns">
        <section class="translator-card">
          <div class="translator-input-wrap">
            <textarea
              ref="sourceTextareaRef"
              v-model="sourceText"
              spellcheck="false"
              placeholder="输入或粘贴要翻译的文本"
              @keydown.ctrl.enter.prevent="runTranslate"
              @keydown.meta.enter.prevent="runTranslate"
            />
            <button
              v-if="sourceText"
              class="translator-clear-button"
              type="button"
              title="清空"
              aria-label="清空"
              @click="clearAll"
            >
              ×
            </button>
          </div>
        </section>

        <section class="translator-card">
          <textarea
            v-model="targetText"
            spellcheck="false"
            readonly
            :placeholder="isTranslating ? '正在翻译…' : '翻译结果将显示在这里'"
          />
          <p v-if="translateError" class="translator-error" role="alert">{{ translateError }}</p>
        </section>
      </div>
    </div>
  </ToolPanel>
</template>
