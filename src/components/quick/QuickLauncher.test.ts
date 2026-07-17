import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolItem } from '../../types/toolbox';
import QuickLauncher from './QuickLauncher.vue';

const dockerPullTool: ToolItem = {
  accent: 'blue',
  caption: '拉取 Docker 镜像',
  category: 'dev',
  icon: 'docker',
  key: 'plugin:tooldesk-docker-pull',
  keywords: ['docker'],
  label: '镜像拉取',
  shortcut: {
    accepts: (content) => content === '远程拉起'
  }
};

const translatorTool: ToolItem = {
  accent: 'blue',
  caption: '多语言文本互译',
  category: 'text',
  defaultAlias: 'fy',
  icon: 'translate',
  key: 'translator',
  keywords: ['translate', '翻译'],
  label: '翻译',
  shortcut: {
    accepts: (content) => /[\u4e00-\u9fffA-Za-z]/.test(content)
  }
};

const originalShortcutApi = window.tooldeskShortcut;

describe('QuickLauncher', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'tooldeskShortcut', {
      configurable: true,
      value: undefined,
      writable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'tooldeskShortcut', {
      configurable: true,
      value: originalShortcutApi,
      writable: true
    });
  });

  it('keeps an inline tool open when new clipboard content arrives', async () => {
    const wrapper = mount(QuickLauncher, {
      global: {
        stubs: {
          AppIcon: true,
          ToolIcon: true,
          ToolRenderer: {
            props: ['tool'],
            template: '<div data-testid="tool-renderer">{{ tool.label }}</div>'
          }
        }
      },
      props: {
        shortcutContent: '',
        shortcutContentVersion: 1,
        tools: [dockerPullTool]
      }
    });

    const toolButton = wrapper.findAll('button.quick-launcher-tool').find((button) => button.text().includes('镜像拉取'));
    expect(toolButton).toBeDefined();
    await toolButton?.trigger('click');
    expect(wrapper.get('[data-testid="tool-renderer"]').text()).toBe('镜像拉取');

    await wrapper.setProps({
      shortcutContent: '远程拉起',
      shortcutContentVersion: 2
    });

    expect(wrapper.get('[data-testid="tool-renderer"]').text()).toBe('镜像拉取');

    await wrapper.get('button[aria-label="关闭当前组件"]').trigger('click');
    expect(wrapper.find('[data-testid="tool-renderer"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('匹配结果');
    expect(wrapper.text()).toContain('镜像拉取');
  });

  it('places an installed application before generic content-matched tools', async () => {
    Object.defineProperty(window, 'tooldeskShortcut', {
      configurable: true,
      value: {
        getLocalLibraries: async () => [],
        listInstalledApplications: async () => [
          { id: 'notepad', keywords: ['notepad'], name: '记事本' }
        ]
      },
      writable: true
    });

    const wrapper = mount(QuickLauncher, {
      global: {
        stubs: {
          AppIcon: true,
          ToolIcon: true,
          ToolRenderer: true
        }
      },
      props: {
        shortcutContent: '',
        shortcutContentVersion: 1,
        tools: [translatorTool]
      }
    });

    await flushPromises();
    await wrapper.get('input[type="search"]').setValue('记事本');

    expect(wrapper.findAll('button.quick-launcher-tool').map((button) => button.text())).toEqual([
      '记事本',
      '翻译'
    ]);
  });
});
