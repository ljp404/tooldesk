import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePluginRoot } from './validatePluginPackage';

function createPluginRoot(html: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tooldesk-plugin-'));

  fs.writeFileSync(
    path.join(root, 'plugin.json'),
    JSON.stringify(
      {
        capabilities: ['copyText'],
        category: 'dev',
        entry: 'index.html',
        id: 'tooldesk-test',
        manifestVersion: 1,
        minHostVersion: '0.1.0',
        name: 'Test Plugin',
        permissions: ['clipboard'],
        publisher: 'tooldesk',
        sdkVersion: '1.0.0',
        version: '1.0.0'
      },
      null,
      2
    ),
    'utf-8'
  );
  fs.writeFileSync(path.join(root, 'index.html'), html, 'utf-8');

  return root;
}

function updateManifest(root: string, patch: Record<string, unknown>) {
  const manifestPath = path.join(root, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`, 'utf-8');
}

describe('validatePluginPackage', () => {
  it('rejects legacy TooldeskPlugin.run boot helpers', () => {
    const root = createPluginRoot(`
      <script>
        const pluginCreateOptions = { id: 'tooldesk-test', capabilities: ['copyText'] };
        TooldeskPlugin.run(pluginCreateOptions, function () {});
      </script>
    `);

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('forbidden legacy SDK pattern');
  });

  it('accepts the v1 create/connect boot path', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        const api = plugin.api;
        document.addEventListener('click', () => { void api.copyText('ok'); });
        void plugin.connect().then(() => {});
      </script>
    `);

    expect(validatePluginRoot(root).ok).toBe(true);
  });

  it('rejects direct browser clipboard access', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        const api = plugin.api;
        document.addEventListener('click', () => {
          void navigator.clipboard.writeText('bad');
        });
        void plugin.connect().then(() => {});
      </script>
    `);

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('forbidden legacy SDK pattern');
  });

  it('rejects missing entry files', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        void plugin.connect().then(() => {});
      </script>
    `);
    fs.unlinkSync(path.join(root, 'index.html'));

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('entry file is missing');
  });

  it('rejects missing local icon assets', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        void plugin.connect().then(() => {});
      </script>
    `);
    updateManifest(root, { icon: 'assets/icon.svg' });

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('icon asset is missing');
  });

  it('rejects non-standard icon asset names', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        void plugin.connect().then(() => {});
      </script>
    `);
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'custom.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />');
    fs.writeFileSync(path.join(root, 'assets', 'custom-window.png'), 'png');
    updateManifest(root, { icon: 'assets/custom.svg', windowIcon: 'assets/custom-window.png' });

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('icon must use assets/icon.svg');
    expect(result.errors.join('\n')).toContain('windowIcon must use assets/window-icon.png');
  });

  it('rejects missing local window icon assets', () => {
    const root = createPluginRoot(`
      <script>
        const plugin = TooldeskPlugin.create({ id: 'tooldesk-test', capabilities: ['copyText'] });
        void plugin.connect().then(() => {});
      </script>
    `);
    updateManifest(root, { windowIcon: 'assets/window-icon.png' });

    const result = validatePluginRoot(root);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('windowIcon asset is missing');
  });
});
