export const PLUGIN_SDK_VERSION = '1.0.0';

export const PLUGIN_HOST_API_VERSION = '1.0.0';

export const PLUGIN_BASE_APIS = [
  'closeCurrentWindow',
  'getAppVersion',
  'getPluginStorageItem',
  'removePluginStorageItem',
  'setPluginStorageItem'
] as const;

export const PLUGIN_PERMISSION_API_MAP = {
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
} as const;

export type PluginPermission = keyof typeof PLUGIN_PERMISSION_API_MAP;

export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  'browser-bookmarks': '读取浏览器书签',
  clipboard: '写入剪贴板',
  docker: '执行 Docker 命令',
  filesystem: '选择文件与打开路径',
  hosts: '读取和修改 Hosts',
  http: '发送网络请求',
  mail: '收取邮箱邮件',
  'native-tool': '执行插件内置工具',
  keepass: '访问 KeePassXC',
  ssh: 'SSH 远程连接',
  'local-library': '访问本地资料库',
  music: '访问音乐播放器'
};

export function getPluginPermissionLabel(permission: string) {
  return PLUGIN_PERMISSION_LABELS[permission as PluginPermission] ?? permission;
}

export function formatPluginPermissions(permissions: readonly string[] = []) {
  return permissions.length ? permissions.map(getPluginPermissionLabel).join(' / ') : '无额外权限';
}

export function compareSemver(left: string, right: string) {
  const normalize = (value: string) =>
    String(value ?? '')
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0);

  const leftParts = normalize(left);
  const rightParts = normalize(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function isHostVersionCompatible(minHostVersion: string | undefined, appVersion: string) {
  const required = String(minHostVersion ?? '').trim();

  if (!required) {
    return true;
  }

  return compareSemver(appVersion, required) >= 0;
}

export function getAllowedPluginApis(permissions: readonly string[] = []) {
  const allowed = new Set<string>(PLUGIN_BASE_APIS);

  for (const permission of permissions) {
    const methods = PLUGIN_PERMISSION_API_MAP[permission as PluginPermission] ?? [];

    for (const method of methods) {
      allowed.add(method);
    }
  }

  return allowed;
}
