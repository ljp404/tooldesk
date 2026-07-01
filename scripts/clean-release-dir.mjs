import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanTargets = [
  path.join(rootDir, 'release'),
  path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle'),
  path.join(rootDir, 'src-tauri', 'target', 'release', 'nsis'),
  path.join(rootDir, 'src-tauri', 'target', 'release', 'wix')
];

function assertInsideRoot(targetPath) {
  const relative = path.relative(rootDir, targetPath);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理项目根目录外路径：${targetPath}`);
  }
}

for (const target of cleanTargets) {
  assertInsideRoot(target);
  fs.rmSync(target, { force: true, recursive: true });
  console.info(`[build] cleaned ${path.relative(rootDir, target)}`);
}
