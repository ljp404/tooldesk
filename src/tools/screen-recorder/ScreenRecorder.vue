<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolPanel from '../../components/toolbox/ToolPanel.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import type { ScreenRecordingCropRect, ScreenRecordingFormat } from '../../types/screenRecorder';
import { getAppRuntime } from '../../utils/platform';
import { isScreenRecorderSupported, saveScreenRecording } from '../../utils/screenRecorderClient';
import './screenRecorder.css';

const recorderIcon = new URL('./assets/icon.svg', import.meta.url).href;

type RecorderState = 'idle' | 'recording' | 'paused' | 'ready' | 'saving';
interface StartRecordingOptions {
  allowOpenGuard?: boolean;
}

const props = withDefaults(
  defineProps<{
    shortcutContent?: string;
    shortcutContentVersion?: number;
  }>(),
  {
    shortcutContent: '',
    shortcutContentVersion: 0
  }
);

const compactMode = new URLSearchParams(window.location.search).get('compact') === '1';
const runtime = getAppRuntime();
const isTauriRuntime = runtime === 'tauri';
const supported = isScreenRecorderSupported();
const state = ref<RecorderState>('idle');
const format = ref<ScreenRecordingFormat>('mp4');
const includeAudio = ref(true);
const frameRate = ref(30);
const statusMessage = ref('');
const elapsedMs = ref(0);
const videoUrl = ref('');
const recordedBlob = ref<Blob | null>(null);
const savedFilePath = ref('');
const cropRect = ref<ScreenRecordingCropRect | null>(null);
const exportCropRect = ref<ScreenRecordingCropRect | null>(null);

let recorder: InstanceType<typeof window.MediaRecorder> | null = null;
let activeStream: Awaited<ReturnType<typeof window.navigator.mediaDevices.getDisplayMedia>> | null = null;
let sourceStream: Awaited<ReturnType<typeof window.navigator.mediaDevices.getDisplayMedia>> | null = null;
let chunks: Blob[] = [];
let startedAt = 0;
let accumulatedMs = 0;
let timerId: number | undefined;
let hasAutoStarted = false;
let compactOpenedAt = compactMode ? Date.now() : 0;
let cropFrameId = 0;
let regionRecordedDirectly = false;
let recordingSourceSize = { height: 0, width: 0 };

const canStart = computed(() => supported && (state.value === 'idle' || state.value === 'ready'));
const canPause = computed(() => state.value === 'recording' && recorder?.state === 'recording');
const canResume = computed(() => state.value === 'paused' && recorder?.state === 'paused');
const canSave = computed(() => Boolean(recordedBlob.value) && state.value !== 'recording' && state.value !== 'paused');
const formattedElapsed = computed(() => formatDuration(elapsedMs.value));
const cropSummary = computed(() => {
  if (!cropRect.value) {
    return '';
  }

  return `${Math.round(cropRect.value.width)} x ${Math.round(cropRect.value.height)}, ${Math.round(cropRect.value.x)}, ${Math.round(cropRect.value.y)}`;
});

function setStatus(message: string) {
  statusMessage.value = message;
}

function getRecorderMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  return candidates.find((candidate) => window.MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function parseRegionPayload(content: string) {
  try {
    const payload = JSON.parse(content) as {
      autoStart?: boolean;
      cropRect?: Partial<ScreenRecordingCropRect>;
      type?: string;
    };
    const rect = payload.cropRect;

    if (
      payload.type !== 'screen-recorder-region' ||
      typeof rect?.x !== 'number' ||
      typeof rect.y !== 'number' ||
      typeof rect.width !== 'number' ||
      typeof rect.height !== 'number'
    ) {
      return null;
    }

    return {
      autoStart: payload.autoStart === true,
      rect: {
        height: rect.height,
        width: rect.width,
        displayHeight: typeof rect.displayHeight === 'number' ? rect.displayHeight : undefined,
        displayWidth: typeof rect.displayWidth === 'number' ? rect.displayWidth : undefined,
        x: rect.x,
        y: rect.y
      }
    };
  } catch {
    return null;
  }
}

function applyShortcutRegion() {
  const payload = parseRegionPayload(props.shortcutContent);

  if (!payload) {
    return;
  }

  cropRect.value = payload.rect;
  setStatus('已带入截图选区，录制后会按该区域导出');

  if (payload.autoStart && compactMode && !hasAutoStarted) {
    hasAutoStarted = true;
    window.setTimeout(() => {
      void startRecording({ allowOpenGuard: true });
    }, 120);
  }
}

function formatDuration(value: number) {
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function syncElapsed() {
  if (state.value !== 'recording') {
    return;
  }

  elapsedMs.value = accumulatedMs + Date.now() - startedAt;
}

function startTimer() {
  window.clearInterval(timerId);
  startedAt = Date.now();
  timerId = window.setInterval(syncElapsed, 250);
}

function pauseTimer() {
  if (state.value === 'recording') {
    accumulatedMs += Date.now() - startedAt;
    elapsedMs.value = accumulatedMs;
  }

  window.clearInterval(timerId);
  timerId = undefined;
}

function resetRecording() {
  window.clearInterval(timerId);
  timerId = undefined;
  recorder = null;
  chunks = [];
  startedAt = 0;
  accumulatedMs = 0;
  recordingSourceSize = { height: 0, width: 0 };
  regionRecordedDirectly = false;
  elapsedMs.value = 0;
  recordedBlob.value = null;
  savedFilePath.value = '';
  exportCropRect.value = null;

  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value);
    videoUrl.value = '';
  }
}

function stopStream() {
  if (cropFrameId) {
    window.cancelAnimationFrame(cropFrameId);
    cropFrameId = 0;
  }

  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
  sourceStream?.getTracks().forEach((track) => track.stop());
  sourceStream = null;
}

function buildExportCropRect(stream: Awaited<ReturnType<typeof window.navigator.mediaDevices.getDisplayMedia>>) {
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const sourceWidth = Number(settings?.width ?? 0);
  const sourceHeight = Number(settings?.height ?? 0);

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return cropRect.value;
  }

  return computeExportCropRect(sourceWidth, sourceHeight);
}

function computeExportCropRect(sourceWidth: number, sourceHeight: number) {
  if (!cropRect.value || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const displayWidth = Number(cropRect.value.displayWidth ?? sourceWidth);
  const displayHeight = Number(cropRect.value.displayHeight ?? sourceHeight);
  const scaleX = displayWidth > 0 ? sourceWidth / displayWidth : 1;
  const scaleY = displayHeight > 0 ? sourceHeight / displayHeight : 1;
  const next = {
    height: Math.round(cropRect.value.height * scaleY),
    width: Math.round(cropRect.value.width * scaleX),
    x: Math.round(cropRect.value.x * scaleX),
    y: Math.round(cropRect.value.y * scaleY)
  };

  if (
    next.width < 10 ||
    next.height < 10 ||
    next.x < 0 ||
    next.y < 0 ||
    next.x + next.width > sourceWidth + 2 ||
    next.y + next.height > sourceHeight + 2
  ) {
    return null;
  }

  return {
    height: Math.min(next.height, sourceHeight - next.y),
    width: Math.min(next.width, sourceWidth - next.x),
    x: next.x,
    y: next.y
  };
}

async function resolveRecordingSourceSize(blob: Blob) {
  if (recordingSourceSize.width > 0 && recordingSourceSize.height > 0) {
    return recordingSourceSize;
  }

  return new Promise<{ height: number; width: number }>((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      URL.revokeObjectURL(url);
      resolve({ height, width });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ height: 0, width: 0 });
    };
    video.src = url;
  });
}

