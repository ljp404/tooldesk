import { invoke } from '@tauri-apps/api/core';
import { createApp, nextTick } from 'vue';
import App from './App.vue';
import QuickApp from './QuickApp.vue';
import { installTauriBridge } from './tauri/tauriBridge';
import { startComponentMemoryReporter } from './utils/memoryDiagnostics';
import './styles.css';

installTauriBridge();

document.addEventListener(
  'contextmenu',
  (event) => {
    event.preventDefault();
  },
  { capture: true }
);

const params = new URLSearchParams(window.location.search);
const isMainShell = !params.has('quick');
const rootComponent = isMainShell ? App : QuickApp;

createApp(rootComponent).mount('#app');

if (isMainShell) {
  void nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void invoke('show_main_window_ready').catch(() => undefined);
      });
    });
  });
}

startComponentMemoryReporter(() => ({
  context: params.has('quick') ? String(params.get('quick') ?? 'launcher') : 'main',
  extra: {
    compact: params.get('compact') === '1',
    instance: params.get('instance')
  },
  source: params.has('quick') ? 'quick-window' : 'main-window'
}));
