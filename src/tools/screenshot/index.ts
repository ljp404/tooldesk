import { defineAsyncComponent } from 'vue';
import { defineTool } from '../types';

import icon from './assets/icon.svg?url';
import windowIcon from './assets/window-icon.png?url';

export default defineTool({
  key: 'screenshot',
  category: 'image',
  label: '截图',
  caption: '框选截图、复制与保存，支持框选内 OCR 复制文字',
  icon,
  accent: 'blue',
  source: 'system',
  windowIcon,
  defaultAlias: 'jt',
  keywords: ['screenshot', 'capture', 'ocr', '截图', '截屏', 'jp', 'jietu', 'jieping'],
  order: 45,
  component: defineAsyncComponent(() => import('./Screenshot.vue'))
});