async function createRegionRecordingStream(
  stream: Awaited<ReturnType<typeof window.navigator.mediaDevices.getDisplayMedia>>,
  rect: ScreenRecordingCropRect
) {
  const width = Math.max(2, Math.floor(rect.width / 2) * 2);
  const height = Math.max(2, Math.floor(rect.height / 2) * 2);
  const canvas = document.createElement('canvas');
  const captureStream = canvas.captureStream?.bind(canvas);

  if (!captureStream) {
    return null;
  }

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: false });

  if (!context) {
    return null;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('区域录屏画面初始化失败'));
  });
  await video.play();

  const render = () => {
    if (!sourceStream) {
      cropFrameId = 0;
      return;
    }

    context.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
    cropFrameId = window.requestAnimationFrame(render);
  };

  render();

  const nextStream = captureStream(frameRate.value);

  for (const track of stream.getAudioTracks()) {
    nextStream.addTrack(track);
  }

  return {
    height,
    stream: nextStream,
    width
  };
}

async function startRecording(options: StartRecordingOptions = {}) {
  if (!supported) {
    return;
  }

  if (!options.allowOpenGuard && compactMode && Date.now() - compactOpenedAt < 500) {
    return;
  }

  if (!canStart.value) {
    console.warn('[screen-recorder] start blocked', { state: state.value, recorderState: recorder?.state ?? 'none' });

    if (state.value === 'saving') {
      setStatus('正在保存，请稍候');
      return;
    }

    setStatus('录屏状态异常，请先停止当前录制或关闭录屏窗口后重试');
    return;
  }

  resetRecording();
  setStatus('请选择要录制的屏幕或窗口');

  try {
    const shouldCaptureAudio = format.value === 'mp4' && includeAudio.value && !(compactMode && cropRect.value);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: shouldCaptureAudio,
      video: {
        cursor: 'never',
        frameRate: frameRate.value
      } as { cursor: 'never'; frameRate: number }
    });
    const mimeType = getRecorderMimeType();

    chunks = [];
    sourceStream = stream;
    exportCropRect.value = buildExportCropRect(stream);

    if (cropRect.value && !exportCropRect.value) {
      throw new Error('请选择截图选区所在的屏幕进行录制');
    }
    const settings = stream.getVideoTracks()[0]?.getSettings();
    recordingSourceSize = {
      height: Number(settings?.height ?? 0),
      width: Number(settings?.width ?? 0)
    };

    let recordingStream = stream;

    if (exportCropRect.value) {
      const regionStream = await createRegionRecordingStream(stream, exportCropRect.value);

      if (regionStream) {
        recordingStream = regionStream.stream;
        activeStream = recordingStream;
        exportCropRect.value = null;
        regionRecordedDirectly = true;
        recordingSourceSize = {
          height: regionStream.height,
          width: regionStream.width
        };
      } else {
        activeStream = stream;
      }
    } else {
      activeStream = stream;
    }

    recorder = new window.MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      void finalizeRecordingAfterStop();
    };
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (recorder?.state === 'recording' || recorder?.state === 'paused') {
        stopRecording();
      }
    });

    recorder.start(1000);
    state.value = 'recording';
    startTimer();
    void window.tooldeskShortcut?.notifyRegionRecordingCaptureStarted?.();
    setStatus(cropRect.value ? '区域录屏中，任务栏可暂停/停止，或按 Esc 结束' : '正在录制');
  } catch (error) {
    console.error('[screen-recorder] capture start failed', error);
    stopStream();
    state.value = 'idle';
    setStatus(error instanceof Error ? error.message : '录屏启动失败');
  }
}

function handleStartRecording() {
  void startRecording();
}

function pauseRecording() {
  if (!canPause.value) {
    return;
  }

  recorder?.pause();
  pauseTimer();
  state.value = 'paused';
  setStatus('录制已暂停');
}

function resumeRecording() {
  if (!canResume.value) {
    return;
  }

  recorder?.resume();
  state.value = 'recording';
  startTimer();
  setStatus(cropRect.value ? '区域录屏中，任务栏可暂停/停止，或按 Esc 结束' : '正在录制');
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') {
    console.warn('[screen-recorder] stop ignored', { state: state.value, recorderState: recorder?.state ?? 'none' });
    return;
  }

  pauseTimer();

  try {
    recorder.requestData();
  } catch {
    // ignore
  }

  recorder.stop();
  setStatus('正在整理录制内容');
}

