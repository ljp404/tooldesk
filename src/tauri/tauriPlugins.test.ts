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
});
