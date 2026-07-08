import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const commonStudioPaths = [
  'C:\\Program Files\\Android\\Android Studio\\bin\\studio64.exe',
  'C:\\Program Files\\Android\\Android Studio\\bin\\studio.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Programs\\Android Studio\\bin\\studio64.exe`
].filter(Boolean);

function resolveAndroidStudioPath() {
  const configuredPath = process.env.CAPACITOR_ANDROID_STUDIO_PATH?.trim();

  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  return commonStudioPaths.find((studioPath) => existsSync(studioPath));
}

const studioPath = resolveAndroidStudioPath();

if (!studioPath) {
  console.error('\n未找到 Android Studio。');
  console.error('请先安装 Android Studio，或设置 CAPACITOR_ANDROID_STUDIO_PATH 指向 studio64.exe。');
  console.error('\n示例：');
  console.error('$env:CAPACITOR_ANDROID_STUDIO_PATH="D:\\\\Android\\\\Android Studio\\\\bin\\\\studio64.exe"');
  console.error('npm.cmd run mobile:android:open\n');
  process.exit(1);
}

const result = spawnSync('npx.cmd', ['cap', 'open', 'android'], {
  env: {
    ...process.env,
    CAPACITOR_ANDROID_STUDIO_PATH: studioPath
  },
  shell: false,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