async function finalizeRecordingAfterStop() {
  pauseTimer();
  stopStream();
  recordedBlob.value = new Blob(chunks, { type: 'video/webm' });
  videoUrl.value = URL.createObjectURL(recordedBlob.value);
  state.value = 'ready';
  setStatus('录制完成，可保存导出');

  if (compactMode && cropRect.value) {
    try {
      const sourceSize = await resolveRecordingSourceSize(recordedBlob.value);
      const playbackCropRect = regionRecordedDirectly
        ? { height: sourceSize.height, width: sourceSize.width, x: 0, y: 0 }
        : computeExportCropRect(sourceSize.width, sourceSize.height) ?? exportCropRect.value;

      if (
        !playbackCropRect ||
        sourceSize.width <= 0 ||
        sourceSize.height <= 0 ||
        recordedBlob.value.size <= 0
      ) {
        throw new Error('region playback unavailable');
      }

      const buffer = await recordedBlob.value.arrayBuffer();
      const playbackStarted = await window.tooldeskShortcut?.showRegionRecordingPlayback?.({
        buffer,
        cropRect: playbackCropRect,
        durationMs: elapsedMs.value,
        sourceHeight: sourceSize.height,
        sourceWidth: sourceSize.width
      });

      if (playbackStarted) {
        return;
      }
    } catch {
      // fall through to close frame
    }
  }

  void window.tooldeskShortcut?.closeScreenRecordingRegionFrame?.();
}

function getSerializableCropRect() {
  if (regionRecordedDirectly) {
    return undefined;
  }

  const rect = exportCropRect.value ?? cropRect.value;

  if (!rect) {
    return undefined;
  }

  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y
  };
}

async function handleSave() {
  if (!recordedBlob.value || state.value === 'saving') {
    return;
  }

  state.value = 'saving';
  setStatus(format.value === 'gif' ? '正在导出 GIF' : format.value === 'webm' ? '正在保存 WebM' : '正在导出 MP4');

  try {
    const result = await saveScreenRecording({
      buffer: await recordedBlob.value.arrayBuffer(),
      cropRect: getSerializableCropRect(),
      durationMs: elapsedMs.value,
      format: format.value
    });

    if (result.canceled) {
      state.value = 'ready';
      setStatus('已取消保存');
      return;
    }

    savedFilePath.value = result.filePath ?? '';
    state.value = 'ready';
    setStatus(result.filePath ? `已保存：${result.filePath}` : '保存完成');
  } catch (error) {
    state.value = 'ready';
    setStatus(error instanceof Error ? error.message : '导出失败');
  }
}

function openSavedFile() {
  if (!savedFilePath.value) {
    return;
  }

  void window.tooldeskShortcut?.showScreenRecordingInFolder?.(savedFilePath.value).then((shown) => {
    if (!shown) {
      setStatus('未找到已保存的视频文件，请重新导出');
      savedFilePath.value = '';
    }
  });
}

function closeCompactWindow() {
  void window.tooldeskShortcut?.closeCurrentWindow();
}

let compactToolbarDragging = false;
let compactToolbarDragLastX = 0;
let compactToolbarDragLastY = 0;

function onCompactToolbarDragMove(event: MouseEvent) {
  if (!compactToolbarDragging) {
    return;
  }

  const deltaX = event.screenX - compactToolbarDragLastX;
  const deltaY = event.screenY - compactToolbarDragLastY;

  if (deltaX === 0 && deltaY === 0) {
    return;
  }

  compactToolbarDragLastX = event.screenX;
  compactToolbarDragLastY = event.screenY;
  void window.tooldeskShortcut?.moveCurrentWindowBy?.({ x: deltaX, y: deltaY });
}

