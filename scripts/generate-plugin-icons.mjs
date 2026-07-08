import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const pluginArgIndex = process.argv.indexOf('--plugin');
const onlyPluginId = pluginArgIndex >= 0 ? String(process.argv[pluginArgIndex + 1] ?? '').trim() : '';
const imageSize = 256;

const accentColors = {
  blue: '#2563eb',
  emerald: '#059669',
  green: '#16a34a',
  indigo: '#4f46e5',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  rose: '#e11d48',
  violet: '#7c3aed'
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function listPluginRoots() {
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsDir, entry.name))
    .filter((pluginRoot) => fs.existsSync(path.join(pluginRoot, 'plugin.json')));
}

function getPluginSymbol(manifest) {
  const id = String(manifest.id ?? '').toLowerCase();
  const category = String(manifest.category ?? '').toLowerCase();

  if (id.includes('http')) return 'http';
  if (id.includes('host')) return 'server';
  if (id.includes('network') || id.includes('ip')) return 'network';
  if (id.includes('bookmark') || id.includes('site')) return 'bookmark';
  if (id.includes('calendar') || id.includes('period')) return 'calendar';
  if (id.includes('music')) return 'music';
  if (id.includes('keepass') || id.includes('password')) return 'key';
  if (id.includes('obsidian') || id.includes('line-extractor')) return 'document';
  if (id.includes('image') || id.includes('iopaint') || id.includes('background')) return 'image';
  if (id.includes('bank-card') || id.includes('bank-bin')) return 'card';
  if (id.includes('id-card')) return 'id-card';
  if (id.includes('tax') || id.includes('vat') || id.includes('salary') || id.includes('bonus')) return 'percent';
  if (id.includes('amount') || id.includes('rmb') || id.includes('depreciation') || id.includes('calculator')) return 'calculator';
  if (category === 'finance') return 'calculator';
  if (category === 'document') return 'document';
  if (category === 'image') return 'image';
  if (category === 'life') return 'calendar';
  if (category === 'text') return 'text';
  return 'toolbox';
}

function resolveSymbol(manifest) {
  if (manifest.symbol) {
    return manifest.symbol;
  }

  return getPluginSymbol(manifest);
}

