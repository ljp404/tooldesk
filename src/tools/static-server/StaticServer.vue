<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ToolPanel from '../../components/toolbox/ToolPanel.vue';
import { useClipboardCopy } from '../../composables/useClipboardCopy';
import { showOpenDialog } from '../../tauri/tauriFile';
import {
  getStaticServerStatus,
  startStaticServer,
  stopStaticServer,
  type StaticServerStatus
} from '../../tauri/tauriStaticServer';
import './staticServerTool.css';

const SETTINGS_KEY = 'tooldesk-static-server-settings';

type StaticServerSettings = {
  rootPath: string;
  port: number;
  host: string;
  spaFallback: boolean;
};

const rootPath = ref('');
const port = ref(4173);
const host = ref('127.0.0.1');
const spaFallback = ref(true);
const status = ref<StaticServerStatus>({ running: false });
const actionError = ref('');
const isBusy = ref(false);

const { copyStatus, copyText } = useClipboardCopy();

const isRunning = computed(() => status.value.running);
const accessUrl = computed(() => status.value.url ?? '');
const showLanHint = computed(() => isRunning.value && status.value.host === '0.0.0.0');

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw) as Partial<StaticServerSettings>;
    if (typeof saved.rootPath === 'string') {
      rootPath.value = saved.rootPath;
    }
    if (typeof saved.port === 'number' && saved.port > 0) {
      port.value = saved.port;
    }
    if (saved.host === '127.0.0.1' || saved.host === '0.0.0.0') {
      host.value = saved.host;
    }
    if (typeof saved.spaFallback === 'boolean') {
      spaFallback.value = saved.spaFallback;
    }
  } catch {
    // ignore invalid persisted settings
  }
}

function persistSettings() {
  const payload: StaticServerSettings = {
    rootPath: rootPath.value,
    port: port.value,
    host: host.value,
    spaFallback: spaFallback.value
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

async function refreshStatus() {
  status.value = await getStaticServerStatus();

  if (status.value.root) {
    rootPath.value = status.value.root;
  }
  if (typeof status.value.port === 'number') {
    port.value = status.value.port;
  }
  if (status.value.host === '127.0.0.1' || status.value.host === '0.0.0.0') {
    host.value = status.value.host;
  }
  if (typeof status.value.spaFallback === 'boolean') {
    spaFallback.value = status.value.spaFallback;
  }
}

async function pickDirectory() {
  actionError.value = '';

  const result = await showOpenDialog({
    properties: ['openDirectory'],
    title: '选择静态文件目录'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  rootPath.value = result.filePaths[0] ?? '';
  persistSettings();
}

async function handleStart() {
  if (isBusy.value || isRunning.value) {
    return;
  }

  actionError.value = '';

  const normalizedRoot = rootPath.value.trim();
  if (!normalizedRoot) {
    actionError.value = '请选择静态文件目录';
    return;
  }

  if (!Number.isFinite(port.value) || port.value < 1 || port.value > 65535) {
    actionError.value = '端口号无效，请输入 1–65535 之间的整数';
    return;
  }

  isBusy.value = true;
  persistSettings();

  try {
    status.value = await startStaticServer({
      rootPath: normalizedRoot,
      port: port.value,
      host: host.value,
      spaFallback: spaFallback.value
    });

    const latestStatus = await getStaticServerStatus();
    status.value = latestStatus;

    if (!latestStatus.running) {
      actionError.value = '服务启动后立即退出，请检查目录、端口或是否缺少 index.html';
    }
  } catch (error) {
    actionError.value = getErrorMessage(error, '启动失败');
    await refreshStatus().catch(() => undefined);
  } finally {
    isBusy.value = false;
  }
}

async function handleStop() {
  if (isBusy.value || !isRunning.value) {
    return;
  }

  actionError.value = '';
  isBusy.value = true;

  try {
    status.value = await stopStaticServer();
  } catch (error) {
    actionError.value = getErrorMessage(error, '停止失败');
  } finally {
    isBusy.value = false;
  }
}

async function openInBrowser() {
  if (!accessUrl.value || !window.tooldeskShortcut?.openExternalUrl) {
    return;
  }

  await window.tooldeskShortcut.openExternalUrl(accessUrl.value);
}

onMounted(async () => {
  loadSettings();

  try {
    await refreshStatus();
  } catch (error) {
    actionError.value = getErrorMessage(error, '读取服务状态失败');
  }
});
</script>

<template>
  <ToolPanel class="static-server-panel" fill :copy-status="copyStatus">
    <div class="static-server-layout">
      <section class="static-server-form">
        <div class="static-server-field">
          <span>静态目录</span>
          <div class="static-server-row">
            <div class="static-server-path" :title="rootPath || '未选择目录'">
              {{ rootPath || '请选择 dist / build 等构建产物目录' }}
            </div>
            <button class="secondary-action" type="button" :disabled="isRunning || isBusy" @click="pickDirectory">
              选择目录
            </button>
          </div>
        </div>

        <div class="static-server-options">
          <div class="static-server-field">
            <span>端口</span>
            <input
              v-model.number="port"
              type="number"
              min="1"
              max="65535"
              step="1"
              :disabled="isRunning || isBusy"
            />
          </div>

          <div class="static-server-field">
            <span>访问范围</span>
            <select v-model="host" :disabled="isRunning || isBusy">
              <option value="127.0.0.1">仅本机</option>
              <option value="0.0.0.0">局域网</option>
            </select>
          </div>
        </div>

        <label class="static-server-checkbox">
          <input v-model="spaFallback" type="checkbox" :disabled="isRunning || isBusy" />
          SPA History 回退（找不到文件时返回 index.html）
        </label>

        <div class="static-server-actions">
          <button
            v-if="!isRunning"
            class="tool-primary-button"
            type="button"
            :disabled="isBusy || !rootPath.trim()"
            @click="handleStart"
          >
            {{ isBusy ? '启动中…' : '启动服务' }}
          </button>
          <button
            v-else
            class="secondary-action danger"
            type="button"
            :disabled="isBusy"
            @click="handleStop"
          >
            {{ isBusy ? '停止中…' : '停止服务' }}
          </button>
        </div>
      </section>

      <p v-if="actionError" class="static-server-error" role="alert">{{ actionError }}</p>

      <section class="static-server-status">
        <div class="static-server-status-head">
          <h3>服务状态</h3>
          <span class="static-server-badge" :class="isRunning ? 'running' : 'stopped'">
            {{ isRunning ? '运行中' : '未启动' }}
          </span>
        </div>

        <div v-if="isRunning && accessUrl" class="static-server-url">
          <code :title="accessUrl">{{ accessUrl }}</code>
          <button class="secondary-action" type="button" @click="copyText(accessUrl, '链接已复制')">复制链接</button>
          <button class="secondary-action" type="button" @click="openInBrowser">打开浏览器</button>
        </div>

        <p v-if="showLanHint" class="static-server-hint">
          局域网模式下，同一网络内的设备可通过本机 IP 加端口访问，例如 http://192.168.x.x:{{ status.port }}/ 。
        </p>

        <ul class="static-server-notes">
          <li>适用于 Vue / Vite 等项目执行 build 后的 dist 目录预览。</li>
          <li>开发环境的 proxy 不会自动生效，接口需后端单独提供或自行代理。</li>
          <li>切换工具或关闭窗口后服务会继续运行，退出应用时自动停止。</li>
        </ul>
      </section>
    </div>
  </ToolPanel>
</template>