function endCompactToolbarDrag() {
  if (!compactToolbarDragging) {
    return;
  }

  compactToolbarDragging = false;
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', onCompactToolbarDragMove);
  window.removeEventListener('mouseup', endCompactToolbarDrag);
}

function beginCompactToolbarDrag(event: MouseEvent) {
  if (!compactMode || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  compactToolbarDragging = true;
  compactToolbarDragLastX = event.screenX;
  compactToolbarDragLastY = event.screenY;
  document.body.style.cursor = 'grabbing';
  window.addEventListener('mousemove', onCompactToolbarDragMove);
  window.addEventListener('mouseup', endCompactToolbarDrag);
}

async function fitCompactWindow() {
  if (!compactMode) {
    return;
  }

  await nextTick();
  const bar = document.querySelector('.screen-recorder-compact-bar');

  if (!(bar instanceof HTMLElement)) {
    return;
  }

  const contentWidth = Math.max(bar.scrollWidth, Math.ceil(bar.getBoundingClientRect().width)) + 2;

  void window.tooldeskShortcut?.fitCurrentWindow?.({
    height: 48,
    width: Math.ceil(contentWidth)
  });
}

let stopRegionControlListener: (() => void) | undefined;

onMounted(() => {
  void fitCompactWindow();
  window.setTimeout(() => void fitCompactWindow(), 80);

  stopRegionControlListener = window.tooldeskShortcut?.onRegionRecordingControl?.((action) => {
    if (action === 'stop') {
      stopRecording();
      return;
    }

    if (action === 'toggle-pause') {
      if (canPause.value) {
        pauseRecording();
      } else if (canResume.value) {
        resumeRecording();
      }
    }
  });
});

onBeforeUnmount(() => {
  stopRegionControlListener?.();
  stopRegionControlListener = undefined;
  endCompactToolbarDrag();

  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }

  stopStream();
  void window.tooldeskShortcut?.closeScreenRecordingRegionFrame?.();
  resetRecording();
});

watch(
  () => props.shortcutContentVersion,
  () => applyShortcutRegion(),
  { immediate: true }
);

watch(format, (nextFormat) => {
  if (nextFormat === 'gif') {
    includeAudio.value = false;
  }
});
</script>

