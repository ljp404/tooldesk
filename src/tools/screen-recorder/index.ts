import { defineAsyncComponent } from 'vue';
import { defineTool } from '../types';

import icon from './assets/icon.svg?url';
import windowIcon from './assets/window-icon.png?url';

export default defineTool({
  key: 'screen-recorder',
  category: 'image',
  label: '录屏',
  caption: '录制屏幕、窗口或应用画面，并保存为视频文件',
  icon,
  accent: 'rose',
  source: 'system',
  windowIcon,
  defaultAlias: 'lp',
  keywords: ['screen recorder', 'recording', 'capture', '录屏', '屏幕录制', 'gif', 'mp4', 'pmlz', 'luping'],
  order: 46,
  shortcut: {
    accepts: (content) => {
      try {
        const payload = JSON.parse(content) as { type?: string };

        return payload.type === 'screen-recorder-region';
      } catch {
        return false;
      }
    }
  },
  component: defineAsyncComponent(() => import('./ScreenRecorder.vue'))
});
