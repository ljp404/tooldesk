import { invoke } from '@tauri-apps/api/core';

type ShortcutRegistrationResult = {
  accelerator: string;
  error?: string;
  id: TooldeskGlobalShortcutId;
  registered: boolean;
};

export function syncGlobalShortcuts(settings: TooldeskAppSettings): Promise<ShortcutRegistrationResult[]> {
  return invoke<ShortcutRegistrationResult[]>('sync_global_shortcuts', { settings });
}

export function suspendGlobalShortcuts(): Promise<{ suspended: boolean }> {
  return invoke<{ suspended: boolean }>('suspend_global_shortcuts');
}

export function resumeGlobalShortcuts(settings: TooldeskAppSettings): Promise<{
  registered: boolean;
  results?: ShortcutRegistrationResult[];
}> {
  return invoke('resume_global_shortcuts', { settings });
}
