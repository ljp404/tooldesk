import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  getAllowedPluginApis,
  getPluginPermissionLabel,
  formatPluginPermissions,
  isHostVersionCompatible,
  PLUGIN_BASE_APIS,
  PLUGIN_HOST_API_VERSION,
  PLUGIN_PERMISSION_API_MAP,
  PLUGIN_PERMISSION_LABELS,
  PLUGIN_SDK_VERSION
} from './pluginApiReference';

describe('pluginApiReference', () => {
  it('exposes stable sdk version', () => {
    expect(PLUGIN_SDK_VERSION).toBe('1.0.0');
    expect(PLUGIN_HOST_API_VERSION).toBe('1.0.0');
  });

  it('keeps the v1 permission api contract explicit', () => {
    expect(PLUGIN_BASE_APIS).toEqual([
      'closeCurrentWindow',
      'getAppVersion',
      'getPluginStorageItem',
      'removePluginStorageItem',
      'setPluginStorageItem'
    ]);
    expect(PLUGIN_PERMISSION_API_MAP).toEqual({
      'browser-bookmarks': ['listBrowserBookmarks'],
      clipboard: ['copyImage', 'copyText'],
      docker: ['checkDockerAvailable', 'dockerImageExists', 'dockerPullImage', 'dockerTagImage', 'runDockerCompose'],
      filesystem: [
        'appendTextExport',
        'createTextExport',
        'finishTextExport',
        'openPath',
        'readBinaryFile',
        'readTextFile',
        'showOpenDialog'
      ],
      hosts: ['openHostsFolder', 'readHostsFile', 'updateHostsEntry', 'writeHostsFile'],
      http: ['openExternalUrl', 'queryDirectExternalIp', 'sendHttpRequest'],
      mail: ['deleteMailMessage', 'downloadMailAttachment', 'fetchMailMessages', 'listMailFolders', 'sendMailMessage', 'setMailMessageSeen'],
      'native-tool': ['runPluginTool'],
      keepass: [
        'getAppSettings',
        'getKeePassSession',
        'lockKeePassDatabase',
        'setAppSettings',
        'showOpenDialog',
        'unlockKeePassDatabase'
      ],
      ssh: ['onSshExecOutput', 'sshExec', 'sshExecStream', 'testSshConnection'],
      'local-library': [
        'getAppSettings',
        'getLocalLibraries',
        'onLocalLibraryChanged',
        'openLocalLibraryFile',
        'searchLocalLibrary',
        'setAppSettings',
        'showOpenDialog'
      ],
      music: [
        'aliyunCheckQRCode',
        'aliyunGenerateQRCode',
        'aliyunGetDownloadUrl',
        'aliyunListFiles',
        'aliyunRefreshToken',
        'aliyunScanAllMusic',
        'clearAliyunToken',
        'clearMusicCache',
        'downloadCloudMusic',
        'downloadMusicCloudStorageFile',
        'downloadOnlineMusic',
        'getAliyunToken',
        'getMusicCacheStats',
        'getMusicPlayerSettings',
        'invalidateCloudCache',
        'onCloudScanProgress',
        'probeTracksMetadata',
        'resolveCloudPlayUrl',
        'resolveLocalPlayUrl',
        'resolveMusicCloudStoragePlayUrl',
        'resolveOnlinePlayUrl',
        'resolveTrackLyrics',
        'saveAliyunToken',
        'saveMusicPlayerSettings',
        'scanMusicFiles',
        'searchOnlineMusic',
        'showOpenDialog',
        'uploadMusicCloudStorageFile',
        'validateMusicCloudStorage'
      ]
    });
  });

  it('maps permissions to apis', () => {
    expect(getAllowedPluginApis(['clipboard', 'http']).has('copyText')).toBe(true);
    expect(getAllowedPluginApis(['clipboard', 'http']).has('sendHttpRequest')).toBe(true);
    expect(getAllowedPluginApis(['clipboard']).has('sendHttpRequest')).toBe(false);
  });

  it('always allows base apis', () => {
    for (const method of PLUGIN_BASE_APIS) {
      expect(getAllowedPluginApis([]).has(method)).toBe(true);
    }
  });

  it('documents every permission group', () => {
    expect(Object.keys(PLUGIN_PERMISSION_API_MAP).sort()).toEqual(
      [
        'browser-bookmarks',
        'clipboard',
        'docker',
        'filesystem',
        'hosts',
        'http',
        'mail',
        'keepass',
        'local-library',
        'music',
        'native-tool',
        'ssh'
      ].sort()
    );
  });

  it('has human-readable labels for every permission group', () => {
    expect(Object.keys(PLUGIN_PERMISSION_LABELS).sort()).toEqual(Object.keys(PLUGIN_PERMISSION_API_MAP).sort());
    expect(getPluginPermissionLabel('hosts')).toBe('读取和修改 Hosts');
    expect(getPluginPermissionLabel('unknown-permission')).toBe('unknown-permission');
    expect(formatPluginPermissions(['clipboard', 'http'])).toBe('写入剪贴板 / 发送网络请求');
    expect(formatPluginPermissions([])).toBe('无额外权限');
  });

  it('does not grant permission apis for unknown permission names', () => {
    const allowed = getAllowedPluginApis(['unknown-permission']);
    expect(allowed.has('sendHttpRequest')).toBe(false);
    expect([...allowed].sort()).toEqual([...PLUGIN_BASE_APIS].sort());
  });

  it('keeps every api method name identifier-safe', () => {
    for (const method of [...PLUGIN_BASE_APIS, ...Object.values(PLUGIN_PERMISSION_API_MAP).flat()]) {
      expect(method).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it('compares semver versions', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('checks host compatibility', () => {
    expect(isHostVersionCompatible(undefined, '0.1.0')).toBe(true);
    expect(isHostVersionCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isHostVersionCompatible('0.2.0', '0.1.9')).toBe(false);
    expect(isHostVersionCompatible('0.1.0', '0.2.0')).toBe(true);
  });
});
