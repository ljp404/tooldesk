import { invoke } from '@tauri-apps/api/core';
import type { InstalledApplication } from '../types/installedApplication';

export function listInstalledApplications() {
  return invoke<InstalledApplication[]>('list_installed_applications');
}

export function getInstalledApplicationIcon(applicationId: string) {
  return invoke<string | null>('get_installed_application_icon', { applicationId });
}

export function launchInstalledApplication(applicationId: string) {
  return invoke<void>('launch_installed_application', { applicationId });
}
