import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'dist', 'plugins');
const targetDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'public', 'plugins');
const sourceManifest = path.join(sourceDir, 'manifest.json');

if (!fs.existsSync(sourceManifest)) {
  console.error('[android-web-plugins] dist/plugins/manifest.json not found. Run npm run build:web first.');
  process.exit(1);
}

fs.rmSync(targetDir, { force: true, recursive: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(sourceManifest, 'utf-8'));
const count = Array.isArray(manifest.plugins) ? manifest.plugins.length : 0;
console.info(`[android-web-plugins] copied ${count} plugin(s) to android assets`);
