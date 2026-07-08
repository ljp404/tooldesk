<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import ToolPanel from '../../components/toolbox/ToolPanel.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import { useClipboardCopy } from '../../composables/useClipboardCopy';
import type { ScreenshotCaptureResult } from '../../types/screenshot';
import './screenshotTool.css';
import {
  copyLastScreenshot,
  getLastScreenshot,
  isScrollScreenshotSupported,
  isScreenshotSupported,
  onScreenshotCaptured,
  pinScreenshot,
  recognizeScreenshotText,
  saveScreenshotAs,
  startScrollScreenshot,
  startScreenshot
} from '../../utils/screenshotClient';

const screenshotIcon = new URL('./assets/icon.svg', import.meta.url).href;

const supported = isScreenshotSupported();
const scrollCaptureSupported = isScrollScreenshotSupported();
const capturing = ref(false);
const ocrLoading = ref(false);
const statusMessage = ref('');
const ocrText = ref('');
const lastCapture = ref<ScreenshotCaptureResult | null>(null);
const { copyStatus, copyText } = useClipboardCopy();

let stopCaptureListener: (() => void) | undefined;

function setStatus(message: string) {
  statusMessage.value = message;
}

function resetOcrState() {
  ocrText.value = '';
  ocrLoading.value = false;
}

function extractImageBase64(dataUrl: string) {
  const index = dataUrl.indexOf(',');

  return index >= 0 ? dataUrl.slice(index + 1) : dataUrl;
}

async function handleStartCapture() {
  if (!supported || capturing.value) {
    return;
  }

  capturing.value = true;
  resetOcrState();
  setStatus('请框选屏幕区域…');

  try {
    await startScreenshot();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '截图失败');
    capturing.value = false;
  }
}

function applyCapture(result: ScreenshotCaptureResult | null) {
  capturing.value = false;

  if (!result) {
    setStatus('已取消截图');
    return;
  }

  resetOcrState();
  lastCapture.value = result;
  setStatus('截图完成，可使用下方图标操作');
}

function clearCapture() {
  lastCapture.value = null;
  resetOcrState();
  setStatus('已关闭预览');
}

async function handleCopyImage() {
  if (!lastCapture.value) {
    return;
  }

  const copied = await copyLastScreenshot().catch(() => false);

  if (copied) {
    setStatus('图片已复制到剪贴板');
    return;
  }

  if (lastCapture.value.dataUrl) {
    await copyText(lastCapture.value.dataUrl, '复制失败，请重试');
  }
}

async function handleDownload() {
  if (!lastCapture.value) {
    return;
  }

  const filePath = await saveScreenshotAs(lastCapture.value);

  if (filePath) {
    setStatus(`已保存：${filePath}`);
    lastCapture.value = { ...lastCapture.value, filePath };
    return;
  }

  setStatus('已取消保存');
}

function handlePin() {
  if (!lastCapture.value) {
    return;
  }

  void pinScreenshot(lastCapture.value).then((ok) => {
    setStatus(ok ? '已贴图到桌面' : '贴图失败');
  });
}

function openScreenRecorder() {
  void window.tooldeskShortcut?.openQuickTool('screen-recorder', '', true);
}

async function handleScrollCapture() {
  if (!supported || capturing.value) {
    return;
  }

  setStatus('滚动截图已触发，请在截图选区工具栏继续操作');

  try {
    const result = await startScrollScreenshot();
    setStatus(result.message ?? '滚动截图已触发');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '滚动截图启动失败');
  }
}

async function handleOcr() {
  if (!lastCapture.value || ocrLoading.value) {
    return;
  }

  ocrLoading.value = true;
  ocrText.value = '';
  setStatus('正在识别文字…');

  try {
    const result = await recognizeScreenshotText({
      imageBase64: extractImageBase64(lastCapture.value.dataUrl),
      imagePath: lastCapture.value.filePath
    });
    const text = result.rawText?.trim() || result.lines.join('\n').trim();

    ocrText.value = text;
    setStatus(text ? '文字识别完成，可复制下方结果' : '未识别到文字');
  } catch (error) {
    ocrText.value = '';
    setStatus(error instanceof Error ? error.message : '文字识别失败');
  } finally {
    ocrLoading.value = false;
  }
}

async function handleCopyOcrText() {
  if (!ocrText.value) {
    return;
  }

  await copyText(ocrText.value, '复制失败，请重试');
}

