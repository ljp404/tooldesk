import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type MessageListener = (event: { data: unknown }) => void;

function loadSdk(options: { document?: unknown; MutationObserver?: unknown } = {}) {
  const listeners: MessageListener[] = [];
  const postedMessages: unknown[] = [];
  const windowMock = {
    addEventListener(type: string, listener: MessageListener) {
      if (type === 'message') {
        listeners.push(listener);
      }
    },
    parent: {
      postMessage: vi.fn((message: unknown) => {
        postedMessages.push(message);
      })
    },
    removeEventListener(type: string, listener: MessageListener) {
      if (type !== 'message') {
        return;
      }

      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
    document: options.document,
    MutationObserver: options.MutationObserver
  };
  const sandbox = {
    clearTimeout,
    console,
    localStorage: new Map(),
    navigator: {},
    setTimeout,
    window: windowMock
  };
  const sdkPath = path.resolve('public/tooldesk-plugin-sdk.js');

  vm.runInNewContext(fs.readFileSync(sdkPath, 'utf-8'), sandbox, { filename: sdkPath });

  return {
    dispatchHostMessage(data: unknown) {
      for (const listener of [...listeners]) {
        listener({ data });
      }
    },
    postedMessages,
    window: windowMock as typeof windowMock & {
      TooldeskPlugin: {
        create: (options: { capabilities?: string[]; id?: string }) => {
          api: Record<string, unknown>;
          connect: () => Promise<{ ready: boolean }>;
        };
        run?: unknown;
      };
    }
  };
}

describe('tooldesk plugin sdk', () => {
  it('exposes only the v1 create entrypoint', () => {
    const { window } = loadSdk();

    expect(typeof window.TooldeskPlugin.create).toBe('function');
    expect(window.TooldeskPlugin.run).toBeUndefined();
  });

  it('does not make plugin.api thenable', async () => {
    const { window } = loadSdk();
    const plugin = window.TooldeskPlugin.create({ capabilities: ['copyText'], id: 'tooldesk-test' });

    expect(plugin.api.then).toBeUndefined();
    await expect(Promise.resolve(plugin.api)).resolves.toBe(plugin.api);
  });

  it('connects immediately when host responds', async () => {
    const { dispatchHostMessage, postedMessages, window } = loadSdk();
    const plugin = window.TooldeskPlugin.create({ capabilities: ['copyText'], id: 'tooldesk-test' });
    const connectPromise = plugin.connect();

    expect(postedMessages).toContainEqual({
      pluginId: 'tooldesk-test',
      source: 'tooldesk-plugin',
      type: 'host:ready:get'
    });

    dispatchHostMessage({
      appVersion: '0.1.0',
      hostApiVersion: '1.0.0',
      permissions: ['clipboard'],
      sdkVersion: '1.0.0',
      source: 'tooldesk-host',
      type: 'host:ready'
    });

    await Promise.resolve();

    const permissionsRequest = postedMessages.find(
      (message): message is { requestId: string; type: string } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: unknown }).type === 'permissions:get'
    );

    expect(permissionsRequest).toBeTruthy();

    dispatchHostMessage({
      permissions: ['clipboard'],
      requestId: permissionsRequest?.requestId,
      source: 'tooldesk-host',
      type: 'permissions:result'
    });

    await expect(connectPromise).resolves.toMatchObject({ ready: true });
  });

  it('disables browser autofill on plugin inputs', () => {
    const inputAttributes = new Map<string, string>();
    const textareaAttributes = new Map<string, string>();
    const formAttributes = new Map<string, string>();
    const form = {
      getAttribute: vi.fn((name: string) => formAttributes.get(name)),
      setAttribute: vi.fn((name: string, value: string) => {
        formAttributes.set(name, value);
      })
    };
    const input = {
      tagName: 'INPUT',
      getAttribute: vi.fn((name: string) => {
        if (name === 'type') {
          return 'text';
        }
        if (name === 'id') {
          return 'sshHost';
        }
        return inputAttributes.get(name);
      }),
      setAttribute: vi.fn((name: string, value: string) => {
        inputAttributes.set(name, value);
      }),
      closest: vi.fn(() => form)
    };
    const textarea = {
      tagName: 'TEXTAREA',
      getAttribute: vi.fn((name: string) => {
        if (name === 'id') {
          return 'notes';
        }
        return textareaAttributes.get(name);
      }),
      setAttribute: vi.fn((name: string, value: string) => {
        textareaAttributes.set(name, value);
      }),
      closest: vi.fn(() => null)
    };
    const documentMock = {
      addEventListener: vi.fn(),
      documentElement: {},
      querySelectorAll: vi.fn((selector: string) => {
        expect(selector).toContain('input[type="text"]');
        expect(selector).toContain('textarea');
        return [input, textarea];
      }),
      readyState: 'complete'
    };

    loadSdk({
      document: documentMock,
      MutationObserver: class {
        observe = vi.fn();
      }
    });

    expect(inputAttributes.get('autocomplete')).toBe('off');
    expect(inputAttributes.get('name')).toBe('tooldesk-sshHost');
    expect(inputAttributes.get('autocapitalize')).toBe('off');
    expect(inputAttributes.get('autocorrect')).toBe('off');
    expect(inputAttributes.get('spellcheck')).toBe('false');
    expect(textareaAttributes.get('autocomplete')).toBe('off');
    expect(textareaAttributes.get('name')).toBe('tooldesk-notes');
    expect(textareaAttributes.get('spellcheck')).toBe('false');
    expect(formAttributes.get('autocomplete')).toBe('off');
  });
});