function getSymbolPrimitives(symbol) {
  const common = {
    bookmark: [
      { type: 'rect', x: 19, y: 10, w: 26, h: 42 },
      { type: 'line', x1: 19, y1: 10, x2: 32, y2: 22 },
      { type: 'line', x1: 45, y1: 10, x2: 32, y2: 22 }
    ],
    calendar: [
      { type: 'rect', x: 12, y: 15, w: 40, h: 36 },
      { type: 'line', x1: 20, y1: 10, x2: 20, y2: 20 },
      { type: 'line', x1: 44, y1: 10, x2: 44, y2: 20 },
      { type: 'line', x1: 12, y1: 26, x2: 52, y2: 26 },
      { type: 'line', x1: 22, y1: 36, x2: 27, y2: 36 },
      { type: 'line', x1: 37, y1: 36, x2: 42, y2: 36 }
    ],
    calculator: [
      { type: 'rect', x: 17, y: 10, w: 30, h: 44 },
      { type: 'line', x1: 23, y1: 20, x2: 41, y2: 20 },
      { type: 'line', x1: 23, y1: 31, x2: 28, y2: 31 },
      { type: 'line', x1: 36, y1: 31, x2: 41, y2: 31 },
      { type: 'line', x1: 23, y1: 42, x2: 28, y2: 42 },
      { type: 'line', x1: 36, y1: 42, x2: 41, y2: 42 }
    ],
    card: [
      { type: 'rect', x: 10, y: 18, w: 44, h: 30 },
      { type: 'line', x1: 10, y1: 27, x2: 54, y2: 27 },
      { type: 'line', x1: 18, y1: 39, x2: 30, y2: 39 },
      { type: 'line', x1: 38, y1: 39, x2: 46, y2: 39 }
    ],
    document: [
      { type: 'polyline', points: [[18, 8], [38, 8], [50, 20], [50, 56], [18, 56], [18, 8]] },
      { type: 'polyline', points: [[38, 8], [38, 21], [50, 21]] },
      { type: 'line', x1: 25, y1: 33, x2: 43, y2: 33 },
      { type: 'line', x1: 25, y1: 43, x2: 39, y2: 43 }
    ],
    http: [
      { type: 'line', x1: 10, y1: 18, x2: 38, y2: 18 },
      { type: 'line', x1: 10, y1: 32, x2: 34, y2: 32 },
      { type: 'line', x1: 10, y1: 46, x2: 28, y2: 46 },
      { type: 'polyline', points: [[39, 23], [54, 32], [39, 41]] }
    ],
    'id-card': [
      { type: 'rect', x: 10, y: 18, w: 44, h: 30 },
      { type: 'circle', cx: 42, cy: 29, r: 5 },
      { type: 'line', x1: 18, y1: 29, x2: 30, y2: 29 },
      { type: 'line', x1: 18, y1: 39, x2: 42, y2: 39 }
    ],
    image: [
      { type: 'rect', x: 12, y: 12, w: 40, h: 40 },
      { type: 'circle', cx: 24, cy: 24, r: 4 },
      { type: 'polyline', points: [[16, 45], [28, 33], [36, 41], [43, 31], [51, 43]] }
    ],
    key: [
      { type: 'circle', cx: 24, cy: 32, r: 10 },
      { type: 'line', x1: 34, y1: 32, x2: 54, y2: 32 },
      { type: 'line', x1: 46, y1: 32, x2: 46, y2: 41 },
      { type: 'line', x1: 54, y1: 32, x2: 54, y2: 38 }
    ],
    music: [
      { type: 'line', x1: 24, y1: 45, x2: 24, y2: 17 },
      { type: 'line', x1: 24, y1: 17, x2: 48, y2: 11 },
      { type: 'line', x1: 48, y1: 11, x2: 48, y2: 39 },
      { type: 'filledCircle', cx: 19, cy: 45, r: 7 },
      { type: 'filledCircle', cx: 43, cy: 39, r: 7 }
    ],
    network: [
      { type: 'circle', cx: 32, cy: 32, r: 20 },
      { type: 'line', x1: 12, y1: 32, x2: 52, y2: 32 },
      { type: 'polyline', points: [[32, 12], [39, 24], [39, 40], [32, 52]] },
      { type: 'polyline', points: [[32, 12], [25, 24], [25, 40], [32, 52]] }
    ],
    percent: [
      { type: 'circle', cx: 23, cy: 23, r: 5 },
      { type: 'circle', cx: 41, cy: 41, r: 5 },
      { type: 'line', x1: 44, y1: 18, x2: 20, y2: 46 }
    ],
    server: [
      { type: 'rect', x: 13, y: 13, w: 38, h: 16 },
      { type: 'rect', x: 13, y: 35, w: 38, h: 16 },
      { type: 'line', x1: 21, y1: 21, x2: 29, y2: 21 },
      { type: 'line', x1: 21, y1: 43, x2: 29, y2: 43 },
      { type: 'filledCircle', cx: 43, cy: 21, r: 2 },
      { type: 'filledCircle', cx: 43, cy: 43, r: 2 }
    ],
    text: [
      { type: 'line', x1: 14, y1: 18, x2: 50, y2: 18 },
      { type: 'line', x1: 14, y1: 30, x2: 44, y2: 30 },
      { type: 'line', x1: 14, y1: 42, x2: 50, y2: 42 }
    ],
    toolbox: [
      { type: 'polyline', points: [[10, 27], [32, 11], [54, 27]] },
      { type: 'rect', x: 15, y: 25, w: 34, h: 28 },
      { type: 'line', x1: 25, y1: 25, x2: 25, y2: 18 },
      { type: 'line', x1: 39, y1: 25, x2: 39, y2: 18 }
    ]
  };

  return common[symbol] ?? common.toolbox;
}

function primitiveToSvg(primitive) {
  if (primitive.type === 'line') {
    return `<line x1="${primitive.x1}" y1="${primitive.y1}" x2="${primitive.x2}" y2="${primitive.y2}" />`;
  }

  if (primitive.type === 'rect') {
    return `<rect x="${primitive.x}" y="${primitive.y}" width="${primitive.w}" height="${primitive.h}" rx="4" />`;
  }

  if (primitive.type === 'circle') {
    return `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.r}" />`;
  }

  if (primitive.type === 'filledCircle') {
    return `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.r}" fill="currentColor" stroke="none" />`;
  }

  if (primitive.type === 'polyline') {
    return `<polyline points="${primitive.points.map(([x, y]) => `${x},${y}`).join(' ')}" />`;
  }

  return '';
}

function generateSvg(manifest) {
  const color = accentColors[String(manifest.accent ?? '').trim()] ?? accentColors.blue;
  const primitives = getSymbolPrimitives(resolveSymbol(manifest));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(String(manifest.name ?? 'Tooldesk plugin'))}" fill="none" color="${color}" stroke="currentColor" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round">
  <g>${primitives.map(primitiveToSvg).join('')}</g>
