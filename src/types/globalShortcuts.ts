export type GlobalShortcutId = 'quickLauncher' | 'screenshot' | 'screenRecorder' | 'superClipboard';

export interface GlobalShortcutDefinition {
  defaultAccelerator: string;
  description: string;
  id: GlobalShortcutId;
  label: string;
}

export interface GlobalShortcutBinding {
  accelerator: string;
  enabled: boolean;
  id: GlobalShortcutId;
}

export interface GlobalShortcutsSettings {
  bindings: GlobalShortcutBinding[];
}

export interface GlobalShortcutRegistrationResult {
  accelerator: string;
  error?: string;
  id: GlobalShortcutId;
  registered: boolean;
}

export const GLOBAL_SHORTCUT_DEFINITIONS: GlobalShortcutDefinition[] = [
  {
    defaultAccelerator: 'Ctrl+Alt+Space',
    description: '打开快速启动窗口',
    id: 'quickLauncher',
    label: '快速启动'
  },
  {
    defaultAccelerator: 'Ctrl+Shift+A',
    description: '打开截图工具',
    id: 'screenshot',
    label: '截图'
  },
  {
    defaultAccelerator: 'Ctrl+Shift+R',
    description: '打开录屏工具',
    id: 'screenRecorder',
    label: '录屏'
  },
  {
    defaultAccelerator: 'Ctrl+Alt+V',
    description: '打开超级剪切板',
    id: 'superClipboard',
    label: '超级剪切板'
  }
];

export function getDefaultGlobalShortcutsSettings(): GlobalShortcutsSettings {
  return {
    bindings: GLOBAL_SHORTCUT_DEFINITIONS.map((definition) => ({
      accelerator: definition.defaultAccelerator,
      enabled: true,
      id: definition.id
    }))
  };
}

export function getGlobalShortcutDefinition(id: GlobalShortcutId) {
  return GLOBAL_SHORTCUT_DEFINITIONS.find((definition) => definition.id === id);
}

export function formatGlobalShortcutStatus(
  results: GlobalShortcutRegistrationResult[] | undefined,
  bindings: GlobalShortcutBinding[]
) {
  if (!results?.length) {
    return '快捷键尚未注册';
  }

  const enabledBindings = bindings.filter((binding) => binding.enabled);
  const registered = results.filter((result) => result.registered);
  const failed = results.filter((result) => enabledBindings.some((binding) => binding.id === result.id) && !result.registered);

  if (!enabledBindings.length) {
    return '所有快捷键均已关闭';
  }

  if (!failed.length) {
    return `${registered.length} 个快捷键已启用`;
  }

  const firstError = failed.find((result) => result.error);
  return firstError?.error ?? '部分快捷键注册失败';
}
