import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nsisRoot = path.join(rootDir, 'src-tauri', 'target', 'release', 'nsis');
const bundleNsisRoot = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const marker = '; tooldesk: overwrite install for version changes';
const insertBefore = '  ; Skip showing the page if passive';
const patchBlock = `  ${marker}
  ; Keep same-version maintenance and WiX migration unchanged.
  ${'${If}'} $WixMode = 0
  ${'${AndIf}'} $R0 <> 0
    StrCpy $UpdateMode 1
    Abort
  ${'${EndIf}'}

`;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf-8').replace(/^\uFEFF/, ''));
}

function findMakensis() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'makensis.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS', 'Bin', 'makensis.exe')
  ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function listInstallerScripts() {
  if (!fs.existsSync(nsisRoot)) {
    return [];
  }

  return fs
    .readdirSync(nsisRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(nsisRoot, entry.name, 'installer.nsi'))
    .filter((filePath) => fs.existsSync(filePath));
}

function patchInstallerScript(installerPath) {
  const content = fs.readFileSync(installerPath, 'utf-8');

  if (content.includes(marker)) {
    return false;
  }

  if (!content.includes(insertBefore)) {
    throw new Error(`NSIS 脚本缺少预期插入点：${installerPath}`);
  }

  fs.writeFileSync(installerPath, content.replace(insertBefore, `${patchBlock}${insertBefore}`), 'utf-8');
  return true;
}

function resolveBundleInstallerPath(installerPath) {
  const config = readJson('src-tauri/tauri.conf.json');
  const productName = String(config.productName ?? 'tooldesk');
  const version = String(config.version ?? '');
  const arch = path.basename(path.dirname(installerPath));
  const expectedName = `${productName}_${version}_${arch}-setup.exe`;
  const expectedPath = path.join(bundleNsisRoot, expectedName);

  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  const matches = fs.existsSync(bundleNsisRoot)
    ? fs
        .readdirSync(bundleNsisRoot)
        .filter((name) => name.endsWith('-setup.exe') && name.includes(`_${version}_`) && name.includes(`_${arch}-`))
    : [];

  if (matches.length > 0) {
    return path.join(bundleNsisRoot, matches[0]);
  }

  return expectedPath;
}

function rebuildInstaller(makensisPath, installerPath) {
  const installerDir = path.dirname(installerPath);
  const result = spawnSync(makensisPath, [installerPath], {
    cwd: installerDir,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`makensis 执行失败，退出码：${result.status ?? 'unknown'}`);
  }

  const outputPath = path.join(installerDir, 'nsis-output.exe');
  const targetPath = resolveBundleInstallerPath(installerPath);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`未找到 NSIS 输出文件：${outputPath}`);
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(outputPath, targetPath);
  fs.rmSync(outputPath, { force: true });
  console.log(`[tooldesk] NSIS installer patched: ${targetPath}`);
}

const scripts = listInstallerScripts();

if (scripts.length === 0) {
  console.log('[tooldesk] No NSIS installer script found, skip patch.');
  process.exit(0);
}

const makensisPath = findMakensis();

if (!makensisPath) {
  throw new Error('未找到 makensis.exe，无法重新生成 NSIS 安装包');
}

for (const installerPath of scripts) {
  patchInstallerScript(installerPath);
  rebuildInstaller(makensisPath, installerPath);
}