</svg>
`;
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function hexToRgba(hex) {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255
  ];
}

function blendPixel(buffer, x, y, color) {
  if (x < 0 || y < 0 || x >= imageSize || y >= imageSize) {
    return;
  }

  const index = (Math.round(y) * imageSize + Math.round(x)) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  buffer[index] = Math.round(color[0] * alpha + buffer[index] * inverse);
  buffer[index + 1] = Math.round(color[1] * alpha + buffer[index + 1] * inverse);
  buffer[index + 2] = Math.round(color[2] * alpha + buffer[index + 2] * inverse);
  buffer[index + 3] = Math.min(255, Math.round(color[3] + buffer[index + 3] * inverse));
}

function drawDisk(buffer, cx, cy, radius, color) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        blendPixel(buffer, x, y, color);
      }
    }
  }
}

function scale(value) {
  return (value / 64) * imageSize;
}

function drawLine(buffer, x1, y1, x2, y2, color, width = 18) {
  const sx1 = scale(x1);
  const sy1 = scale(y1);
  const sx2 = scale(x2);
  const sy2 = scale(y2);
  const steps = Math.max(Math.abs(sx2 - sx1), Math.abs(sy2 - sy1), 1);

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    drawDisk(buffer, sx1 + (sx2 - sx1) * t, sy1 + (sy2 - sy1) * t, width / 2, color);
  }
}

function drawCircle(buffer, cx, cy, radius, color) {
  let previous = null;

  for (let index = 0; index <= 160; index += 1) {
    const angle = (Math.PI * 2 * index) / 160;
    const point = [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];

    if (previous) {
      drawLine(buffer, previous[0], previous[1], point[0], point[1], color);
    }

    previous = point;
  }
}

function drawPrimitive(buffer, primitive, color) {
  if (primitive.type === 'line') {
    drawLine(buffer, primitive.x1, primitive.y1, primitive.x2, primitive.y2, color);
    return;
  }

  if (primitive.type === 'rect') {
    drawLine(buffer, primitive.x, primitive.y, primitive.x + primitive.w, primitive.y, color);
    drawLine(buffer, primitive.x + primitive.w, primitive.y, primitive.x + primitive.w, primitive.y + primitive.h, color);
    drawLine(buffer, primitive.x + primitive.w, primitive.y + primitive.h, primitive.x, primitive.y + primitive.h, color);
    drawLine(buffer, primitive.x, primitive.y + primitive.h, primitive.x, primitive.y, color);
    return;
  }

  if (primitive.type === 'circle') {
    drawCircle(buffer, primitive.cx, primitive.cy, primitive.r, color);
    return;
  }

  if (primitive.type === 'filledCircle') {
    drawDisk(buffer, scale(primitive.cx), scale(primitive.cy), scale(primitive.r), color);
    return;
  }

  if (primitive.type === 'polyline') {
    for (let index = 1; index < primitive.points.length; index += 1) {
      const [x1, y1] = primitive.points[index - 1];
      const [x2, y2] = primitive.points[index];
      drawLine(buffer, x1, y1, x2, y2, color);
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function generatePng(manifest) {
  const color = hexToRgba(accentColors[String(manifest.accent ?? '').trim()] ?? accentColors.blue);
  const pixels = Buffer.alloc(imageSize * imageSize * 4);

  for (const primitive of getSymbolPrimitives(resolveSymbol(manifest))) {
    drawPrimitive(pixels, primitive, color);
  }

  const scanlines = Buffer.alloc((imageSize * 4 + 1) * imageSize);

  for (let y = 0; y < imageSize; y += 1) {
    const rowStart = y * (imageSize * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * imageSize * 4, (y + 1) * imageSize * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(imageSize, 0);
  header.writeUInt32BE(imageSize, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function updatePluginIcons(pluginRoot) {
  const manifestPath = path.join(pluginRoot, 'plugin.json');
  const manifest = readJson(manifestPath);
  const pluginId = String(manifest.id ?? path.basename(pluginRoot));
  const assetsDir = path.join(pluginRoot, 'assets');
  const iconPath = path.join(assetsDir, 'icon.svg');
  const windowPngPath = path.join(assetsDir, 'window-icon.png');

  fs.mkdirSync(assetsDir, { recursive: true });

  if (force || !fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, generateSvg(manifest), 'utf-8');
    manifest.icon = 'assets/icon.svg';
  } else if (!manifest.icon) {
    manifest.icon = 'assets/icon.svg';
  }

  if (force || !fs.existsSync(windowPngPath)) {
    fs.writeFileSync(windowPngPath, generatePng(manifest));
  }

  if (!manifest.windowIcon || force) {
    manifest.windowIcon = 'assets/window-icon.png';
  }

  writeJson(manifestPath, manifest);
  console.info(`[plugin:icons] ${pluginId} -> ${manifest.icon}, ${manifest.windowIcon}`);
}

for (const pluginRoot of listPluginRoots()) {
  const manifest = readJson(path.join(pluginRoot, 'plugin.json'));
  const pluginId = String(manifest.id ?? path.basename(pluginRoot));

  if (onlyPluginId && pluginId !== onlyPluginId) {
    continue;
  }

  updatePluginIcons(pluginRoot);
}

const SYSTEM_TOOL_ICON_MANIFESTS = [
  {
    toolId: 'static-server',
    name: '静态服务器',
    accent: 'emerald',
    symbol: 'server'
  }
];

function updateSystemToolWindowIcons() {
  for (const entry of SYSTEM_TOOL_ICON_MANIFESTS) {
    const assetsDir = path.join(rootDir, 'src', 'tools', entry.toolId, 'assets');
    const windowPngPath = path.join(assetsDir, 'window-icon.png');

    fs.mkdirSync(assetsDir, { recursive: true });

    if (force || !fs.existsSync(windowPngPath)) {
      fs.writeFileSync(windowPngPath, generatePng(entry));
      console.info(`[plugin:icons] system tool ${entry.toolId} -> ${windowPngPath}`);
    }
  }
}

updateSystemToolWindowIcons();
