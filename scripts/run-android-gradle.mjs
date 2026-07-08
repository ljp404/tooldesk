import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const gradleWrapper = process.platform === 'win32'
  ? path.join(androidDir, 'gradlew.bat')
  : path.join(androidDir, 'gradlew');

function parseJavaMajor(versionText) {
  const match = versionText.match(/version "([^"]+)"/i);
  if (!match) {
    return null;
  }

  const raw = match[1];
  if (raw.startsWith('1.')) {
    const major = Number.parseInt(raw.split('.')[1] ?? '', 10);
    return Number.isFinite(major) ? major : null;
  }

  const major = Number.parseInt(raw.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

function inspectJava(javaExecutable, env = process.env) {
  try {
    const result = spawnSync(javaExecutable, ['-version'], {
      encoding: 'utf-8',
      env,
      windowsHide: true
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    return {
      major: parseJavaMajor(output),
      output
    };
  } catch {
    return {
      major: null,
      output: ''
    };
  }
}

function getAndroidStudioJbr() {
  const candidate = process.platform === 'win32'
    ? 'C:\\Program Files\\Android\\Android Studio\\jbr'
    : '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  return fs.existsSync(candidate) ? candidate : null;
}

function readSdkPathFromLocalProperties() {
  const localPropertiesPath = path.join(androidDir, 'local.properties');
  if (!fs.existsSync(localPropertiesPath)) {
    return null;
  }

  const content = fs.readFileSync(localPropertiesPath, 'utf-8');
  const match = content.match(/^sdk\.dir=(.+)$/m);
  if (!match) {
    return null;
  }

  const normalized = match[1].trim().replace(/\\:/g, ':').replace(/\\\\/g, '\\');
  return normalized.length > 0 ? normalized : null;
}

function getAndroidSdkPath() {
  const candidates = [
    readSdkPathFromLocalProperties(),
    process.env.ANDROID_HOME ?? null,
    process.env.ANDROID_SDK_ROOT ?? null,
    process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk'),
    process.platform === 'win32' ? 'C:\\Android\\Sdk' : null
  ].filter((value) => typeof value === 'string' && value.length > 0);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function escapeGradlePropertyPath(targetPath) {
  return targetPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

function ensureAndroidLocalProperties(sdkPath) {
  const localPropertiesPath = path.join(androidDir, 'local.properties');
  const sdkDirLine = `sdk.dir=${escapeGradlePropertyPath(sdkPath)}`;
  const existing = fs.existsSync(localPropertiesPath)
    ? fs.readFileSync(localPropertiesPath, 'utf-8')
    : '';

  if (existing.includes('sdk.dir=')) {
    const next = existing.replace(/^sdk\.dir=.*$/m, sdkDirLine);
    if (next !== existing) {
      fs.writeFileSync(localPropertiesPath, next, 'utf-8');
    }
    return;
  }

  const next = existing.trim().length > 0 ? `${existing.trim()}\n${sdkDirLine}\n` : `${sdkDirLine}\n`;
  fs.writeFileSync(localPropertiesPath, next, 'utf-8');
}

function getJavaHomeForGradle() {
  const current = inspectJava('java');
  if ((current.major ?? 0) >= 11) {
    return {
      javaHome: process.env.JAVA_HOME ?? null,
      reason: 'current-java'
    };
  }

  const candidates = [
    getAndroidStudioJbr(),
    process.env.JAVA_HOME ?? null
  ].filter((value) => typeof value === 'string' && value.length > 0);

  for (const javaHome of candidates) {
    const javaExecutable = process.platform === 'win32'
      ? path.join(javaHome, 'bin', 'java.exe')
      : path.join(javaHome, 'bin', 'java');
    if (!fs.existsSync(javaExecutable)) {
      continue;
    }

    const info = inspectJava(javaExecutable);
    if ((info.major ?? 0) >= 11) {
      return {
        javaHome,
        reason: javaHome === getAndroidStudioJbr() ? 'android-studio-jbr' : 'java-home'
      };
    }
  }

  return {
    javaHome: null,
    reason: 'missing-compatible-java'
  };
}

const selection = getJavaHomeForGradle();
const env = { ...process.env };

if (selection.javaHome) {
  env.JAVA_HOME = selection.javaHome;
  env.PATH = `${path.join(selection.javaHome, 'bin')}${path.delimiter}${env.PATH ?? ''}`;
  console.info(`[android-gradle] using Java from ${selection.javaHome}`);
} else {
  console.warn('[android-gradle] no Java 11+ runtime found; Gradle may fail. Install JDK 17+ or Android Studio.');
}

const sdkPath = getAndroidSdkPath();
if (sdkPath) {
  env.ANDROID_HOME = sdkPath;
  env.ANDROID_SDK_ROOT = sdkPath;
  ensureAndroidLocalProperties(sdkPath);
  console.info(`[android-gradle] using Android SDK from ${sdkPath}`);
} else {
  console.warn('[android-gradle] Android SDK not found. Install SDK Platforms + Platform-Tools in Android Studio first.');
}

const gradleArgs = process.argv.slice(2);
if (gradleArgs.length === 0) {
  console.error('[android-gradle] missing Gradle arguments');
  process.exit(1);
}

const result = process.platform === 'win32'
  ? spawnSync(gradleWrapper, gradleArgs, {
      cwd: androidDir,
      env,
      shell: true,
      stdio: 'inherit',
      windowsHide: true
    })
  : spawnSync(gradleWrapper, gradleArgs, {
      cwd: androidDir,
      env,
      stdio: 'inherit'
    });

process.exit(result.status ?? 1);
