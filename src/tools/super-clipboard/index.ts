import { defineAsyncComponent } from 'vue';
import { defineTool } from '../types';

import icon from './assets/icon.svg?url';
import windowIcon from './assets/window-icon.png?url';

export default defineTool({
  key: 'super-clipboard',
  category: 'text',
  label: '超级剪切板',
  caption: '加密记录剪贴板历史，按分类检索',
  icon,
  accent: 'green',
  source: 'system',
  windowIcon,
  defaultAlias: 'jqb',
  keywords: ['clipboard', 'paste', '剪切板', '剪贴板', '历史', 'cjjqb', 'cjjt', 'jianqieban', 'jiantieban'],
  order: 15,
  component: defineAsyncComponent(() => import('./SuperClipboard.vue'))
});
