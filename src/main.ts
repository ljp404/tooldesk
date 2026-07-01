import { createApp } from 'vue';
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
const rootComponent = params.has('quick') ? QuickApp : App;

createApp(rootComponent).mount('#app');

startComponentMemoryReporter(() => ({
  context: params.has('quick') ? String(params.get('quick') ?? 'launcher') : 'main',
  extra: {
    compact: params.get('compact') === '1',
    instance: params.get('instance')
  },
  source: params.has('quick') ? 'quick-window' : 'main-window'
}));
