import { describe, expect, it } from 'vitest';
import type { InstalledApplication } from '../types/installedApplication';
import { filterInstalledApplications } from './installedApplicationSearch';

const applications: InstalledApplication[] = [
  { id: 'wechat', keywords: ['微信'], name: '企业微信' },
  { id: 'vscode', keywords: ['Visual Studio Code'], name: 'Visual Studio Code' },
  { id: 'wecom', keywords: ['企业微信'], name: 'WeCom' }
];

describe('installed application search', () => {
  it('matches Chinese application names', () => {
    expect(filterInstalledApplications(applications, '企业').map((application) => application.id)).toEqual(['wechat', 'wecom']);
  });

  it('prioritizes direct name matches over keyword matches', () => {
    expect(filterInstalledApplications(applications, 'visual')[0]?.id).toBe('vscode');
  });

  it('returns no applications for an empty query', () => {
    expect(filterInstalledApplications(applications, '   ')).toEqual([]);
  });
});