<template>
  <ToolPanel fill>
    <div
      class="tool-content tool-fill-content screen-recorder-tool"
      :class="{ 'screen-recorder-compact': compactMode }"
    >
      <template v-if="compactMode">
        <div class="screen-recorder-compact-bar">
          <button
            class="screen-recorder-icon-btn screen-recorder-toolbar-drag-handle"
            type="button"
            title="拖动工具栏"
            aria-label="拖动工具栏"
            @mousedown="beginCompactToolbarDrag"
          >
            <svg class="screen-recorder-drag-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M11 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
              />
            </svg>
          </button>
          <div class="screen-recorder-compact-main">
            <div
              class="screen-recorder-timer"
              :class="{ active: state === 'recording' || state === 'paused' }"
            >
              <span aria-hidden="true"></span>
              {{ formattedElapsed }}
            </div>
          </div>
          <div class="screen-recorder-actions" role="toolbar" aria-label="录屏操作">
            <button class="screen-recorder-icon-btn primary" type="button" :disabled="!canStart" title="开始" aria-label="开始" @click="handleStartRecording">
              <AppIcon name="play" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canPause" title="暂停" aria-label="暂停" @click="pauseRecording">
              <AppIcon name="pause" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canResume" title="继续" aria-label="继续" @click="resumeRecording">
              <AppIcon name="play" />
            </button>
            <button class="screen-recorder-icon-btn danger" type="button" :disabled="state !== 'recording' && state !== 'paused'" title="停止" aria-label="停止" @click="stopRecording">
              <AppIcon name="stop" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canSave || state === 'saving'" title="保存" aria-label="保存" @click="handleSave">
              <AppIcon name="download" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!savedFilePath" title="打开文件" aria-label="打开文件" @click="openSavedFile">
              <AppIcon name="folder" />
            </button>
          </div>
          <div class="screen-recorder-window-actions" aria-label="窗口操作">
            <button class="screen-recorder-icon-btn close" type="button" title="关闭" aria-label="关闭" @click="closeCompactWindow">
              <AppIcon name="close" />
            </button>
          </div>
        </div>
      </template>

      <template v-else>
        <header class="screen-recorder-head">
          <div class="screen-recorder-title">
            <div class="screen-recorder-hero-icon" aria-hidden="true">
              <AppIcon name="record" />
            </div>
            <div>
              <h2>录屏</h2>
              <p>{{ isTauriRuntime ? '录制屏幕、窗口或应用画面，导出为 MP4、GIF 或 WebM。' : '录制屏幕、窗口或应用画面，导出为 MP4 或 GIF。' }}</p>
            </div>
          </div>
          <div class="screen-recorder-timer" :class="{ active: state === 'recording' }">
            <span aria-hidden="true"></span>
            {{ formattedElapsed }}
          </div>
        </header>

        <p v-if="!supported" class="screen-recorder-warning">请在 tooldesk 桌面客户端中使用录屏功能。</p>
        <div v-if="cropRect" class="screen-recorder-crop">
          <AppIcon name="screenshot" />
          <span>区域导出：{{ cropSummary }}</span>
          <button type="button" :disabled="state === 'recording' || state === 'paused' || state === 'saving'" @click="cropRect = null">
            取消区域
          </button>
        </div>

        <section class="screen-recorder-controls" aria-label="录屏控制">
          <div class="screen-recorder-options">
            <label>
              <span>导出格式</span>
              <select v-model="format" :disabled="state === 'recording' || state === 'paused' || state === 'saving'">
                <option value="mp4">MP4</option>
                <option value="gif">GIF</option>
                <option v-if="isTauriRuntime" value="webm">WebM</option>
              </select>
            </label>
            <label>
              <span>帧率</span>
              <input
                v-model.number="frameRate"
                type="number"
                min="10"
                max="60"
                step="5"
                :disabled="state === 'recording' || state === 'paused' || state === 'saving'"
              />
            </label>
            <label class="screen-recorder-checkbox">
              <input
                v-model="includeAudio"
                type="checkbox"
                :disabled="format === 'gif' || state === 'recording' || state === 'paused' || state === 'saving'"
              />
              <span>录制系统音频</span>
            </label>
          </div>

          <div class="screen-recorder-actions" role="toolbar" aria-label="录屏操作">
            <button class="tool-primary-button" type="button" :disabled="!canStart" @click="handleStartRecording">
              <AppIcon name="play" />
              开始录制
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canPause" title="暂停" aria-label="暂停" @click="pauseRecording">
              <AppIcon name="pause" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canResume" title="继续" aria-label="继续" @click="resumeRecording">
              <AppIcon name="play" />
            </button>
            <button class="screen-recorder-icon-btn danger" type="button" :disabled="state !== 'recording' && state !== 'paused'" title="停止" aria-label="停止" @click="stopRecording">
              <AppIcon name="stop" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!canSave || state === 'saving'" title="保存" aria-label="保存" @click="handleSave">
              <AppIcon name="download" />
            </button>
            <button class="screen-recorder-icon-btn" type="button" :disabled="!savedFilePath" title="打开文件" aria-label="打开文件" @click="openSavedFile">
              <AppIcon name="folder" />
            </button>
          </div>
        </section>

        <div class="screen-recorder-board">
          <div v-if="statusMessage" class="screen-recorder-status" role="status">{{ statusMessage }}</div>

          <div v-if="videoUrl" class="screen-recorder-preview">
            <video :src="videoUrl" controls />
          </div>
          <div v-else class="screen-recorder-empty">
            <AppIcon :name="recorderIcon" />
            <strong>等待录制</strong>
            <p>点击开始后选择屏幕、窗口或应用画面</p>
          </div>
        </div>
      </template>
    </div>
  </ToolPanel>
</template>
