import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path.replace(/\\/g, '/')}`,
  invoke: vi.fn()
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn()
}));

describe('tauri plugin asset paths', () => {
  it('resolves installed plugin icon paths from the install directory', async () => {
    const { __testing } = await import('./tauriPlugins');

    const tool = {
      entryUrl: 'D:\\work\\plugins\\tooldesk-codec\\index.html',
      installPath: 'D:\\work\\plugins\\tooldesk-codec'
    } as TooldeskPluginToolRegistration;

    expect(__testing.resolveInstalledPluginAssetPath(tool, 'assets/icon.svg')).toBe(
      'asset://D:/work/plugins/tooldesk-codec/assets/icon.svg'
    );
  });

  it('keeps installed absolute window icon paths as file assets', async () => {
    const { __testing } = await import('./tauriPlugins');

    const tool = {
      entryUrl: 'D:\\work\\plugins\\tooldesk-codec\\index.html',
      installPath: 'D:\\work\\plugins\\tooldesk-codec'
    } as TooldeskPluginToolRegistration;

    expect(__testing.resolveInstalledPluginAssetPath(tool, 'D:\\work\\plugins\\tooldesk-codec\\assets\\window-icon.png')).toBe(
      'asset://D:/work/plugins/tooldesk-codec/assets/window-icon.png'
    );
  });

  it('uses installed plugin entry urls in dev', async () => {
    vi.stubEnv('DEV', true);
    const { __testing } = await import('./tauriPlugins');

    expect(
      __testing.resolveInstalledPluginEntryUrl({
        entryUrl: 'C:\\Users\\test\\AppData\\Roaming\\tooldesk\\plugins\\tooldesk-codec\\index.html',
        pluginId: 'tooldesk-codec'
      } as TooldeskPluginToolRegistration)
    ).toBe('asset://C:/Users/test/AppData/Roaming/tooldesk/plugins/tooldesk-codec/index.html');

    vi.unstubAllEnvs();
  });

  it('normalizes newly installed tools without rescanning the plugin directory', async () => {
    const { __testing } = await import('./tauriPlugins');

    const tools = __testing.normalizeInstalledPluginTools([
      {
        entryUrl: 'D:\\work\\plugins\\tooldesk-zeta\\index.html',
        installPath: 'D:\\work\\plugins\\tooldesk-zeta',
        label: 'Zeta'
      },
      {
        entryUrl: 'D:\\work\\plugins\\tooldesk-alpha\\index.html',
        installPath: 'D:\\work\\plugins\\tooldesk-alpha',
        label: 'Alpha'
      }
    ] as TooldeskPluginToolRegistration[]);

    expect(tools.map((tool) => tool.label)).toEqual(['Alpha', 'Zeta']);
    expect(tools[0].entryUrl).toBe('asset://D:/work/plugins/tooldesk-alpha/index.html');
  });
});