onMounted(() => {
  void getLastScreenshot().then((result) => {
    if (result) {
      lastCapture.value = result;
      setStatus('已加载最近一次截图');
    }
  });

  stopCaptureListener = onScreenshotCaptured(applyCapture);
});

onBeforeUnmount(() => {
  stopCaptureListener?.();
  lastCapture.value = null;
  resetOcrState();
});
</script>

<template>
  <ToolPanel fill>
    <div class="tool-content tool-fill-content screenshot-tool">
      <header class="screenshot-tool-head">
        <div class="screenshot-tool-head-main">
          <div class="screenshot-tool-hero-icon" aria-hidden="true">
            <AppIcon :name="screenshotIcon" />
          </div>
          <div>
            <h2>截图</h2>
            <p>框选后点击「文字识别」进行 OCR（百度 API，需在设置中配置 Key）。</p>
          </div>
        </div>
        <div class="screenshot-tool-head-actions">
          <button
            class="tool-primary-button screenshot-tool-start"
            type="button"
            :disabled="!supported || capturing"
            @click="handleStartCapture"
          >
            {{ capturing ? '正在截图…' : '开始截图' }}
          </button>
          <button
            class="screenshot-tool-icon-btn"
            type="button"
            title="录屏"
            aria-label="录屏"
            @click="openScreenRecorder"
          >
            <AppIcon name="record" />
          </button>
          <button
            v-if="scrollCaptureSupported"
            class="screenshot-tool-icon-btn"
            type="button"
            title="滚动截图"
            aria-label="滚动截图"
            :disabled="capturing"
            @click="handleScrollCapture"
          >
            <AppIcon name="scroll-capture" />
          </button>
        </div>
      </header>

      <p v-if="!supported" class="screenshot-tool-warning">请在 tooldesk 桌面客户端中使用截图功能。</p>

      <div class="screenshot-tool-board">
        <div v-if="statusMessage || copyStatus" class="screenshot-tool-board-status">
          <p v-if="statusMessage" class="screenshot-tool-status">{{ statusMessage }}</p>
          <span v-if="copyStatus" class="tool-copy-toast inline" role="status">{{ copyStatus }}</span>
        </div>

        <div v-if="lastCapture" class="screenshot-tool-preview">
          <div class="screenshot-tool-preview-meta">
            <span>{{ lastCapture.width }} × {{ lastCapture.height }}</span>
            <span>{{ new Date(lastCapture.capturedAt).toLocaleString() }}</span>
          </div>
          <div class="screenshot-tool-preview-frame">
            <img :src="lastCapture.dataUrl" alt="最近一次截图预览" />
          </div>
          <div class="screenshot-tool-icon-bar" role="toolbar" aria-label="截图操作">
            <button class="screenshot-tool-icon-btn" type="button" title="关闭" aria-label="关闭" @click="clearCapture">
              <AppIcon name="close" />
            </button>
            <button class="screenshot-tool-icon-btn" type="button" title="下载" aria-label="下载" @click="handleDownload">
              <AppIcon name="download" />
            </button>
            <button class="screenshot-tool-icon-btn" type="button" title="复制" aria-label="复制" @click="handleCopyImage">
              <AppIcon name="copy" />
            </button>
            <button class="screenshot-tool-icon-btn" type="button" title="贴图" aria-label="贴图" @click="handlePin">
              <AppIcon name="pin" />
            </button>
            <button
              class="screenshot-tool-icon-btn screenshot-tool-ocr"
              type="button"
              title="文字识别"
              aria-label="文字识别"
              :disabled="ocrLoading"
              @click="handleOcr"
            >
              <AppIcon name="ocr" />
            </button>
          </div>
          <div v-if="ocrLoading || ocrText" class="screenshot-tool-ocr-panel">
            <div class="screenshot-tool-ocr-head">
              <strong>识别结果</strong>
              <button
                v-if="ocrText"
                class="screenshot-tool-ocr-copy"
                type="button"
                @click="handleCopyOcrText"
              >
                复制文字
              </button>
            </div>
            <p v-if="ocrLoading" class="screenshot-tool-ocr-loading">正在识别…</p>
            <pre v-else class="screenshot-tool-ocr-text">{{ ocrText }}</pre>
          </div>
        </div>

        <div v-else class="screenshot-tool-empty">
          <AppIcon :name="screenshotIcon" />
          <strong>暂无截图</strong>
          <p>点击「开始截图」或按全局快捷键框选区域</p>
        </div>
      </div>
    </div>
  </ToolPanel>
</template>
