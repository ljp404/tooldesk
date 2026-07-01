import type { ToolItem } from '../types/toolbox';

export type AppRuntime = 'tauri';

export function getAppRuntime(): AppRuntime {
  return 'tauri';
}

export function isToolAvailableInCurrentRuntime(_tool: ToolItem) {
  return true;
}
