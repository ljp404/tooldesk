import { defineAsyncComponent } from 'vue';
import { defineTool } from '../types';

import icon from './assets/icon.svg?url';
import windowIcon from './assets/window-icon.png?url';

export default defineTool({
  key: 'static-server',
  category: 'dev',
  label: '静态服务器',
  caption: '本地预览 Vue / Vite 构建产物，支持 SPA History 回退',
  icon,
  accent: 'green',
  source: 'system',
  windowIcon,
  defaultAlias: 'jtff',
  keywords: [
    'static',
    'server',
    'preview',
    'dist',
    'vite',
    'vue',
    'nginx',
    '静态',
    '服务器',
    '预览',
    '本地',
    'jt',
    'jingtai'
  ],
  order: 38,
  component: defineAsyncComponent(() => import('./StaticServer.vue'))
});
