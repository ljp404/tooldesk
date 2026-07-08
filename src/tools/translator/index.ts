import { defineAsyncComponent } from 'vue';
import { defineTool } from '../types';

import icon from './assets/icon.svg?url';
import windowIcon from './assets/window-icon.png?url';

function acceptsTranslateContent(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length > 5000) {
    return false;
  }

  if (/^[\d*/,\-A-Z#a-z?LW]+\s+[\d*/,\-A-Z#a-z?LW]+(?:\s+[\d*/,\-A-Z#a-z?LW]+){3,4}$/.test(trimmed)) {
    return false;
  }

  if (/^\d{10,13}$/.test(trimmed)) {
    return false;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }

  if (/^<!doctype\s+html\b/i.test(trimmed) || (/<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(trimmed) && /<\/[a-z][\w:-]*>/i.test(trimmed))) {
    return false;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  return /[\u4e00-\u9fffA-Za-z]/.test(trimmed);
}

export default defineTool({
  key: 'translator',
  category: 'text',
  label: '翻译',
  caption: '多语言文本互译',
  icon,
  accent: 'blue',
  source: 'system',
  windowIcon,
  defaultAlias: 'fy',
  keywords: ['translate', 'translation', '翻译', '英文', '中文', 'language', 'fanyi', 'zw', 'yw'],
  order: 15,
  shortcut: {
    accepts: acceptsTranslateContent
  },
  component: defineAsyncComponent(() => import('./Translator.vue'))
});
