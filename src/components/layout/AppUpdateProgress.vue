<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../ui/AppIcon.vue';

interface UpdateProgress {
  version?: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

const visible = ref(false);
const downloading = ref(false);
const completed = ref(false);
const installing = ref(false);
const progress = ref<UpdateProgress>({
  version: '',
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0
});

const displayVersion = computed(() => {
  const version = progress.value.version?.trim();

  if (!version) {
    return '';
  }

  return version.startsWith('v') ? version : `v${version}`;
});

const downloadSizeLabel = computed(() => {
  const downloaded = formatBytes(progress.value.downloadedBytes);

  if (progress.value.totalBytes > 0) {
    return `${downloaded} / ${formatBytes(progress.value.totalBytes)}`;
  }

  return `已下载 ${downloaded}`;
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function handleStart(data: { version: string }) {
  visible.value = true;
  downloading.value = true;
  completed.value = false;
  progress.value = {
    version: data.version,
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0
  };
}

function handleProgress(data: UpdateProgress) {
  progress.value = {
    ...progress.value,
    ...data,
    version: data.version ?? progress.value.version
  };
}

function handleComplete(data?: { version?: string }) {
  if (data?.version) {
    progress.value = {
      ...progress.value,
      version: data.version
    };
  }

  downloading.value = false;
  completed.value = true;
}

function handleError() {
  visible.value = false;
  downloading.value = false;
  completed.value = false;
}

function handleClose() {
  if (!downloading.value && !installing.value) {
    visible.value = false;
  }
}

function handleRestartLater() {
  visible.value = false;
}

function handleInstallStart(data?: { version?: string }) {
  if (data?.version) {
    progress.value = {
      ...progress.value,
      version: data.version
    };
  }

  installing.value = true;
  completed.value = false;
  downloading.value = false;
}

function handleRestart() {
  if (installing.value) {
    return;
  }

  handleInstallStart({ version: progress.value.version });
  window.requestAnimationFrame(() => {
    void window.tooldeskShortcut?.installDownloadedUpdate?.();
  });
}

function handleUpdateAvailable(data: { version: string }) {
  void data;
}

function handleUpdateCheckComplete(data: { hasUpdate: boolean; version?: string }) {
  void data;
}

function handleUpdateCheckError(data: { error: string }) {
  // 当更新检查出错时
  console.error('更新检查错误:', data.error);
}

defineExpose({
  handleStart,
  handleProgress,
  handleComplete,
  handleError,
  handleRestart,
  handleInstallStart,
  handleUpdateAvailable,
  handleUpdateCheckComplete,
  handleUpdateCheckError
});
</script>

<template>
  <div v-if="visible" class="app-update-overlay">
    <div class="app-update-modal">
      <div class="app-update-header">
        <h3>应用更新</h3>
        <button
          v-if="!downloading && !installing"
          class="app-update-close"
          type="button"
          @click="handleClose"
        >
          <AppIcon name="close" />
        </button>
      </div>

      <div class="app-update-body">
        <div v-if="downloading" class="app-update-downloading">
          <div class="app-update-version">正在下载 {{ displayVersion }}</div>
          <div class="app-update-progress-bar">
            <div
              class="app-update-progress-fill"
              :style="{ width: progress.percent + '%' }"
            ></div>
          </div>
          <div class="app-update-info">
            <span>{{ progress.percent }}%</span>
            <span>{{ downloadSizeLabel }}</span>
          </div>
        </div>

        <div v-else-if="installing" class="app-update-installing">
          <div class="app-update-spinner" aria-hidden="true"></div>
          <div class="app-update-version">正在安装 {{ displayVersion }}</div>
          <p class="app-update-hint">应用即将关闭并在原路径完成更新，请稍候…</p>
        </div>

        <div v-else-if="completed" class="app-update-completed">
          <AppIcon name="check" class="app-update-success-icon" />
          <div class="app-update-version">{{ displayVersion }} 下载完成</div>
          <p class="app-update-hint">稍后重启应用即可完成更新</p>
          <div class="app-update-actions">
            <button class="app-update-secondary-btn" type="button" @click="handleRestartLater">
              稍后重启
            </button>
            <button class="app-update-restart-btn" type="button" @click="handleRestart">
              立即重启
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.app-update-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.app-update-modal {
  background: var(--panel-bg);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 420px;
  max-width: 90vw;
}

.app-update-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--panel-border);
}

.app-update-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.app-update-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: color 0.2s;
}

.app-update-close:hover {
  color: var(--text-primary);
}

.app-update-body {
  padding: 24px;
}

.app-update-downloading,
.app-update-completed,
.app-update-installing {
  text-align: center;
}

.app-update-installing .app-update-hint {
  margin-bottom: 0;
}

.app-update-spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 3px solid var(--panel-soft);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: app-update-spin 0.8s linear infinite;
}

@keyframes app-update-spin {
  to {
    transform: rotate(360deg);
  }
}

.app-update-version {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.app-update-progress-bar {
  height: 8px;
  background: var(--panel-soft);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.app-update-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4f46e5, #7c3aed);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.app-update-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-muted);
}

.app-update-success-icon {
  width: 48px;
  height: 48px;
  color: #10b981;
  margin: 0 auto 16px;
}

.app-update-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin: 8px 0 20px;
}

.app-update-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.app-update-secondary-btn {
  background: var(--panel-soft);
  color: var(--text-secondary);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.app-update-secondary-btn:hover {
  background: var(--panel-bg);
  color: var(--text-primary);
  border-color: var(--accent-soft);
}

.app-update-restart-btn {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.app-update-restart-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}

.app-update-restart-btn:active {
  transform: translateY(0);
}

.app-update-restart-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
</style>
