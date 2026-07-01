/* eslint-env browser */
// Debug: set false to disable color picker / magnifier and isolate drag lag.
const PICKER_ENABLED = false;
const overlayScriptLoadedAt = window.performance?.now?.() ?? Date.now();
const root = document.getElementById('root');
const selectionEl = document.getElementById('selection');
const selectionDragPreviewEl = document.getElementById('selection-drag');
const selectionMask = document.getElementById('selection-mask');
const selectionMaskPieces = {
  bottom: selectionMask?.querySelector('[data-mask-piece="bottom"]'),
  left: selectionMask?.querySelector('[data-mask-piece="left"]'),
  right: selectionMask?.querySelector('[data-mask-piece="right"]'),
  top: selectionMask?.querySelector('[data-mask-piece="top"]')
};
const selectionHandles = document.getElementById('selection-handles');
const recordingPlaybackEl = document.getElementById('recording-playback');
const recordingPlaybackVideo = document.getElementById('recording-playback-video');
const recordingPlaybackToggle = document.getElementById('recording-playback-toggle');
const recordingPlaybackSeek = document.getElementById('recording-playback-seek');
const recordingPlaybackTime = document.getElementById('recording-playback-time');
const annotateLayer = document.getElementById('annotate-layer');
const paintLayer = document.getElementById('paint-layer');
const textLayer = document.getElementById('text-layer');
const ocrStatus = document.getElementById('ocr-status');
const ocrResultOpen = document.getElementById('ocr-result-open');
const ocrResultPanel = document.getElementById('ocr-result-panel');
const ocrResultText = document.getElementById('ocr-result-text');
const ocrResultCopy = document.getElementById('ocr-result-copy');
const ocrResultClose = document.getElementById('ocr-result-close');
const ocrResultPanelHead = document.querySelector('.ocr-result-panel-head');
const sizeLabel = document.getElementById('size-label');
const pickerInfo = document.getElementById('picker-info');
const pickerMagnifier = document.getElementById('picker-magnifier');
const pickerCoords = document.getElementById('picker-coords');
const pickerSwatch = document.getElementById('picker-swatch');
const pickerHex = document.getElementById('picker-hex');
const pickerHint = document.getElementById('picker-hint');
const mosaicCursor = document.getElementById('mosaic-cursor');
const toolbarWrap = document.getElementById('toolbar-wrap');
const toolbar = document.getElementById('toolbar');
const undoButton = toolbar?.querySelector('button[data-action="undo"]');
const annotateOptionsWrap = document.getElementById('annotate-options-wrap');
const annotateOptions = document.getElementById('annotate-options');
const strokeSlider = document.getElementById('annotate-stroke-slider');
const strokeValueLabel = document.getElementById('annotate-stroke-value');
const strokeTrigger = document.querySelector('.annotate-stroke-trigger');
const brushSlider = document.getElementById('annotate-brush-slider');
const brushValueLabel = document.getElementById('annotate-brush-value');
const brushPreview = document.getElementById('annotate-brush-preview');
const textSizeSlider = document.getElementById('annotate-text-size-slider');
const textSizeValueLabel = document.getElementById('annotate-text-size-value');
const textSizePreview = document.getElementById('annotate-text-size-preview');
const brushTrigger = document.querySelector('.annotate-brush-trigger');
const strokeTertiary = document.querySelector('.annotate-stroke-tertiary');
const brushTertiary = document.querySelector('.annotate-brush-tertiary');
const lineStylePicker = document.querySelector('.annotate-line-style-picker');
const lineStyleTrigger = document.querySelector('.annotate-line-style-trigger');
const lineStyleMenu = document.querySelector('.annotate-line-style-menu');
const linePreviewPath = document.getElementById('annotate-line-preview');
const screenBorder = document.getElementById('screen-border');

const LINE_STYLE_SOLID = 'solid';
const LINE_DASH_PATTERNS = {
  dash1: '4 4',
  dash2: '8 6',
  dash3: '12 8',
  dash4: '16 10',
  solid: ''
};
const CANVAS_DASH_PATTERNS = {
  dash1: [4, 4],
  dash2: [8, 6],
  dash3: [12, 8],
  dash4: [16, 10],
  solid: []
};

const STROKE_WIDTH_MIN = 2;
const STROKE_WIDTH_MAX = 12;
const BRUSH_SIZE_MIN = 2;
const BRUSH_SIZE_MAX = 32;
const TEXT_FONT_SIZE_MIN = 12;
const TEXT_FONT_SIZE_MAX = 96;

const searchParams = new URLSearchParams(window.location.search);
let offsetX = Number(searchParams.get('offsetX') ?? 0);
let offsetY = Number(searchParams.get('offsetY') ?? 0);
let screenScale = Number(searchParams.get('scale') ?? window.devicePixelRatio ?? 1);
let ocrEnabled = searchParams.get('ocrEnabled') !== '0';
let translateEnabled = searchParams.get('translateEnabled') !== '0';

const ANNOTATE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827'];
const ANNOTATE_FONT = 16;
const TEXT_INPUT_PADDING_X = 8;
const TEXT_INPUT_PADDING_Y = 4;
const MIN_SHAPE_SIZE = 4;
const MIN_PAINT_POINT_DISTANCE = 2;
const MOSAIC_BLOCK_SIZE = 8;
const SHAPE_BOX_TOOLS = new Set(['rect', 'ellipse']);
const SHAPE_SUB_TOOLS = new Set(['rect', 'ellipse', 'arrow', 'text']);
const VECTOR_SHAPE_TYPES = new Set(['rect', 'ellipse', 'arrow', 'text']);
const TOOLS_WITH_SUB_OPTIONS = new Set(['rect', 'ellipse', 'arrow', 'brush', 'mosaic', 'text']);
const PAINT_TOOLS = new Set(['brush', 'mosaic']);

const annotateSettings = {
  brushSize: 14,
  color: ANNOTATE_COLORS[0],
  fontSize: ANNOTATE_FONT,
  lineStyle: LINE_STYLE_SOLID,
  shape: 'rect',
  strokeWidth: 2
};

let dragging = false;
let isBusy = false;
let ocrReady = false;
let translateReady = false;
let ocrGeneration = 0;
let lastOcrText = '';
let lastOcrResult = null;
let lastOcrRect = null;
const translationCache = new Map();
let ocrPanelDragging = false;
let ocrPanelDragStart = null;
let startX = 0;
let startY = 0;
let currentRect = null;
let activeTool = null;
let annotations = [];
let annotateDragging = false;
let paintDragging = false;
let annotateStart = null;
let previewShape = null;
let activePaintStroke = null;
let pendingTextInput = null;
let paintCtx = null;
let selectionBaseImage = null;
let selectionBaseImageEl = null;
let blockToolbarToolActivation = false;
let selectedAnnotationIndex = null;
let selectionResizeDragging = false;
let selectionResizeHandleId = null;
let selectionResizeStart = null;
let selectionResizeSnapshot = null;
let selectionDragLogged = false;
let moveDragging = false;
let moveStart = null;
let moveSnapshot = null;
let toolbarDragging = false;
let toolbarDragStart = null;
let toolbarManualPosition = null;
let activeSelectionPointerId = null;
let selectionDragStartedAt = 0;
let pendingDragPointer = null;
let dragPreviewRafId = 0;
let dragPreviewLoopRafId = 0;
let dragMoveEventCount = 0;
let paintLayerSize = { height: 0, width: 0 };
let resizeDragging = false;
let resizeHandleId = null;
let resizeStart = null;
let resizeSnapshot = null;
let lastPickerHex = '';
let lastPickerReady = false;
let pendingPickerPoint = null;
let lastPickerPoint = null;
let pickerFrame = 0;
let pickerSuppressedAfterSelectionStart = false;
let pendingShortcutStartConfig = null;
let colorSamplerTimer = 0;
let colorSamplerLoading = false;
let colorSampleRequestId = 0;
let colorSamplerSessionId = 0;
let magnifierRequestId = 0;
let initialPickerSnapshot = null;
let initialPickerSnapshotPending = null;
let pickerWarmupTimer = 0;
let lastDragPaintX = NaN;
let lastDragPaintY = NaN;
let scrollCaptureMode = false;
let recordingRegionMode = false;
let regionPlaybackMode = false;
let regionPlaybackSeekDragging = false;
let regionPlaybackWasPlayingBeforeSeek = false;
let regionPlaybackCropRect = null;
let regionPlaybackSourceSize = null;
let regionPlaybackDurationHint = 0;
let regionPlaybackProgressFrame = 0;
let mousePassthroughActive = false;
let mousePassthroughForward = true;
let scrollCaptureTimer = 0;
let scrollCapturePassthroughTimer = 0;
let scrollCaptureSampling = false;
let scrollCaptureAutoRunId = 0;
let scrollCaptureAutoRunning = false;
let scrollCapturePointerPassthrough = false;
let scrollCaptureFrames = [];
let scrollCaptureLastStitchedFrame = null;
let scrollCapturePieces = [];
let scrollCapturePreparedImage = null;
let scrollCaptureTotalHeight = 0;
let scrollCaptureStitchedWithOverlap = false;
const colorSampler = {
  frames: [],
  ready: false
};

const SCROLL_CAPTURE_INTERVAL = 320;
const SCROLL_AUTO_STEP_DELAY = 300;
const SCROLL_AUTO_MAX_STEPS = 160;
const SCROLL_AUTO_IDLE_LIMIT = 3;
const SCROLL_AUTO_WHEEL_DELTA = -120;
const SCROLL_AUTO_MAX_NEW_CONTENT_RATIO = 0.24;
const SCROLL_AUTO_MIN_NEW_CONTENT_RATIO = 0.006;
const MAX_SCROLL_CAPTURE_FRAMES = 16;
const MAX_SCROLL_CAPTURE_OUTPUT_HEIGHT = 12000;
const OVERLAP_MATCH_WIDTH = 280;
const SCROLL_STITCH_EDGE_IGNORE_RATIO = 0.06;
const SCROLL_OVERLAP_DIFF_THRESHOLD = 34;
const SCROLL_OVERLAP_AMBIGUITY_GAP = 4;
const SCROLL_MAX_NEW_CONTENT_RATIO = 0.72;
const SCROLL_MIN_NEW_CONTENT_RATIO = 0.01;
const SCROLLBAR_END_MARGIN = 24;
const SCROLL_PASSTHROUGH_RELEASE_MS = 1000;
const PICKER_MAGNIFIER_ZOOM = 4;
const PICKER_MAGNIFIER_SAMPLE_SIZE = 25;

function logScrollCapture(message, payload = {}) {
  const entry = {
    autoRunning: scrollCaptureAutoRunning,
    frames: scrollCaptureFrames.length,
    hasPreparedImage: Boolean(scrollCapturePreparedImage?.png),
    mode: scrollCaptureMode,
    pieces: scrollCapturePieces.length,
    stitched: scrollCaptureStitchedWithOverlap,
    totalHeight: scrollCaptureTotalHeight,
    ...payload
  };
  console.info('[tooldesk scroll-capture]', message, entry);
  void window.screenshotOverlay?.debugLog?.('scroll-capture', `${message} ${JSON.stringify(entry)}`);
}

function waitForColorSamplerReady(timeout = 800) {
  if (colorSampler.ready) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (colorSampler.ready) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeout) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 32);
  });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isPickerEnabled() {
  return PICKER_ENABLED;
}

function scheduleColorSamplerInit(delay = 80) {
  if (!isPickerEnabled()) {
    return;
  }
  if (colorSampler.ready || colorSamplerLoading) {
    return;
  }

  cancelScheduledColorSamplerInit();

  colorSamplerTimer = window.setTimeout(() => {
    colorSamplerTimer = 0;
    if (shouldDeferColorSamplerInit()) {
      scheduleColorSamplerInit(700);
      return;
    }

    colorSamplerLoading = true;
    void initColorSampler()
      .catch((error) => {
        console.warn('[screenshot-picker] color sampler failed', error);
      })
      .finally(() => {
        colorSamplerLoading = false;
        refreshLastPickerColor();
      });
  }, delay);
}

function cancelScheduledColorSamplerInit() {
  if (!colorSamplerTimer) {
    return;
  }

  window.clearTimeout(colorSamplerTimer);
  colorSamplerTimer = 0;
}

function cancelPickerSampling() {
  pendingPickerPoint = null;
  lastPickerPoint = null;
  colorSampleRequestId += 1;
  colorSamplerLoading = false;
  cancelScheduledColorSamplerInit();

  if (pickerFrame) {
    window.cancelAnimationFrame(pickerFrame);
    pickerFrame = 0;
  }

  hidePickerInfo();
}

function cancelInitialPickerSnapshot() {
  initialPickerSnapshot = null;
  initialPickerSnapshotPending = null;
}

function cancelDeferredPickerWarmup() {
  if (!pickerWarmupTimer) {
    return;
  }

  window.clearTimeout(pickerWarmupTimer);
  pickerWarmupTimer = 0;
}

function scheduleDeferredPickerWarmup(sessionId, attempt = 0) {
  if (!isPickerEnabled()) {
    return;
  }

  cancelDeferredPickerWarmup();

  const delay = attempt === 0 ? 400 : 700;
  pickerWarmupTimer = window.setTimeout(() => {
    pickerWarmupTimer = 0;

    if (sessionId !== colorSamplerSessionId) {
      return;
    }

    if (shouldDeferColorSamplerInit()) {
      if (attempt < 16) {
        scheduleDeferredPickerWarmup(sessionId, attempt + 1);
      }
      return;
    }

    scheduleColorSamplerInit(0);
    prepareInitialPickerSnapshotInBackground(sessionId);
  }, delay);
}

function clearPickerState() {
  cancelPickerSampling();
  cancelInitialPickerSnapshot();
  cancelDeferredPickerWarmup();
  colorSampler.frames = [];
  colorSampler.ready = false;
  colorSamplerLoading = false;
  colorSamplerSessionId += 1;
  colorSampleRequestId += 1;
  magnifierRequestId += 1;
  initialPickerSnapshot = null;
  initialPickerSnapshotPending = null;
  lastPickerHex = '';
  lastPickerReady = false;

  if (pickerMagnifier instanceof HTMLCanvasElement) {
    const ctx = pickerMagnifier.getContext('2d');
    ctx?.clearRect(0, 0, pickerMagnifier.width, pickerMagnifier.height);
    pickerMagnifier.hidden = true;
  }
}

function shouldDeferColorSamplerInit() {
  return Boolean(
    dragging ||
      annotateDragging ||
      paintDragging ||
      moveDragging ||
      resizeDragging ||
      selectionResizeDragging ||
      toolbarDragging ||
      isBusy ||
      recordingRegionMode ||
      regionPlaybackMode ||
      scrollCaptureMode ||
      (currentRect && currentRect.width >= 2 && currentRect.height >= 2)
  );
}

function requestNativePickerColor(clientX, clientY, screenPoint) {
  if (!window.screenshotOverlay?.sampleColor) {
    return;
  }

  lastPickerPoint = { clientX, clientY, screenPoint };
  const requestId = colorSampleRequestId + 1;
  const sessionId = colorSamplerSessionId;
  colorSampleRequestId = requestId;
  colorSamplerLoading = true;

  void window.screenshotOverlay
    .sampleColor(screenPoint)
    .then((color) => {
      if (requestId !== colorSampleRequestId || sessionId !== colorSamplerSessionId) {
        return;
      }

      colorSamplerLoading = false;
      renderPickerInfo(clientX, clientY, screenPoint, color);
    })
    .catch((error) => {
      if (requestId !== colorSampleRequestId || sessionId !== colorSamplerSessionId) {
        return;
      }

      colorSamplerLoading = false;
      console.warn('[screenshot-picker] native color sample failed', error);
      hidePickerInfo();
    });
}

function sameRect(a, b) {
  return Boolean(
    a &&
      b &&
      Math.round(a.x) === Math.round(b.x) &&
      Math.round(a.y) === Math.round(b.y) &&
      Math.round(a.width) === Math.round(b.width) &&
      Math.round(a.height) === Math.round(b.height)
  );
}

function toHexByte(value) {
  return value.toString(16).padStart(2, '0');
}

async function initColorSampler(attempt = 0, sessionId = colorSamplerSessionId) {
  if (sessionId !== colorSamplerSessionId) {
    return;
  }

  const frames = await window.screenshotOverlay?.getColorFrames?.();

  if (sessionId !== colorSamplerSessionId) {
    return;
  }

  if (!Array.isArray(frames) || frames.length === 0) {
    if (attempt < 40) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return initColorSampler(attempt + 1, sessionId);
    }

    return;
  }

  const nextFrames = await Promise.all(
    frames.map(
      (frame) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = frame.width;
            canvas.height = frame.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (!ctx) {
              reject(new Error('无法创建取色画布'));
              return;
            }

            ctx.drawImage(image, 0, 0);
            resolve({ ...frame, canvas, ctx, scale: Number(frame.scale || 1) });
          };
          image.onerror = () => reject(new Error('取色底图加载失败'));
          image.src = frame.dataUrl;
        })
    )
  );
  if (sessionId !== colorSamplerSessionId) {
    return;
  }

  colorSampler.frames = nextFrames;
  colorSampler.ready = true;
}

function findColorFrame(screenX, screenY) {
  for (const frame of colorSampler.frames) {
    const bounds = frame.bounds;

    if (
      screenX >= bounds.x &&
      screenX < bounds.x + bounds.width &&
      screenY >= bounds.y &&
      screenY < bounds.y + bounds.height
    ) {
      return frame;
    }
  }

  return colorSampler.frames[0] ?? null;
}

function sampleLocalColor(screenX, screenY) {
  const frame = findColorFrame(screenX, screenY);

  if (!frame?.ctx) {
    return null;
  }

  const localX = Math.min(frame.width - 1, Math.max(0, Math.round((screenX - frame.bounds.x) * frame.scale)));
  const localY = Math.min(frame.height - 1, Math.max(0, Math.round((screenY - frame.bounds.y) * frame.scale)));
  const [red, green, blue] = frame.ctx.getImageData(localX, localY, 1, 1).data;

  return {
    b: blue,
    g: green,
    hex: `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`.toUpperCase(),
    r: red
  };
}

function renderPickerMagnifier(screenX, screenY) {
  if (!(pickerMagnifier instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = pickerMagnifier.getContext('2d');

  if (!ctx) {
    return;
  }

  const frame = findColorFrame(screenX, screenY);
  ctx.clearRect(0, 0, pickerMagnifier.width, pickerMagnifier.height);

  if (!frame?.canvas) {
    pickerMagnifier.hidden = true;
    return;
  }

  pickerMagnifier.hidden = false;

  const localX = Math.min(frame.width - 1, Math.max(0, Math.round((screenX - frame.bounds.x) * frame.scale)));
  const localY = Math.min(frame.height - 1, Math.max(0, Math.round((screenY - frame.bounds.y) * frame.scale)));
  const sampleSize = Math.min(PICKER_MAGNIFIER_SAMPLE_SIZE, frame.width, frame.height);
  const sourceX = Math.min(Math.max(0, localX - Math.floor(sampleSize / 2)), Math.max(0, frame.width - sampleSize));
  const sourceY = Math.min(Math.max(0, localY - Math.floor(sampleSize / 2)), Math.max(0, frame.height - sampleSize));

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(frame.canvas, sourceX, sourceY, sampleSize, sampleSize, 0, 0, pickerMagnifier.width, pickerMagnifier.height);
  ctx.imageSmoothingEnabled = true;

  const centerX = Math.round(((localX - sourceX + 0.5) / sampleSize) * pickerMagnifier.width);
  const centerY = Math.round(((localY - sourceY + 0.5) / sampleSize) * pickerMagnifier.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX + 0.5, 0);
  ctx.lineTo(centerX + 0.5, pickerMagnifier.height);
  ctx.moveTo(0, centerY + 0.5);
  ctx.lineTo(pickerMagnifier.width, centerY + 0.5);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(75, 85, 99, 0.88)';
  ctx.strokeRect(centerX - PICKER_MAGNIFIER_ZOOM / 2, centerY - PICKER_MAGNIFIER_ZOOM / 2, PICKER_MAGNIFIER_ZOOM, PICKER_MAGNIFIER_ZOOM);
}

function drawMagnifierImage(image) {
  if (!(pickerMagnifier instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = pickerMagnifier.getContext('2d');

  if (!ctx) {
    return;
  }

  pickerMagnifier.hidden = false;
  ctx.clearRect(0, 0, pickerMagnifier.width, pickerMagnifier.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, pickerMagnifier.width, pickerMagnifier.height);
  ctx.imageSmoothingEnabled = true;

  const centerX = Math.round(pickerMagnifier.width / 2);
  const centerY = Math.round(pickerMagnifier.height / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX + 0.5, 0);
  ctx.lineTo(centerX + 0.5, pickerMagnifier.height);
  ctx.moveTo(0, centerY + 0.5);
  ctx.lineTo(pickerMagnifier.width, centerY + 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(75, 85, 99, 0.88)';
  ctx.strokeRect(centerX - PICKER_MAGNIFIER_ZOOM / 2, centerY - PICKER_MAGNIFIER_ZOOM / 2, PICKER_MAGNIFIER_ZOOM, PICKER_MAGNIFIER_ZOOM);
}

function drawMagnifierCrosshair() {
  if (!(pickerMagnifier instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = pickerMagnifier.getContext('2d');

  if (!ctx) {
    return;
  }

  const centerX = Math.round(pickerMagnifier.width / 2);
  const centerY = Math.round(pickerMagnifier.height / 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX + 0.5, 0);
  ctx.lineTo(centerX + 0.5, pickerMagnifier.height);
  ctx.moveTo(0, centerY + 0.5);
  ctx.lineTo(pickerMagnifier.width, centerY + 0.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(75, 85, 99, 0.88)';
  ctx.strokeRect(centerX - PICKER_MAGNIFIER_ZOOM / 2, centerY - PICKER_MAGNIFIER_ZOOM / 2, PICKER_MAGNIFIER_ZOOM, PICKER_MAGNIFIER_ZOOM);
}

function drawMagnifierFrame(frame) {
  if (!(pickerMagnifier instanceof HTMLCanvasElement)) {
    return false;
  }

  const width = Math.round(Number(frame?.width ?? 0));
  const height = Math.round(Number(frame?.height ?? 0));
  const rgba = Array.isArray(frame?.rgba) ? frame.rgba : null;

  if (!width || !height || !rgba || rgba.length < width * height * 4) {
    return false;
  }

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d');
  const ctx = pickerMagnifier.getContext('2d');

  if (!sourceCtx || !ctx) {
    return false;
  }

  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  pickerMagnifier.hidden = false;
  ctx.clearRect(0, 0, pickerMagnifier.width, pickerMagnifier.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, width, height, 0, 0, pickerMagnifier.width, pickerMagnifier.height);
  ctx.imageSmoothingEnabled = true;
  drawMagnifierCrosshair();
  return true;
}

function loadMagnifierFrameImage(frame) {
  return new Promise((resolve, reject) => {
    if (!frame?.dataUrl) {
      reject(new Error('missing magnifier frame'));
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('failed to decode magnifier frame'));
    image.src = frame.dataUrl;
  });
}

function isLowInformationMagnifierImage(image) {
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 8;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });

  if (!probeCtx) {
    return false;
  }

  probeCtx.drawImage(image, 0, 0, image.width, image.height, 0, 0, probe.width, probe.height);
  const data = probeCtx.getImageData(0, 0, probe.width, probe.height).data;
  let min = 255;
  let max = 0;
  let brightPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const value = Math.round((red + green + blue) / 3);

    min = Math.min(min, value);
    max = Math.max(max, value);

    if (value > 238) {
      brightPixels += 1;
    }
  }

  return max - min < 8 && brightPixels >= 60;
}

function renderNativePickerMagnifier(screenX, screenY) {
  if (colorSampler.ready) {
    renderPickerMagnifier(screenX, screenY);
    return;
  }

  magnifierRequestId += 1;
  const requestId = magnifierRequestId;
  const sessionId = colorSamplerSessionId;

  if (!window.screenshotOverlay?.getMagnifierFrame) {
    return;
  }

  void window.screenshotOverlay
    .getMagnifierFrame({
      sampleSize: PICKER_MAGNIFIER_SAMPLE_SIZE,
      x: screenX,
      y: screenY
    })
    .then((frame) => {
      if (requestId !== magnifierRequestId || sessionId !== colorSamplerSessionId || colorSampler.ready || !frame?.dataUrl) {
        if (colorSampler.ready) {
          renderPickerMagnifier(screenX, screenY);
        }
        return;
      }

      if (drawMagnifierFrame(frame)) {
        return;
      }

      const image = new Image();
      image.onload = () => {
        if (requestId !== magnifierRequestId || sessionId !== colorSamplerSessionId || colorSampler.ready) {
          if (colorSampler.ready) {
            renderPickerMagnifier(screenX, screenY);
          }
          return;
        }

        if (isLowInformationMagnifierImage(image)) {
          refreshLastPickerColor();
          return;
        }

        drawMagnifierImage(image);
      };
      image.onerror = () => {
        if (requestId === magnifierRequestId && sessionId === colorSamplerSessionId) {
          refreshLastPickerColor();
        }
      };
      image.src = frame.dataUrl;
    })
    .catch(() => {
      if (requestId === magnifierRequestId && sessionId === colorSamplerSessionId) {
        refreshLastPickerColor();
      }
    });
}

function toLocal(clientX, clientY) {
  return {
    x: clientX,
    y: clientY
  };
}

function toScreenPoint(clientX, clientY) {
  return {
    x: Math.round(clientX * screenScale + offsetX),
    y: Math.round(clientY * screenScale + offsetY)
  };
}

function fromScreenPoint(screenX, screenY) {
  const scale = screenScale || 1;

  return {
    x: (Number(screenX) - offsetX) / scale,
    y: (Number(screenY) - offsetY) / scale
  };
}

function hidePickerInfo() {
  magnifierRequestId += 1;
  if (pickerMagnifier instanceof HTMLCanvasElement) {
    pickerMagnifier.hidden = true;
  }

  if (pickerInfo) {
    pickerInfo.hidden = true;
  }
}

function suppressPickerInfoAfterSelectionStart() {
  pickerSuppressedAfterSelectionStart = true;
  lastPickerReady = false;
  cancelPickerSampling();
}

function placePickerInfo(clientX, clientY) {
  if (!pickerInfo) {
    return;
  }

  const offset = 14;
  let left = clientX + offset;
  let top = clientY + offset;
  pickerInfo.hidden = false;
  pickerInfo.style.left = `${left}px`;
  pickerInfo.style.top = `${top}px`;

  const rect = pickerInfo.getBoundingClientRect();

  if (left + rect.width > window.innerWidth - 8) {
    left = clientX - rect.width - offset;
  }

  if (top + rect.height > window.innerHeight - 8) {
    top = clientY - rect.height - offset;
  }

  pickerInfo.style.left = `${Math.max(8, left)}px`;
  pickerInfo.style.top = `${Math.max(8, top)}px`;
}

function renderPickerInfo(clientX, clientY, screenPoint, color, options = {}) {
  if (!pickerInfo || !pickerCoords || !pickerSwatch || !pickerHex) {
    return;
  }

  pickerCoords.textContent = `${screenPoint.x}, ${screenPoint.y}`;
  lastPickerPoint = { clientX, clientY, screenPoint };

  if (options.updateMagnifier !== false) {
    renderNativePickerMagnifier(screenPoint.x, screenPoint.y);
  }

  if (color?.hex) {
    lastPickerHex = color.hex;
    lastPickerReady = true;
    pickerSwatch.style.background = color.hex;
    pickerHex.textContent = color.hex;
  } else {
    lastPickerReady = false;
    pickerSwatch.style.background = 'transparent';
    pickerHex.textContent = '--';
  }

  placePickerInfo(clientX, clientY);
}

function refreshLastPickerColor() {
  if (!lastPickerPoint || !shouldShowPickerInfo(lastPickerPoint.clientX, lastPickerPoint.clientY)) {
    return;
  }

  renderNativePickerMagnifier(lastPickerPoint.screenPoint.x, lastPickerPoint.screenPoint.y);

  const color = colorSampler.ready
    ? sampleLocalColor(lastPickerPoint.screenPoint.x, lastPickerPoint.screenPoint.y)
    : null;

  renderPickerInfo(lastPickerPoint.clientX, lastPickerPoint.clientY, lastPickerPoint.screenPoint, color);
}

function shouldShowPickerInfo(clientX, clientY) {
  if (recordingRegionMode || regionPlaybackMode || scrollCaptureMode) {
    return false;
  }

  if (pickerSuppressedAfterSelectionStart) {
    return false;
  }

  if (
    currentRect &&
    currentRect.width >= 10 &&
    currentRect.height >= 10 &&
    selectionEl.classList.contains('with-mask') &&
    isInsideCurrentSelection(clientX, clientY)
  ) {
    return false;
  }

  return true;
}

function schedulePickerUpdate(clientX, clientY) {
  if (!isPickerEnabled()) {
    return;
  }

  if (recordingRegionMode || regionPlaybackMode || scrollCaptureMode) {
    return;
  }

  if (!colorSampler.ready) {
    scheduleColorSamplerInit(1200);
  }

  pendingPickerPoint = { clientX, clientY };

  if (!pickerFrame && shouldShowPickerInfo(clientX, clientY)) {
    const screenPoint = toScreenPoint(clientX, clientY);
    const color = colorSampler.ready ? sampleLocalColor(screenPoint.x, screenPoint.y) : null;
    renderPickerInfo(clientX, clientY, screenPoint, color);
  }

  if (pickerFrame) {
    return;
  }

  pickerFrame = window.requestAnimationFrame(() => {
    pickerFrame = 0;
    const point = pendingPickerPoint;
    pendingPickerPoint = null;

    if (!point) {
      return;
    }

    if (!shouldShowPickerInfo(point.clientX, point.clientY)) {
      hidePickerInfo();
      return;
    }

    const screenPoint = toScreenPoint(point.clientX, point.clientY);
    const color = colorSampler.ready ? sampleLocalColor(screenPoint.x, screenPoint.y) : null;
    renderPickerInfo(point.clientX, point.clientY, screenPoint, color);
  });
}

async function prepareInitialPickerSnapshot(sessionId, timeoutMs = 45) {
  if (!window.screenshotOverlay?.getPickerSnapshot) {
    return false;
  }

  if (!initialPickerSnapshotPending) {
    initialPickerSnapshotPending = window.screenshotOverlay
      .getPickerSnapshot({ sampleSize: PICKER_MAGNIFIER_SAMPLE_SIZE })
      .then((snapshot) => {
        if (sessionId !== colorSamplerSessionId || !snapshot?.frame?.dataUrl) {
          return null;
        }

        return snapshot;
      })
      .catch(() => null);
  }

  const startedAt = window.performance?.now?.() ?? Date.now();
  try {
    const snapshot = await Promise.race([
      initialPickerSnapshotPending,
      delay(timeoutMs).then(() => null)
    ]);

    if (sessionId !== colorSamplerSessionId || !snapshot?.frame?.dataUrl) {
      return false;
    }

    if (drawMagnifierFrame(snapshot.frame)) {
      initialPickerSnapshot = { image: null, snapshot };
      return true;
    }

    const image = await Promise.race([
      loadMagnifierFrameImage(snapshot.frame),
      delay(Math.max(40, timeoutMs - Math.round((window.performance?.now?.() ?? Date.now()) - startedAt))).then(() => null)
    ]);

    if (sessionId !== colorSamplerSessionId || !image) {
      return false;
    }

    initialPickerSnapshot = { image, snapshot };
    return true;
  } catch {
    return false;
  }
}

function prepareInitialPickerSnapshotInBackground(sessionId) {
  if (!isPickerEnabled()) {
    return;
  }

  void prepareInitialPickerSnapshot(sessionId, 320).then((ready) => {
    if (!ready || sessionId !== colorSamplerSessionId || !pickerInfo?.hidden) {
      return;
    }

    renderInitialPickerSnapshot();
  });
}

function renderInitialPickerSnapshot() {
  const cached = initialPickerSnapshot;
  initialPickerSnapshot = null;

  if (!cached) {
    return false;
  }

  const { image, snapshot } = cached;
  const { x: clientX, y: clientY } = fromScreenPoint(snapshot.x, snapshot.y);
  if (!shouldShowPickerInfo(clientX, clientY)) {
    schedulePickerUpdate(clientX, clientY);
    return true;
  }

  if (!drawMagnifierFrame(snapshot.frame) && image) {
    drawMagnifierImage(image);
  }
  const screenPoint = toScreenPoint(clientX, clientY);
  const color = colorSampler.ready ? sampleLocalColor(screenPoint.x, screenPoint.y) : snapshot.color;
  renderPickerInfo(clientX, clientY, screenPoint, color, { updateMagnifier: false });
  schedulePickerUpdate(clientX, clientY);
  return true;
}

function showPickerAtCurrentCursor() {
  if (!isPickerEnabled()) {
    return;
  }

  if (renderInitialPickerSnapshot()) {
    return;
  }

  if (!window.screenshotOverlay?.getCursorPosition) {
    return;
  }

  showPickerAtCurrentCursorFallback(colorSamplerSessionId);
}

function showPickerAtCurrentCursorFallback(sessionId) {
  void window.screenshotOverlay
    .getCursorPosition()
    .then((position) => {
      if (sessionId !== colorSamplerSessionId || !position) {
        return;
      }

      const { x: clientX, y: clientY } = fromScreenPoint(position.x, position.y);
      if (shouldShowPickerInfo(clientX, clientY)) {
        const screenPoint = toScreenPoint(clientX, clientY);
        const color = colorSampler.ready ? sampleLocalColor(screenPoint.x, screenPoint.y) : null;
        renderPickerInfo(clientX, clientY, screenPoint, color);
      }
      schedulePickerUpdate(clientX, clientY);
    })
    .catch(() => {});
}

async function copyPickerColor() {
  if (!lastPickerReady || !lastPickerHex) {
    return;
  }

  const copied = await window.screenshotOverlay?.copyText(lastPickerHex);

  if (copied === false) {
    return;
  }

  exitScreenshot();
}

function normalizeRect(x1, y1, x2, y2) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  return { height, width, x: left, y: top };
}

function moveSelectionFromSnapshot(snapshot, deltaX, deltaY) {
  const maxX = Math.max(0, window.innerWidth - snapshot.width);
  const maxY = Math.max(0, window.innerHeight - snapshot.height);

  return {
    height: snapshot.height,
    width: snapshot.width,
    x: Math.min(Math.max(0, snapshot.x + deltaX), maxX),
    y: Math.min(Math.max(0, snapshot.y + deltaY), maxY)
  };
}

function clampPointToSelection(x, y) {
  if (!currentRect) {
    return { x, y };
  }

  return {
    x: Math.min(Math.max(x, 0), currentRect.width),
    y: Math.min(Math.max(y, 0), currentRect.height)
  };
}

function toSelectionPoint(clientX, clientY) {
  if (!currentRect) {
    return { x: 0, y: 0 };
  }

  return clampPointToSelection(clientX - currentRect.x, clientY - currentRect.y);
}

function clearOcrLayer(options = {}) {
  ocrReady = false;
  translateReady = false;
  updateTranslateButtonState();
  updateOcrButtonState();
  lastOcrText = '';
  lastOcrResult = null;
  lastOcrRect = null;
  translationCache.clear();
  ocrPanelDragging = false;
  ocrPanelDragStart = null;
  hideOcrResultPanel();
  textLayer.hidden = true;
  textLayer.innerHTML = '';
  textLayer.classList.remove('selectable');

  if (!options.preserveStatus) {
    ocrStatus.style.display = 'none';
    ocrStatus.textContent = '';
  }

  if (!options.preserveResultEntry) {
    setOcrResultEntryVisible(false);
  }
}

function clearOcrVisualLayer() {
  textLayer.hidden = true;
  textLayer.innerHTML = '';
  textLayer.classList.remove('selectable');
  window.getSelection()?.removeAllRanges();
}

function getSelectedOcrText() {
  return window.getSelection()?.toString().trim() || '';
}

function positionOcrResultControls() {
  if (!currentRect) {
    return;
  }

  if (ocrResultOpen instanceof HTMLElement && !ocrResultOpen.hidden) {
    ocrResultOpen.style.left = '8px';
    ocrResultOpen.style.top = ocrStatus.style.display === 'none' ? '8px' : '30px';
  }

  if (ocrResultPanel instanceof HTMLElement && !ocrResultPanel.hidden) {
    ocrResultPanel.style.maxWidth = `${Math.max(320, window.innerWidth - 32)}px`;
    ocrResultPanel.style.maxHeight = `${Math.max(220, Math.min(window.innerHeight - 32, (currentRect?.height ?? 0) + 160))}px`;
  }
}

function clampOcrResultPanelPosition(left, top) {
  if (!currentRect || !(ocrResultPanel instanceof HTMLElement)) {
    return { left, top };
  }

  const panelRect = ocrResultPanel.getBoundingClientRect();
  const minLeft = 8 - currentRect.x;
  const minTop = 8 - currentRect.y;
  const maxLeft = window.innerWidth - currentRect.x - panelRect.width - 8;
  const maxTop = window.innerHeight - currentRect.y - panelRect.height - 8;

  return {
    left: Math.min(Math.max(minLeft, left), Math.max(minLeft, maxLeft)),
    top: Math.min(Math.max(minTop, top), Math.max(minTop, maxTop))
  };
}

function moveOcrResultPanel(left, top) {
  if (!(ocrResultPanel instanceof HTMLElement)) {
    return;
  }

  const next = clampOcrResultPanelPosition(left, top);
  ocrResultPanel.style.left = `${next.left}px`;
  ocrResultPanel.style.top = `${next.top}px`;
}

function resizeOcrResultPanelToContent() {
  if (!(ocrResultPanel instanceof HTMLElement) || !(ocrResultText instanceof HTMLTextAreaElement)) {
    return;
  }

  const viewportMaxHeight = Math.max(180, window.innerHeight - 32);
  const selectionMaxHeight = Math.max(180, (currentRect?.height ?? 0) + 160);
  const maxPanelHeight = Math.min(viewportMaxHeight, selectionMaxHeight, 520);
  const computed = window.getComputedStyle(ocrResultText);
  const fontSize = Number.parseFloat(computed.fontSize) || 14;
  const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.65;
  const paddingY = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom);
  const borderY = Number.parseFloat(computed.borderTopWidth) + Number.parseFloat(computed.borderBottomWidth);
  const lineCount = Math.max(1, ocrResultText.value.split(/\r?\n/).length);
  const panelStyle = window.getComputedStyle(ocrResultPanel);
  const panelPaddingY = Number.parseFloat(panelStyle.paddingTop) + Number.parseFloat(panelStyle.paddingBottom);
  const panelGap = Number.parseFloat(panelStyle.rowGap || panelStyle.gap) || 0;
  const headerHeight = ocrResultPanelHead instanceof HTMLElement ? ocrResultPanelHead.offsetHeight : 0;
  const chromeHeight = panelPaddingY + panelGap + headerHeight;
  const maxTextHeight = Math.max(72, maxPanelHeight - chromeHeight);
  const contentHeight = Math.ceil(lineCount * lineHeight + paddingY + borderY);
  const nextTextHeight = Math.min(Math.max(72, contentHeight), maxTextHeight);
  ocrResultText.style.height = `${nextTextHeight}px`;
  ocrResultText.style.overflowY = contentHeight > maxTextHeight ? 'auto' : 'hidden';
  ocrResultPanel.style.height = `${Math.min(maxPanelHeight, chromeHeight + nextTextHeight)}px`;
  ocrResultPanel.style.maxHeight = `${maxPanelHeight}px`;
}

function placeOcrResultPanelNearSelection() {
  if (!currentRect || !(ocrResultPanel instanceof HTMLElement)) {
    return;
  }

  const panelRect = ocrResultPanel.getBoundingClientRect();
  const gap = 12;
  const padding = 8;
  const rightLeft = currentRect.x + currentRect.width + gap;
  const leftLeft = currentRect.x - panelRect.width - gap;
  let viewportLeft;

  if (rightLeft + panelRect.width <= window.innerWidth - padding) {
    viewportLeft = rightLeft;
  } else if (leftLeft >= padding) {
    viewportLeft = leftLeft;
  } else {
    viewportLeft = Math.min(
      Math.max(padding, currentRect.x + currentRect.width - panelRect.width),
      Math.max(padding, window.innerWidth - panelRect.width - padding)
    );
  }

  const selectionCenter = currentRect.y + currentRect.height / 2;
  const viewportTop = Math.min(
    Math.max(padding, selectionCenter - panelRect.height / 2),
    Math.max(padding, window.innerHeight - panelRect.height - padding)
  );

  moveOcrResultPanel(viewportLeft - currentRect.x, viewportTop - currentRect.y);
}

function setOcrResultText(text) {
  lastOcrText = text;

  if (ocrResultText instanceof HTMLTextAreaElement) {
    ocrResultText.value = text;
  }
}

function setOcrResultEntryVisible(visible) {
  if (!(ocrResultOpen instanceof HTMLButtonElement)) {
    return;
  }

  if (translateReady) {
    visible = false;
  }

  ocrResultOpen.hidden = !visible;
  if (visible) {
    positionOcrResultControls();
  }
}

function showOcrResultPanel() {
  if (!(ocrResultPanel instanceof HTMLElement) || !(ocrResultText instanceof HTMLTextAreaElement)) {
    return;
  }

  if (!lastOcrText.trim()) {
    return;
  }

  ocrResultText.value = lastOcrText;
  ocrResultPanel.hidden = false;
  setOcrResultEntryVisible(false);
  positionOcrResultControls();
  resizeOcrResultPanelToContent();
  placeOcrResultPanelNearSelection();
  ocrResultText.focus();
  ocrResultText.setSelectionRange(0, 0);
  ocrResultText.scrollTop = 0;
}

function hideOcrResultPanel() {
  if (ocrResultPanel instanceof HTMLElement) {
    ocrResultPanel.hidden = true;
  }

  setOcrResultEntryVisible(Boolean(ocrReady && lastOcrText && !translateReady));
}

function updateOcrButtonState() {
  const ocrButton = toolbar?.querySelector('button[data-action="ocr"]');

  if (ocrButton instanceof HTMLButtonElement) {
    ocrButton.classList.toggle('active', ocrReady && !translateReady);
  }
}

function updateTranslateButtonState() {
  const translateButton = toolbar?.querySelector('button[data-action="translate"]');

  if (translateButton instanceof HTMLButtonElement) {
    translateButton.classList.toggle('active', translateReady);
  }
}

function findLastUndoableShapeIndex() {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (SHAPE_SUB_TOOLS.has(annotations[index].type)) {
      return index;
    }
  }

  return null;
}

function updateUndoButtonState() {
  if (!(undoButton instanceof HTMLButtonElement)) {
    return;
  }

  const canUndo = findLastUndoableShapeIndex() !== null;
  undoButton.disabled = !canUndo;
  undoButton.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
}

function undoLastShape() {
  const index = findLastUndoableShapeIndex();

  if (index === null) {
    updateUndoButtonState();
    return;
  }

  annotations.splice(index, 1);

  if (selectedAnnotationIndex === index) {
    selectedAnnotationIndex = null;
  } else if (selectedAnnotationIndex !== null && selectedAnnotationIndex > index) {
    selectedAnnotationIndex -= 1;
  }

  renderAnnotations();
}

function isTextEditingEventTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function clearAnnotations() {
  annotations = [];
  previewShape = null;
  activePaintStroke = null;
  selectionBaseImage = null;
  selectionBaseImageEl = null;
  selectionResizeDragging = false;
  selectionResizeHandleId = null;
  selectionResizeStart = null;
  selectionResizeSnapshot = null;
  selectedAnnotationIndex = null;
  moveDragging = false;
  moveStart = null;
  moveSnapshot = null;
  toolbarDragging = false;
  toolbarDragStart = null;
  resizeDragging = false;
  resizeHandleId = null;
  resizeStart = null;
  resizeSnapshot = null;
  removePendingTextInput();
  renderAnnotations();
  clearPaintLayer();
}

function isVectorShape(shape) {
  return Boolean(shape && VECTOR_SHAPE_TYPES.has(shape.type));
}

function clearSelection() {
  selectedAnnotationIndex = null;
  moveDragging = false;
  moveStart = null;
  moveSnapshot = null;
  resizeDragging = false;
  resizeHandleId = null;
  resizeStart = null;
  resizeSnapshot = null;
  renderAnnotations();
}

function getSelectedAnnotation() {
  if (selectedAnnotationIndex === null) {
    return null;
  }

  return annotations[selectedAnnotationIndex] ?? null;
}

function measureTextGeometry(text, fontSize = annotateSettings.fontSize) {
  const canvas = measureTextGeometry.canvas ?? document.createElement('canvas');
  measureTextGeometry.canvas = canvas;
  const ctx = canvas.getContext('2d');
  const safeFontSize = clampTextFontSize(fontSize);

  if (!ctx) {
    return {
      height: Math.ceil(safeFontSize * 1.35),
      width: Math.max(24, Math.ceil(String(text ?? '').length * safeFontSize * 0.65))
    };
  }

  ctx.font = `600 ${safeFontSize}px Segoe UI, system-ui, sans-serif`;
  const metrics = ctx.measureText(String(text ?? ''));

  return {
    height: Math.ceil(safeFontSize * 1.35),
    width: Math.max(24, Math.ceil(metrics.width))
  };
}

function syncToolbarFromSelectedShape() {
  const shape = getSelectedAnnotation();

  if (!isVectorShape(shape)) {
    return;
  }

  annotateSettings.color = shape.color ?? annotateSettings.color;
  if (shape.type === 'text') {
    annotateSettings.fontSize = shape.fontSize ?? annotateSettings.fontSize;
    updateTextSizeUI();
  } else {
    annotateSettings.lineStyle = shape.lineStyle ?? annotateSettings.lineStyle;
    annotateSettings.strokeWidth = shape.strokeWidth ?? annotateSettings.strokeWidth;
    updateStrokeSizeUI();
    updateLineStyleUI();
  }

  for (const button of annotateOptionsWrap?.querySelectorAll('button[data-color]') ?? []) {
    button.classList.toggle(
      'active',
      button instanceof HTMLButtonElement && button.dataset.color === annotateSettings.color
    );
  }
}

function applySettingsToSelectedAnnotation() {
  const shape = getSelectedAnnotation();

  if (!isVectorShape(shape)) {
    return;
  }

  shape.color = annotateSettings.color;
  if (shape.type === 'text') {
    shape.fontSize = annotateSettings.fontSize;
    const geometry = measureTextGeometry(shape.text, shape.fontSize);
    shape.width = geometry.width;
    shape.height = geometry.height;
  } else {
    shape.lineStyle = annotateSettings.lineStyle;
    shape.strokeWidth = annotateSettings.strokeWidth;
  }
  renderAnnotations();
}

function normalizeLineStyle(lineStyle) {
  if (!lineStyle || lineStyle === LINE_STYLE_SOLID) {
    return LINE_STYLE_SOLID;
  }

  return LINE_DASH_PATTERNS[lineStyle] ? lineStyle : LINE_STYLE_SOLID;
}

function getStrokeDasharray(lineStyle) {
  return LINE_DASH_PATTERNS[normalizeLineStyle(lineStyle)] ?? '';
}

function findAnnotationIndexAtPoint(point) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const shape = annotations[index];

    if (isVectorShape(shape) && hitTestAnnotation(shape, point.x, point.y)) {
      return index;
    }
  }

  return null;
}

function selectAnnotationIndex(index) {
  if (index === null || index < 0 || index >= annotations.length) {
    return;
  }

  const shape = annotations[index];

  if (!isVectorShape(shape)) {
    return;
  }

  selectedAnnotationIndex = index;
  syncToolbarFromSelectedShape();
  renderAnnotations();
}

function deleteSelectedAnnotation() {
  if (selectedAnnotationIndex === null) {
    return;
  }

  annotations.splice(selectedAnnotationIndex, 1);
  selectedAnnotationIndex = null;
  moveDragging = false;
  moveStart = null;
  moveSnapshot = null;
  resizeDragging = false;
  resizeHandleId = null;
  resizeStart = null;
  resizeSnapshot = null;
  renderAnnotations();
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  return Math.hypot(px - projX, py - projY);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;

  return !(hasNeg && hasPos);
}

function getArrowHeadPoints(shape) {
  const { strokeWidth } = getShapeStyle(shape);
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const headLength = Math.max(10, strokeWidth * 3);

  return {
    leftX: shape.x2 - headLength * Math.cos(angle - Math.PI / 6),
    leftY: shape.y2 - headLength * Math.sin(angle - Math.PI / 6),
    rightX: shape.x2 - headLength * Math.cos(angle + Math.PI / 6),
    rightY: shape.y2 - headLength * Math.sin(angle + Math.PI / 6)
  };
}

function hitTestAnnotation(shape, px, py) {
  const padding = 6;

  if (shape.type === 'rect') {
    return (
      px >= shape.x - padding &&
      px <= shape.x + shape.width + padding &&
      py >= shape.y - padding &&
      py <= shape.y + shape.height + padding
    );
  }

  if (shape.type === 'ellipse') {
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    const rx = shape.width / 2 + padding;
    const ry = shape.height / 2 + padding;

    if (rx <= 0 || ry <= 0) {
      return false;
    }

    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;

    return dx * dx + dy * dy <= 1;
  }

  if (shape.type === 'arrow') {
    const { strokeWidth } = getShapeStyle(shape);
    const hitWidth = padding + strokeWidth / 2;

    if (distanceToSegment(px, py, shape.x1, shape.y1, shape.x2, shape.y2) <= hitWidth) {
      return true;
    }

    const head = getArrowHeadPoints(shape);

    return pointInTriangle(px, py, shape.x2, shape.y2, head.leftX, head.leftY, head.rightX, head.rightY);
  }

  if (shape.type === 'text') {
    const bounds = getShapeBounds(shape);

    return (
      px >= bounds.x - padding &&
      px <= bounds.x + bounds.width + padding &&
      py >= bounds.y - padding &&
      py <= bounds.y + bounds.height + padding
    );
  }

  return false;
}

function isPointOnSelectedAnnotation(point) {
  const shape = getSelectedAnnotation();

  return Boolean(shape && hitTestAnnotation(shape, point.x, point.y));
}

function cloneShapeGeometry(shape) {
  if (shape.type === 'rect' || shape.type === 'ellipse') {
    return {
      height: shape.height,
      width: shape.width,
      x: shape.x,
      y: shape.y
    };
  }

  if (shape.type === 'arrow') {
    return {
      x1: shape.x1,
      x2: shape.x2,
      y1: shape.y1,
      y2: shape.y2
    };
  }

  if (shape.type === 'text') {
    return {
      fontSize: shape.fontSize,
      height: shape.height,
      width: shape.width,
      x: shape.x,
      y: shape.y
    };
  }

  return null;
}

function moveShapeFromSnapshot(shape, snapshot, dx, dy) {
  if (!currentRect || !snapshot) {
    return;
  }

  if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'text') {
    shape.x = snapshot.x + dx;
    shape.y = snapshot.y + dy;
    shape.width = snapshot.width;
    shape.height = snapshot.height;
    if (shape.type === 'text') {
      shape.fontSize = snapshot.fontSize;
    }
    shape.x = Math.max(0, Math.min(shape.x, currentRect.width - shape.width));
    shape.y = Math.max(0, Math.min(shape.y, currentRect.height - shape.height));
    return;
  }

  if (shape.type === 'arrow') {
    shape.x1 = snapshot.x1 + dx;
    shape.y1 = snapshot.y1 + dy;
    shape.x2 = snapshot.x2 + dx;
    shape.y2 = snapshot.y2 + dy;

    const bounds = getShapeBounds(shape);
    let adjustX = 0;
    let adjustY = 0;

    if (bounds.x < 0) {
      adjustX = -bounds.x;
    } else if (bounds.x + bounds.width > currentRect.width) {
      adjustX = currentRect.width - (bounds.x + bounds.width);
    }

    if (bounds.y < 0) {
      adjustY = -bounds.y;
    } else if (bounds.y + bounds.height > currentRect.height) {
      adjustY = currentRect.height - (bounds.y + bounds.height);
    }

    shape.x1 += adjustX;
    shape.y1 += adjustY;
    shape.x2 += adjustX;
    shape.y2 += adjustY;
  }
}

function getShapeBounds(shape) {
  if (shape.type === 'rect' || shape.type === 'ellipse') {
    return {
      height: shape.height,
      width: shape.width,
      x: shape.x,
      y: shape.y
    };
  }

  if (shape.type === 'arrow') {
    const head = getArrowHeadPoints(shape);
    const minX = Math.min(shape.x1, shape.x2, head.leftX, head.rightX);
    const minY = Math.min(shape.y1, shape.y2, head.leftY, head.rightY);
    const maxX = Math.max(shape.x1, shape.x2, head.leftX, head.rightX);
    const maxY = Math.max(shape.y1, shape.y2, head.leftY, head.rightY);
    const pad = 4;

    return {
      height: maxY - minY + pad * 2,
      width: maxX - minX + pad * 2,
      x: minX - pad,
      y: minY - pad
    };
  }

  if (shape.type === 'text') {
    const geometry = measureTextGeometry(shape.text, shape.fontSize);

    return {
      height: shape.height ?? geometry.height,
      width: shape.width ?? geometry.width,
      x: shape.x,
      y: shape.y
    };
  }

  return { height: 0, width: 0, x: 0, y: 0 };
}

const HANDLE_SIZE = 7;
const HANDLE_HIT_PADDING = 4;

const HANDLE_CURSORS = {
  e: 'ew-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  nw: 'nwse-resize',
  s: 'ns-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
  w: 'ew-resize'
};

function getSelectionHandlePositions(shape) {
  const bounds = getShapeBounds(shape);
  const { height, width, x, y } = bounds;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return [
    { id: 'nw', x, y },
    { id: 'n', x: centerX, y },
    { id: 'ne', x: x + width, y },
    { id: 'w', x, y: centerY },
    { id: 'e', x: x + width, y: centerY },
    { id: 'sw', x, y: y + height },
    { id: 's', x: centerX, y: y + height },
    { id: 'se', x: x + width, y: y + height }
  ];
}

function getHandleCursor(handleId) {
  return HANDLE_CURSORS[handleId] ?? 'crosshair';
}

function shouldShowSelectionHandles() {
  return Boolean(
    currentRect &&
      currentRect.width >= 10 &&
      currentRect.height >= 10 &&
      toolbarWrap?.style.display !== 'none' &&
      !activeTool &&
      annotations.length === 0 &&
      !ocrReady &&
      !recordingRegionMode
  );
}

function updateSelectionHandlesVisibility() {
  if (selectionHandles) {
    selectionHandles.hidden = !shouldShowSelectionHandles();
  }
}

function getCurrentSelectionHandlePositions() {
  if (!currentRect) {
    return [];
  }

  const { height, width, x, y } = currentRect;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return [
    { id: 'nw', x, y },
    { id: 'n', x: centerX, y },
    { id: 'ne', x: x + width, y },
    { id: 'w', x, y: centerY },
    { id: 'e', x: x + width, y: centerY },
    { id: 'sw', x, y: y + height },
    { id: 's', x: centerX, y: y + height },
    { id: 'se', x: x + width, y: y + height }
  ];
}

function hitTestCurrentSelectionHandle(clientX, clientY) {
  if (!shouldShowSelectionHandles()) {
    return null;
  }

  const hitRadius = HANDLE_SIZE / 2 + HANDLE_HIT_PADDING;
  for (const handle of getCurrentSelectionHandlePositions()) {
    if (Math.abs(clientX - handle.x) <= hitRadius && Math.abs(clientY - handle.y) <= hitRadius) {
      return handle.id;
    }
  }

  return null;
}

function computeResizedScreenRect(bounds, handleId, point, startPoint) {
  let { height, width, x, y } = bounds;
  const dx = point.x - startPoint.x;
  const dy = point.y - startPoint.y;

  switch (handleId) {
    case 'nw':
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
      break;
    case 'n':
      y += dy;
      height -= dy;
      break;
    case 'ne':
      y += dy;
      width += dx;
      height -= dy;
      break;
    case 'w':
      x += dx;
      width -= dx;
      break;
    case 'e':
      width += dx;
      break;
    case 'sw':
      x += dx;
      width -= dx;
      height += dy;
      break;
    case 's':
      height += dy;
      break;
    case 'se':
      width += dx;
      height += dy;
      break;
    default:
      break;
  }

  const rect = normalizeRect(x, y, x + width, y + height);
  const minSize = 10;
  rect.x = Math.max(0, Math.min(rect.x, window.innerWidth - minSize));
  rect.y = Math.max(0, Math.min(rect.y, window.innerHeight - minSize));
  rect.width = Math.max(minSize, Math.min(rect.width, window.innerWidth - rect.x));
  rect.height = Math.max(minSize, Math.min(rect.height, window.innerHeight - rect.y));
  return rect;
}

function hitTestSelectionHandle(point) {
  const shape = getSelectedAnnotation();

  if (!isVectorShape(shape)) {
    return null;
  }

  const hitRadius = HANDLE_SIZE / 2 + HANDLE_HIT_PADDING;

  for (const handle of getSelectionHandlePositions(shape)) {
    if (Math.abs(point.x - handle.x) <= hitRadius && Math.abs(point.y - handle.y) <= hitRadius) {
      return handle.id;
    }
  }

  return null;
}

function normalizeBoundsRect(x, y, width, height) {
  let nextX = x;
  let nextY = y;
  let nextWidth = width;
  let nextHeight = height;

  if (nextWidth < 0) {
    nextX += nextWidth;
    nextWidth = -nextWidth;
  }

  if (nextHeight < 0) {
    nextY += nextHeight;
    nextHeight = -nextHeight;
  }

  nextWidth = Math.max(nextWidth, MIN_SHAPE_SIZE);
  nextHeight = Math.max(nextHeight, MIN_SHAPE_SIZE);

  return {
    height: nextHeight,
    width: nextWidth,
    x: nextX,
    y: nextY
  };
}

function clampBoundsToSelection(bounds) {
  if (!currentRect) {
    return bounds;
  }

  let { height, width, x, y } = bounds;

  if (x < 0) {
    width += x;
    x = 0;
  }

  if (y < 0) {
    height += y;
    y = 0;
  }

  if (x + width > currentRect.width) {
    width = currentRect.width - x;
  }

  if (y + height > currentRect.height) {
    height = currentRect.height - y;
  }

  width = Math.max(width, MIN_SHAPE_SIZE);
  height = Math.max(height, MIN_SHAPE_SIZE);

  return { height, width, x, y };
}

function computeResizedBounds(bounds, handleId, point, startPoint) {
  let { height, width, x, y } = bounds;
  const dx = point.x - startPoint.x;
  const dy = point.y - startPoint.y;

  switch (handleId) {
    case 'nw':
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
      break;
    case 'n':
      y += dy;
      height -= dy;
      break;
    case 'ne':
      y += dy;
      width += dx;
      height -= dy;
      break;
    case 'w':
      x += dx;
      width -= dx;
      break;
    case 'e':
      width += dx;
      break;
    case 'sw':
      x += dx;
      width -= dx;
      height += dy;
      break;
    case 's':
      height += dy;
      break;
    case 'se':
      width += dx;
      height += dy;
      break;
    default:
      break;
  }

  return clampBoundsToSelection(normalizeBoundsRect(x, y, width, height));
}

function applyBoxResize(shape, snapshot, handleId, point, startPoint) {
  const oldBounds = {
    height: snapshot.height,
    width: snapshot.width,
    x: snapshot.x,
    y: snapshot.y
  };
  const newBounds = computeResizedBounds(oldBounds, handleId, point, startPoint);

  shape.x = newBounds.x;
  shape.y = newBounds.y;
  shape.width = newBounds.width;
  shape.height = newBounds.height;
}

function applyArrowResize(shape, snapshot, handleId, point, startPoint) {
  const oldBounds = getShapeBounds({
    type: 'arrow',
    x1: snapshot.x1,
    x2: snapshot.x2,
    y1: snapshot.y1,
    y2: snapshot.y2,
    strokeWidth: shape.strokeWidth
  });
  const newBounds = computeResizedBounds(oldBounds, handleId, point, startPoint);
  const safeWidth = Math.max(oldBounds.width, 1);
  const safeHeight = Math.max(oldBounds.height, 1);
  const mapX = (value) => newBounds.x + ((value - oldBounds.x) / safeWidth) * newBounds.width;
  const mapY = (value) => newBounds.y + ((value - oldBounds.y) / safeHeight) * newBounds.height;
  const start = clampPointToSelection(mapX(snapshot.x1), mapY(snapshot.y1));
  const end = clampPointToSelection(mapX(snapshot.x2), mapY(snapshot.y2));

  shape.x1 = start.x;
  shape.y1 = start.y;
  shape.x2 = end.x;
  shape.y2 = end.y;
}

function applyTextResize(shape, snapshot, handleId, point, startPoint) {
  const oldBounds = {
    height: snapshot.height,
    width: snapshot.width,
    x: snapshot.x,
    y: snapshot.y
  };
  const newBounds = computeResizedBounds(oldBounds, handleId, point, startPoint);
  const widthScale = newBounds.width / Math.max(1, oldBounds.width);
  const heightScale = newBounds.height / Math.max(1, oldBounds.height);
  const nextFontSize = clampTextFontSize(snapshot.fontSize * Math.max(widthScale, heightScale));
  const geometry = measureTextGeometry(shape.text, nextFontSize);

  shape.fontSize = nextFontSize;
  shape.width = geometry.width;
  shape.height = geometry.height;
  shape.x = Math.max(0, Math.min(newBounds.x, currentRect.width - shape.width));
  shape.y = Math.max(0, Math.min(newBounds.y, currentRect.height - shape.height));
}

function setDefaultToolCursor() {
  if (scrollCaptureMode) {
    document.body.style.cursor = 'default';
    return;
  }

  document.body.style.cursor = activeTool === 'text' ? 'text' : 'crosshair';
}

function hideMosaicCursor() {
  if (mosaicCursor instanceof HTMLElement) {
    mosaicCursor.hidden = true;
  }
  document.body.classList.remove('mosaic-cursor-active');
}

function updateMosaicCursor(clientX, clientY) {
  if (!(mosaicCursor instanceof HTMLElement)) {
    return false;
  }

  const shouldShow = Boolean(
    activeTool === 'mosaic' &&
      currentRect &&
      currentRect.width >= 10 &&
      currentRect.height >= 10 &&
      isInsideCurrentSelection(clientX, clientY) &&
      !isBusy &&
      !dragging &&
      !selectionResizeDragging &&
      !resizeDragging &&
      !moveDragging &&
      !scrollCaptureMode &&
      !recordingRegionMode &&
      !regionPlaybackMode
  );

  if (!shouldShow) {
    mosaicCursor.hidden = true;
    document.body.classList.remove('mosaic-cursor-active');
    return false;
  }

  const size = clampBrushSize(annotateSettings.brushSize);
  mosaicCursor.style.setProperty('--mosaic-cursor-size', `${size * 2}px`);
  mosaicCursor.style.left = `${clientX}px`;
  mosaicCursor.style.top = `${clientY}px`;
  mosaicCursor.hidden = false;
  document.body.classList.add('mosaic-cursor-active');
  document.body.style.cursor = 'none';
  return true;
}

function updateAnnotationHoverCursor(clientX, clientY) {
  if (scrollCaptureMode) {
    hideMosaicCursor();
    document.body.style.cursor = 'default';
    return;
  }

  if (recordingRegionMode || regionPlaybackMode) {
    hideMosaicCursor();
    document.body.style.cursor = regionPlaybackMode ? 'default' : 'none';
    return;
  }

  if (moveDragging || resizeDragging || selectionResizeDragging || annotateDragging || paintDragging || dragging || isBusy) {
    return;
  }

  const selectionHandleId = hitTestCurrentSelectionHandle(clientX, clientY);
  if (selectionHandleId) {
    hideMosaicCursor();
    document.body.style.cursor = getHandleCursor(selectionHandleId);
    return;
  }

  if (currentRect && !activeTool && isInsideCurrentSelection(clientX, clientY)) {
    hideMosaicCursor();
    document.body.style.cursor = 'move';
    return;
  }

  if (activeTool === 'mosaic' && updateMosaicCursor(clientX, clientY)) {
    return;
  }

  if (
    !currentRect ||
    !activeTool ||
    !SHAPE_SUB_TOOLS.has(activeTool) ||
    !isInsideCurrentSelection(clientX, clientY)
  ) {
    setDefaultToolCursor();
    return;
  }

  const point = toSelectionPoint(clientX, clientY);
  const handleId = hitTestSelectionHandle(point);

  if (handleId) {
    document.body.style.cursor = getHandleCursor(handleId);
    return;
  }

  if (isPointOnSelectedAnnotation(point)) {
    document.body.style.cursor = 'grab';
    return;
  }

  if (findAnnotationIndexAtPoint(point) !== null) {
    document.body.style.cursor = 'pointer';
    return;
  }

  setDefaultToolCursor();
}

function beginShapeToolPointer(event, tool) {
  const point = toSelectionPoint(event.clientX, event.clientY);
  const handleId = hitTestSelectionHandle(point);

  if (handleId && getSelectedAnnotation()) {
    resizeDragging = true;
    resizeHandleId = handleId;
    resizeStart = point;
    resizeSnapshot = cloneShapeGeometry(getSelectedAnnotation());
    document.body.style.cursor = getHandleCursor(handleId);
    event.preventDefault();
    return;
  }

  if (isPointOnSelectedAnnotation(point)) {
    moveDragging = true;
    moveStart = point;
    moveSnapshot = cloneShapeGeometry(getSelectedAnnotation());
    document.body.style.cursor = 'grabbing';
    event.preventDefault();
    return;
  }

  const hitIndex = findAnnotationIndexAtPoint(point);

  if (hitIndex !== null) {
    selectAnnotationIndex(hitIndex);
    event.preventDefault();
    return;
  }

  clearSelection();
  annotateDragging = true;
  annotateStart = point;
  previewShape = createPreviewShape(tool, annotateStart);
  renderAnnotations();
}

function appendSelectionHandles(parent, shape) {
  for (const handle of getSelectionHandlePositions(shape)) {
    const half = HANDLE_SIZE / 2;

    parent.appendChild(
      createSvgElement('rect', {
        class: 'annotate-selection-handle',
        'data-handle': handle.id,
        height: HANDLE_SIZE,
        width: HANDLE_SIZE,
        x: handle.x - half,
        y: handle.y - half
      })
    );
  }
}

function resizePaintLayer() {
  if (!(paintLayer instanceof HTMLCanvasElement) || !currentRect || currentRect.width < 2 || currentRect.height < 2) {
    return;
  }

  const width = Math.max(1, Math.round(currentRect.width));
  const height = Math.max(1, Math.round(currentRect.height));

  if (paintLayerSize.width === width && paintLayerSize.height === height && paintCtx) {
    return;
  }

  paintLayerSize = { height, width };
  paintLayer.width = width;
  paintLayer.height = height;
  paintCtx = paintLayer.getContext('2d');
  renderPaintLayer();
}

function clearPaintLayer() {
  if (!paintCtx || !(paintLayer instanceof HTMLCanvasElement)) {
    return;
  }

  paintCtx.clearRect(0, 0, paintLayer.width, paintLayer.height);
}

function drawBrushStroke(ctx, stroke, scaleX, scaleY) {
  const points = stroke.points ?? [];

  if (points.length < 1) {
    return;
  }

  const { color, strokeWidth } = getShapeStyle(stroke);

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth * Math.max(scaleX, scaleY);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);

  if (points.length === 1) {
    ctx.lineTo(points[0].x * scaleX + 0.01, points[0].y * scaleY + 0.01);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x * scaleX, points[index].y * scaleY);
    }
  }

  ctx.stroke();
}

function mosaicStamp(ctx, image, cx, cy, radius, blockSize) {
  const size = radius * 2;
  const x = Math.max(0, Math.floor(cx - radius));
  const y = Math.max(0, Math.floor(cy - radius));
  const w = Math.min(size, image.width - x);
  const h = Math.min(size, image.height - y);

  if (w <= 0 || h <= 0) {
    return;
  }

  const smallW = Math.max(1, Math.ceil(w / blockSize));
  const smallH = Math.max(1, Math.ceil(h / blockSize));
  const temp = document.createElement('canvas');
  temp.width = smallW;
  temp.height = smallH;
  const tempCtx = temp.getContext('2d');

  if (!tempCtx) {
    return;
  }

  tempCtx.drawImage(image, x, y, w, h, 0, 0, smallW, smallH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, smallW, smallH, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function drawMosaicStrokes(ctx, image, strokes, scaleX, scaleY) {
  for (const stroke of strokes) {
    const radius = (stroke.brushSize ?? annotateSettings.brushSize) * Math.max(scaleX, scaleY);

    for (const point of stroke.points ?? []) {
      mosaicStamp(ctx, image, point.x * scaleX, point.y * scaleY, radius, MOSAIC_BLOCK_SIZE);
    }
  }
}

function setSelectionBaseImage(rectSnapshot, dataUrl, width, height) {
  const base = {
    dataUrl,
    height,
    width
  };

  selectionBaseImage = base;
  const image = new Image();
  image.onload = () => {
    if (!sameRect(rectSnapshot, currentRect)) {
      return;
    }

    selectionBaseImageEl = image;
    renderPaintLayer();
  };
  image.src = base.dataUrl;
}

function renderPaintLayer() {
  if (!paintCtx || !currentRect) {
    return;
  }

  clearPaintLayer();

  const mosaicStrokes = annotations.filter((item) => item.type === 'mosaic');

  if (activePaintStroke?.type === 'mosaic') {
    mosaicStrokes.push(activePaintStroke);
  }

  if (selectionBaseImageEl) {
    drawMosaicStrokes(paintCtx, selectionBaseImageEl, mosaicStrokes, 1, 1);
  }

  const brushStrokes = annotations.filter((item) => item.type === 'brush');

  if (activePaintStroke?.type === 'brush') {
    brushStrokes.push(activePaintStroke);
  }

  for (const stroke of brushStrokes) {
    drawBrushStroke(paintCtx, stroke, 1, 1);
  }
}

async function cacheSelectionBaseImage() {
  if (!currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return;
  }

  const rectSnapshot = { ...currentRect };

  try {
    const ready = await waitForColorSamplerReady();

    if (!sameRect(rectSnapshot, currentRect)) {
      return;
    }

    if (ready) {
      const screenRect = toScreenRect(rectSnapshot);
      const frame = findColorFrame(screenRect.x + screenRect.width / 2, screenRect.y + screenRect.height / 2);

      if (frame?.canvas && sameRect(rectSnapshot, currentRect)) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rectSnapshot.width));
        canvas.height = Math.max(1, Math.round(rectSnapshot.height));
        const ctx = canvas.getContext('2d');

        if (ctx) {
          const sourceX = Math.max(0, Math.round((screenRect.x - frame.bounds.x) * frame.scale));
          const sourceY = Math.max(0, Math.round((screenRect.y - frame.bounds.y) * frame.scale));
          const sourceWidth = Math.min(Math.round(screenRect.width * frame.scale), frame.width - sourceX);
          const sourceHeight = Math.min(Math.round(screenRect.height * frame.scale), frame.height - sourceY);

          if (sourceWidth > 0 && sourceHeight > 0) {
            ctx.drawImage(frame.canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
            setSelectionBaseImage(rectSnapshot, canvas.toDataURL('image/png'), canvas.width, canvas.height);
            return;
          }
        }
      }
    }

    const screenRect = toScreenRect(rectSnapshot);
    const capture = await window.screenshotOverlay?.captureRegion?.(screenRect, {
      fresh: true,
      hideOverlay: false,
      restoreOverlay: false
    });

    if (!capture?.dataUrl || !sameRect(rectSnapshot, currentRect)) {
      return;
    }

    setSelectionBaseImage(
      rectSnapshot,
      capture.dataUrl,
      capture.width || Math.max(1, Math.round(rectSnapshot.width)),
      capture.height || Math.max(1, Math.round(rectSnapshot.height))
    );
  } catch {
    // Preview mosaic requires a cached capture; ignore capture failures here.
  }
}

function createBrushStroke(point) {
  return {
    type: 'brush',
    points: [point],
    color: annotateSettings.color,
    strokeWidth: annotateSettings.brushSize
  };
}

function createMosaicStroke(point) {
  return {
    type: 'mosaic',
    brushSize: annotateSettings.brushSize,
    points: [point]
  };
}

function appendPaintPoint(stroke, point) {
  const last = stroke.points[stroke.points.length - 1];

  if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_PAINT_POINT_DISTANCE) {
    return;
  }

  stroke.points.push(point);
}

function finalizePaintStroke() {
  if (!activePaintStroke || activePaintStroke.points.length === 0) {
    activePaintStroke = null;
    renderPaintLayer();
    return;
  }

  if (activePaintStroke.points.length === 1) {
    activePaintStroke.points.push({ ...activePaintStroke.points[0] });
  }

  annotations.push(activePaintStroke);
  activePaintStroke = null;
  renderPaintLayer();
}

function commitActivePaintStroke() {
  if (!activePaintStroke) {
    return;
  }

  finalizePaintStroke();
}

function removePendingTextInput() {
  if (pendingTextInput?.parentNode) {
    pendingTextInput.remove();
  }

  pendingTextInput = null;
}

function getShapeStyle(shape) {
  const lineStyle = normalizeLineStyle(shape?.lineStyle ?? annotateSettings.lineStyle);

  return {
    color: shape?.color ?? annotateSettings.color,
    fontSize: shape?.fontSize ?? annotateSettings.fontSize,
    lineStyle,
    strokeDasharray: getStrokeDasharray(lineStyle),
    strokeWidth: shape?.strokeWidth ?? annotateSettings.strokeWidth
  };
}

function buildStrokeAttrs(style, extra = {}) {
  const attrs = {
    ...extra,
    stroke: style.color,
    'stroke-width': style.strokeWidth
  };

  if (style.strokeDasharray) {
    attrs['stroke-dasharray'] = style.strokeDasharray;
  }

  return attrs;
}

function createAnnotation(type, geometry) {
  return {
    type,
    ...geometry,
    color: annotateSettings.color,
    fontSize: annotateSettings.fontSize,
    lineStyle: annotateSettings.lineStyle,
    strokeWidth: annotateSettings.strokeWidth
  };
}

function updateAnnotateLayerInteractive() {
  if (!(annotateLayer instanceof SVGSVGElement) || !(paintLayer instanceof HTMLCanvasElement)) {
    return;
  }

  const interactive = Boolean(currentRect && currentRect.width >= 10 && activeTool);
  const usesPaintLayer = interactive && PAINT_TOOLS.has(activeTool);

  annotateLayer.classList.toggle('interactive', interactive && !usesPaintLayer);
  paintLayer.classList.toggle('interactive', usesPaintLayer);
}

function clampStrokeWidth(value) {
  return Math.min(STROKE_WIDTH_MAX, Math.max(STROKE_WIDTH_MIN, Math.round(Number(value) || STROKE_WIDTH_MIN)));
}

function clampBrushSize(value) {
  return Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, Math.round(Number(value) || BRUSH_SIZE_MIN)));
}

function clampTextFontSize(value) {
  return Math.min(
    TEXT_FONT_SIZE_MAX,
    Math.max(TEXT_FONT_SIZE_MIN, Math.round(Number(value) || ANNOTATE_FONT))
  );
}

function updateSliderProgress(slider, value, min, max) {
  if (!(slider instanceof HTMLInputElement)) {
    return;
  }

  slider.value = String(value);
  const percent = ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--stroke-progress', `${percent}%`);
}

function updateStrokeSizeUI() {
  const width = clampStrokeWidth(annotateSettings.strokeWidth);
  annotateSettings.strokeWidth = width;
  updateSliderProgress(strokeSlider, width, STROKE_WIDTH_MIN, STROKE_WIDTH_MAX);

  if (strokeValueLabel) {
    strokeValueLabel.textContent = `${width}px`;
  }
}

function updateBrushSizeUI() {
  const size = clampBrushSize(annotateSettings.brushSize);
  annotateSettings.brushSize = size;
  updateSliderProgress(brushSlider, size, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX);

  if (brushValueLabel) {
    brushValueLabel.textContent = `${size}px`;
  }

  if (brushPreview instanceof HTMLElement) {
    const previewSize = Math.min(18, Math.max(4, size * 0.75));
    brushPreview.style.setProperty('--brush-preview-size', `${previewSize}px`);
  }

  if (mosaicCursor instanceof HTMLElement && !mosaicCursor.hidden) {
    mosaicCursor.style.setProperty('--mosaic-cursor-size', `${size * 2}px`);
  }
}

function updateTextSizeUI() {
  const fontSize = clampTextFontSize(annotateSettings.fontSize);
  annotateSettings.fontSize = fontSize;
  updateSliderProgress(textSizeSlider, fontSize, TEXT_FONT_SIZE_MIN, TEXT_FONT_SIZE_MAX);

  if (textSizeValueLabel) {
    textSizeValueLabel.textContent = `${fontSize}px`;
  }

  if (textSizePreview instanceof HTMLElement) {
    textSizePreview.style.fontSize = `${Math.min(22, Math.max(14, fontSize * 0.62))}px`;
  }

  if (pendingTextInput instanceof HTMLTextAreaElement) {
    pendingTextInput.style.fontSize = `${fontSize}px`;
    pendingTextInput.style.color = annotateSettings.color;
    pendingTextInput.style.borderColor = annotateSettings.color;
  }
}

function updateLineStyleUI() {
  const lineStyle = normalizeLineStyle(annotateSettings.lineStyle);
  annotateSettings.lineStyle = lineStyle;

  if (linePreviewPath instanceof SVGPathElement) {
    const dasharray = getStrokeDasharray(lineStyle);

    if (dasharray) {
      linePreviewPath.setAttribute('stroke-dasharray', dasharray);
    } else {
      linePreviewPath.removeAttribute('stroke-dasharray');
    }
  }

  for (const button of lineStyleMenu?.querySelectorAll('button[data-line-style]') ?? []) {
    button.classList.toggle(
      'active',
      button instanceof HTMLButtonElement && button.dataset.lineStyle === lineStyle
    );
  }
}

function setLineStyle(lineStyle) {
  annotateSettings.lineStyle = normalizeLineStyle(lineStyle);
  updateLineStyleUI();
  applySettingsToSelectedAnnotation();
}

function closeLineStyleMenu() {
  lineStylePicker?.classList.remove('open');

  if (lineStyleTrigger instanceof HTMLButtonElement) {
    lineStyleTrigger.setAttribute('aria-expanded', 'false');
  }
}

function toggleLineStyleMenu() {
  if (!(lineStylePicker instanceof HTMLElement)) {
    return;
  }

  if (lineStylePicker.classList.contains('open')) {
    closeLineStyleMenu();
    return;
  }

  closeTertiaryPanels();
  lineStylePicker.classList.add('open');

  if (lineStyleTrigger instanceof HTMLButtonElement) {
    lineStyleTrigger.setAttribute('aria-expanded', 'true');
  }
}

function closeTertiaryPanels() {
  annotateOptionsWrap?.classList.remove('tertiary--stroke-open', 'tertiary--brush-open');
}

function closeAllOptionPanels() {
  closeTertiaryPanels();
  closeLineStyleMenu();
}

function getSubOptionsHeight() {
  if (!annotateOptionsWrap || annotateOptionsWrap.hidden || annotateOptionsWrap.style.display === 'none') {
    return 0;
  }

  return annotateOptions?.offsetHeight ?? 0;
}

function setSubOptionsVisible(visible) {
  if (!annotateOptionsWrap) {
    return;
  }

  annotateOptionsWrap.hidden = !visible;
  annotateOptionsWrap.style.display = visible ? 'block' : 'none';

  if (!visible) {
    closeAllOptionPanels();
  }
}

function resetActiveTool() {
  activeTool = null;
  hideMosaicCursor();
  removePendingTextInput();
  setSubOptionsVisible(false);

  for (const button of toolbar.querySelectorAll('button[data-tool]')) {
    button.classList.remove('active');
  }

  document.body.style.cursor = 'crosshair';
  updateAnnotateLayerInteractive();
  updateSelectionHandlesVisibility();
}

function shouldBlockToolbarToolActivation() {
  return blockToolbarToolActivation;
}

function clearActiveTool() {
  commitActivePaintStroke();
  activeTool = null;
  hideMosaicCursor();
  removePendingTextInput();
  setSubOptionsVisible(false);

  for (const button of toolbar.querySelectorAll('button[data-tool]')) {
    button.classList.remove('active');
  }

  document.body.style.cursor = 'crosshair';
  updateAnnotateLayerInteractive();
  updateSelectionHandlesVisibility();

  if (currentRect && currentRect.width >= 10 && toolbarWrap?.style.display !== 'none') {
    placeToolbar(currentRect);
  }
}

function updateToolUI() {
  for (const button of toolbar.querySelectorAll('button[data-tool]')) {
    button.classList.toggle('active', button instanceof HTMLButtonElement && button.dataset.tool === activeTool);
  }

  setSubOptionsVisible(Boolean(activeTool && TOOLS_WITH_SUB_OPTIONS.has(activeTool)));

  if (annotateOptionsWrap && !annotateOptionsWrap.hidden) {
    const isBrush = activeTool === 'brush' || activeTool === 'mosaic';
    const isMosaic = activeTool === 'mosaic';
    const isText = activeTool === 'text';
    annotateOptionsWrap.classList.toggle('annotate-mode--brush', isBrush);
    annotateOptionsWrap.classList.toggle('annotate-mode--mosaic', isMosaic);
    annotateOptionsWrap.classList.toggle('annotate-mode--text', isText);
    annotateOptionsWrap.classList.toggle(
      'annotate-mode--shape',
      Boolean(activeTool && SHAPE_SUB_TOOLS.has(activeTool) && !isText)
    );

    if (isBrush) {
      updateBrushSizeUI();
    } else if (isText) {
      updateTextSizeUI();
    } else {
      updateStrokeSizeUI();
      updateLineStyleUI();
    }

    if (isMosaic) {
      closeLineStyleMenu();
      annotateOptionsWrap.classList.add('tertiary--brush-open');
    }

    for (const button of annotateOptionsWrap.querySelectorAll('button[data-color]')) {
      button.classList.toggle(
        'active',
        button instanceof HTMLButtonElement && button.dataset.color === annotateSettings.color
      );
    }
  }

  document.body.style.cursor = activeTool === 'text' ? 'text' : 'crosshair';
  if (activeTool !== 'mosaic') {
    hideMosaicCursor();
  }
  updateAnnotateLayerInteractive();
  updateSelectionHandlesVisibility();
  applySettingsToSelectedAnnotation();

  if (currentRect && currentRect.width >= 10 && toolbarWrap?.style.display !== 'none') {
    placeToolbar(currentRect);
  }
}

function setActiveTool(tool) {
  if (shouldBlockToolbarToolActivation()) {
    return;
  }

  commitActivePaintStroke();
  const nextTool = activeTool === tool ? null : tool;

  if (nextTool && (ocrReady || translateReady)) {
    exitOcrMode();
  }

  activeTool = nextTool;

  if (activeTool && SHAPE_BOX_TOOLS.has(activeTool)) {
    annotateSettings.shape = activeTool;
  }

  if (activeTool === 'mosaic') {
    void cacheSelectionBaseImage();
  }

  closeAllOptionPanels();
  removePendingTextInput();
  updateToolUI();
}

function showToolbarAfterSelection() {
  resetActiveTool();

  window.setTimeout(() => {
    if (!currentRect || isBusy) {
      return;
    }

    blockToolbarToolActivation = true;
    placeToolbar(currentRect);
    updateSelectionHandlesVisibility();

    window.requestAnimationFrame(() => {
      blockToolbarToolActivation = false;
    });
  }, 50);
}

function isExternalOcrStatus(message) {
  return message === '正在识别文字…' || message === '正在翻译…';
}

function setOcrStatus(message) {
  if (!message || !currentRect) {
    ocrStatus.style.display = 'none';
    return;
  }

  ocrStatus.textContent = message;
  ocrStatus.style.display = 'block';
  ocrStatus.style.left = '8px';
  ocrStatus.style.top = '8px';

  if (isExternalOcrStatus(message)) {
    const statusRect = ocrStatus.getBoundingClientRect();
    const gap = 8;
    const topOutside = currentRect.y - statusRect.height - gap;
    const bottomOutside = currentRect.y + currentRect.height + gap;
    const viewportTop = topOutside >= 8
      ? topOutside
      : Math.min(bottomOutside, window.innerHeight - statusRect.height - 8);
    const viewportLeft = Math.min(
      Math.max(8, currentRect.x),
      Math.max(8, window.innerWidth - statusRect.width - 8)
    );

    ocrStatus.style.left = `${viewportLeft - currentRect.x}px`;
    ocrStatus.style.top = `${viewportTop - currentRect.y}px`;
  }

  positionOcrResultControls();
}

function setOcrCaptureUiHidden(hidden) {
  if (ocrResultOpen instanceof HTMLElement && !ocrResultOpen.hidden) {
    ocrResultOpen.style.visibility = hidden ? 'hidden' : '';
  }
}

function extractOcrText(result) {
  if (result?.text?.trim()) {
    return result.text.trim();
  }

  if (result?.words?.length) {
    return result.words.map((word) => word.text).join('\n');
  }

  return '';
}

function layoutOcrWordBoxes(words, scaleX, scaleY, maxHeight) {
  const sorted = [...words].sort((left, right) => {
    const deltaY = left.y - right.y;

    if (Math.abs(deltaY) > 2) {
      return deltaY;
    }

    return left.x - right.x;
  });

  return sorted.map((word) => {
    const top = word.y * scaleY;
    const width = Math.max(word.width * scaleX, 4);
    let height = Math.max(word.height * scaleY, 4);

    if (maxHeight && top + height > maxHeight) {
      height = Math.max(4, maxHeight - top);
    }

    return {
      fontSize: Math.max(10, height * 0.88),
      height,
      left: word.x * scaleX,
      text: word.text,
      top,
      width
    };
  });
}

function selectOcrWordElement(element) {
  const selection = window.getSelection();
  const range = document.createRange();

  if (!selection || !(element instanceof HTMLElement)) {
    return;
  }

  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function bindOcrWordSelection(element) {
  element.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    selectOcrWordElement(element);
  });
}

function renderOcrWords(result, rect, options = {}) {
  const silent = options.silent === true;
  clearOcrLayer({ preserveStatus: silent, preserveResultEntry: silent });

  if (!result || (!result.words?.length && !result.text)) {
    if (!silent) {
      setOcrStatus('未识别到文字');
    }

    return;
  }

  setOcrResultText(extractOcrText(result));
  lastOcrResult = result;
  lastOcrRect = { ...rect };

  if (silent) {
    textLayer.hidden = true;
    textLayer.innerHTML = '';
    textLayer.classList.remove('selectable');
    ocrReady = false;
    translateReady = false;
    updateTranslateButtonState();
    updateOcrButtonState();
    setOcrStatus('');
    setOcrResultEntryVisible(false);
    return;
  }

  const scaleX = rect.width / Math.max(1, result.imageWidth);
  const scaleY = rect.height / Math.max(1, result.imageHeight);

  textLayer.hidden = false;
  textLayer.classList.add('selectable');

  if (result.words?.length) {
    const boxes = layoutOcrWordBoxes(result.words, scaleX, scaleY, rect.height);

    for (const word of boxes) {
      const span = document.createElement('span');
      span.className = 'ocr-word';
      span.textContent = word.text;
      span.style.left = `${word.left}px`;
      span.style.top = `${word.top}px`;
      span.style.width = `${word.width}px`;
      span.style.height = `${word.height}px`;
      span.style.fontSize = `${word.fontSize}px`;
      span.style.lineHeight = `${word.height}px`;

      bindOcrWordSelection(span);
      textLayer.appendChild(span);
    }
  } else if (result.text) {
    const block = document.createElement('div');
    block.className = 'ocr-line';
    block.textContent = result.text;
    block.style.inset = '4px';
    textLayer.appendChild(block);
  }

  ocrReady = true;
  translateReady = false;
  updateTranslateButtonState();
  updateOcrButtonState();

  if (silent) {
    setOcrStatus('');
    setOcrResultEntryVisible(false);
  } else {
    setOcrStatus(lastOcrText ? '' : '未识别到文字');
    setOcrResultEntryVisible(Boolean(lastOcrText));
  }
}

function splitTranslatedLines(text, expectedCount) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === expectedCount) {
    return lines;
  }

  return null;
}

function buildOcrWordLines(result) {
  const words = Array.isArray(result?.words) ? [...result.words] : [];

  if (!words.length) {
    return [];
  }

  words.sort((left, right) => {
    const deltaY = left.y - right.y;
    return Math.abs(deltaY) > 2 ? deltaY : left.x - right.x;
  });

  const lines = [];

  for (const word of words) {
    const height = Math.max(1, Number(word.height ?? 0));
    const centerY = Number(word.y ?? 0) + height / 2;
    const current = lines.at(-1);

    if (!current || Math.abs(centerY - current.centerY) > Math.max(current.height, height) * 0.7) {
      lines.push({
        centerY,
        height,
        words: [word],
        x1: Number(word.x ?? 0),
        x2: Number(word.x ?? 0) + Number(word.width ?? 0),
        y1: Number(word.y ?? 0),
        y2: Number(word.y ?? 0) + height
      });
      continue;
    }

    current.words.push(word);
    current.centerY = (current.centerY * (current.words.length - 1) + centerY) / current.words.length;
    current.height = Math.max(current.height, height);
    current.x1 = Math.min(current.x1, Number(word.x ?? 0));
    current.x2 = Math.max(current.x2, Number(word.x ?? 0) + Number(word.width ?? 0));
    current.y1 = Math.min(current.y1, Number(word.y ?? 0));
    current.y2 = Math.max(current.y2, Number(word.y ?? 0) + height);
  }

  return lines.map((line) => ({
    ...line,
    text: line.words.map((word) => String(word.text ?? '').trim()).filter(Boolean).join(' ')
  })).filter((line) => line.text);
}

function renderPositionedTranslation(result, rect, text, options = {}) {
  textLayer.innerHTML = '';
  textLayer.hidden = false;
  textLayer.classList.add('selectable');

  const positionedLines = Array.isArray(options.positionedLines) ? options.positionedLines : [];

  if (positionedLines.length && result) {
    const scaleX = rect.width / Math.max(1, result.imageWidth);
    const scaleY = rect.height / Math.max(1, result.imageHeight);

    for (const item of positionedLines) {
      const line = document.createElement('div');
      const left = item.x1 * scaleX;
      const top = item.y1 * scaleY;
      const height = Math.max((item.y2 - item.y1) * scaleY, 14);
      const width = Math.min(
        Math.max((item.x2 - item.x1) * scaleX, String(item.text).length * height * 0.72, 24),
        rect.width - left
      );

      line.className = 'translate-line';
      line.textContent = item.text;
      line.style.left = `${left}px`;
      line.style.top = `${top}px`;
      line.style.width = `${Math.max(width, 24)}px`;
      line.style.minHeight = `${height}px`;
      line.style.fontSize = `${Math.max(11, height * 0.88)}px`;
      textLayer.appendChild(line);
    }

    setOcrResultText(positionedLines.map((line) => line.text).join('\n'));
    ocrReady = false;
    translateReady = true;
    updateTranslateButtonState();
    updateOcrButtonState();
    setOcrStatus('');
    setOcrResultEntryVisible(false);
    return;
  }

  const words = result?.words ?? [];
  const positionByWords = options.positionByWords !== false;
  const translatedLines = Array.isArray(options.translatedWords) && options.translatedWords.length === words.length
    ? options.translatedWords
    : positionByWords && words.length
      ? splitTranslatedLines(text, words.length)
      : null;

  if (translatedLines) {
    const scaleX = rect.width / Math.max(1, result.imageWidth);
    const scaleY = rect.height / Math.max(1, result.imageHeight);

    for (const [index, word] of words.entries()) {
      const line = document.createElement('div');
      const left = word.x * scaleX;
      const top = word.y * scaleY;
      const height = Math.max(word.height * scaleY, 14);
      const width = Math.min(
        Math.max(word.width * scaleX, translatedLines[index].length * height * 0.72, 24),
        rect.width - left
      );

      line.className = 'translate-line';
      line.textContent = translatedLines[index];
      line.style.left = `${left}px`;
      line.style.top = `${top}px`;
      line.style.width = `${Math.max(width, 24)}px`;
      line.style.minHeight = `${height}px`;
      line.style.fontSize = `${Math.max(11, height * 0.88)}px`;
      textLayer.appendChild(line);
    }

    setOcrResultText(translatedLines.join('\n'));
    ocrReady = false;
    translateReady = true;
    updateTranslateButtonState();
    updateOcrButtonState();
    setOcrStatus('');
    setOcrResultEntryVisible(false);
    return;
  }

  const block = document.createElement('div');
  block.className = 'translate-result';
  block.textContent = text;
  textLayer.appendChild(block);

  setOcrResultText(text);
  ocrReady = false;
  translateReady = true;
  updateTranslateButtonState();
  updateOcrButtonState();
  setOcrStatus('');
  setOcrResultEntryVisible(false);
}

function detectTranslateDirection(text) {
  const trimmed = text.replace(/\s+/g, '');

  if (!trimmed) {
    return { from: 'auto', to: 'zh-CN' };
  }

  let cjkCount = 0;
  let latinCount = 0;

  for (const char of trimmed) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      cjkCount += 1;
    } else if (/[A-Za-z]/.test(char)) {
      latinCount += 1;
    }
  }

  if (cjkCount === 0 && latinCount > 0) {
    return { from: 'en', to: 'zh-CN' };
  }

  if (latinCount === 0 && cjkCount > 0) {
    return { from: 'zh-CN', to: 'en' };
  }

  if (latinCount >= cjkCount) {
    return { from: 'auto', to: 'zh-CN' };
  }

  return { from: 'auto', to: 'en' };
}

async function translateSelectionText(text, from, to) {
  const cacheKey = JSON.stringify({ from, text, to });
  const cached = translationCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const result = await window.screenshotOverlay?.translate({
    from,
    text,
    to
  });

  if (!result?.text) {
    throw new Error('翻译失败');
  }

  if (translationCache.size >= 20) {
    translationCache.delete(translationCache.keys().next().value);
  }

  translationCache.set(cacheKey, result.text);
  return result.text;
}

async function performOcr(options = {}) {
  const silent = options.silent === true;

  if (!ocrEnabled || !currentRect || currentRect.width < 10 || currentRect.height < 10) {
    clearOcrLayer();
    return '';
  }

  const generation = ++ocrGeneration;
  clearOcrLayer({ preserveStatus: options.preserveStatus === true, preserveResultEntry: silent });

  if (!silent) {
    setOcrStatus('正在识别文字…');
  }

  try {
    setOcrCaptureUiHidden(true);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    const result = await window.screenshotOverlay?.recognize(toScreenRect(currentRect), {
      mode: options.mode === 'positioned' ? 'positioned' : 'fast_text'
    });
    setOcrCaptureUiHidden(false);

    if (generation !== ocrGeneration || !currentRect) {
      return '';
    }

    if (result?.error) {
      if (!silent) {
        setOcrStatus(result.error);
      }

      return '';
    }

    renderOcrWords(result, currentRect, options);
    return lastOcrText;
  } catch (error) {
    setOcrCaptureUiHidden(false);
    const message = error instanceof Error ? error.message : String(error || '文字识别失败');
    const statusMessage = message && message !== '文字识别失败' ? `文字识别失败：${message}` : '文字识别失败';
    void window.screenshotOverlay?.debugLog?.('screenshot-ocr', `failed error=${message}`);

    if (generation === ocrGeneration && !silent) {
      setOcrStatus(statusMessage);
    }

    return '';
  }
}

async function scheduleOcr() {
  await performOcr();
}

async function scheduleTranslate() {
  if (!translateEnabled || !currentRect || currentRect.width < 10 || currentRect.height < 10) {
    setOcrStatus(translateEnabled ? '请先框选要翻译的区域' : '翻译功能未启用');
    return;
  }

  if (translateReady) {
    exitOcrMode();
    return;
  }

  const selectedText = getSelectedOcrText();
  const wasOcrReady = Boolean(ocrReady && lastOcrResult);
  setOcrStatus('正在翻译…');
  setOcrResultEntryVisible(false);
  if (ocrResultPanel instanceof HTMLElement) {
    ocrResultPanel.hidden = true;
  }
  clearOcrVisualLayer();
  if (wasOcrReady) {
    ocrReady = false;
    updateOcrButtonState();
  }

  let sourceText = '';
  let positionByWords = false;
  let ocrLines = [];

  if (wasOcrReady && lastOcrResult) {
    const fullText = extractOcrText(lastOcrResult);
    ocrLines = buildOcrWordLines(lastOcrResult);

    if (selectedText && selectedText !== fullText && fullText.includes(selectedText)) {
      sourceText = selectedText;
    } else {
      sourceText = fullText;
      positionByWords = Boolean(ocrLines.length || lastOcrResult.words?.length);
    }
  } else {
    sourceText = await performOcr({ mode: 'positioned', preserveStatus: true, silent: true });

    if (lastOcrResult) {
      const fullText = extractOcrText(lastOcrResult);
      ocrLines = buildOcrWordLines(lastOcrResult);

      if (selectedText && selectedText !== fullText && fullText.includes(selectedText)) {
        sourceText = selectedText;
      } else {
        sourceText = fullText;
        positionByWords = Boolean(ocrLines.length || lastOcrResult.words?.length);
      }
    }
  }

  window.getSelection()?.removeAllRanges();

  if (!sourceText) {
    setOcrStatus('未识别到可翻译文字');
    return;
  }

  const generation = ++ocrGeneration;

  try {
    const { from, to } = detectTranslateDirection(sourceText);
    let translated = '';
    let positionedLines = null;

    if (positionByWords && ocrLines.length && sourceText === extractOcrText(lastOcrResult)) {
      const translatedItems = await Promise.all(
        ocrLines.map(async (line) => ({
          ...line,
          text: await translateSelectionText(line.text, from, to)
        }))
      );
      positionedLines = translatedItems;
      translated = translatedItems.map((line) => line.text).join('\n');
    } else {
      translated = await translateSelectionText(sourceText, from, to);
    }

    if (generation !== ocrGeneration || !currentRect) {
      setOcrStatus('');
      return;
    }

    renderPositionedTranslation(lastOcrResult, lastOcrRect ?? currentRect, translated, {
      positionedLines,
      positionByWords
    });
  } catch (error) {
    console.warn('[screenshot-translate] failed', error);
    setOcrStatus(error instanceof Error ? error.message : '翻译失败');
  }
}

function createSvgElement(name, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);

  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }

  return node;
}

function appendArrowShape(parent, shape) {
  const style = getShapeStyle(shape);
  const line = createSvgElement(
    'line',
    buildStrokeAttrs(style, {
      class: 'annotate-shape',
      x1: shape.x1,
      x2: shape.x2,
      y1: shape.y1,
      y2: shape.y2
    })
  );
  parent.appendChild(line);

  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const headLength = Math.max(10, style.strokeWidth * 3);
  const leftX = shape.x2 - headLength * Math.cos(angle - Math.PI / 6);
  const leftY = shape.y2 - headLength * Math.sin(angle - Math.PI / 6);
  const rightX = shape.x2 - headLength * Math.cos(angle + Math.PI / 6);
  const rightY = shape.y2 - headLength * Math.sin(angle + Math.PI / 6);
  const head = createSvgElement('polygon', {
    fill: style.color,
    points: `${shape.x2},${shape.y2} ${leftX},${leftY} ${rightX},${rightY}`
  });
  parent.appendChild(head);
}

function renderAnnotations() {
  if (!(annotateLayer instanceof SVGSVGElement)) {
    return;
  }

  const items = previewShape ? [...annotations, previewShape] : annotations;

  if (items.length === 0) {
    if (annotateLayer.childElementCount > 0) {
      annotateLayer.innerHTML = '';
    }
    return;
  }

  annotateLayer.innerHTML = '';

  for (const shape of items) {
    const style = getShapeStyle(shape);

    if (shape.type === 'rect') {
      annotateLayer.appendChild(
        createSvgElement(
          'rect',
          buildStrokeAttrs(style, {
            class: 'annotate-shape',
            height: shape.height,
            width: shape.width,
            x: shape.x,
            y: shape.y
          })
        )
      );
      continue;
    }

    if (shape.type === 'ellipse') {
      annotateLayer.appendChild(
        createSvgElement(
          'ellipse',
          buildStrokeAttrs(style, {
            class: 'annotate-shape',
            cx: shape.x + shape.width / 2,
            cy: shape.y + shape.height / 2,
            rx: shape.width / 2,
            ry: shape.height / 2
          })
        )
      );
      continue;
    }

    if (shape.type === 'arrow') {
      appendArrowShape(annotateLayer, shape);
      continue;
    }

    if (shape.type === 'text' && shape.text) {
      const fontSize = style.fontSize;
      annotateLayer.appendChild(
        createSvgElement('text', {
          class: 'annotate-text',
          'dominant-baseline': 'text-before-edge',
          fill: style.color,
          'font-size': fontSize,
          style: `font-size: ${fontSize}px;`,
          x: shape.x,
          y: shape.y
        })
      ).textContent = shape.text;
    }
  }

  const selectedShape = getSelectedAnnotation();

  if (selectedShape && isVectorShape(selectedShape)) {
    appendSelectionHandles(annotateLayer, selectedShape);
  }

  updateSelectionHandlesVisibility();
  updateUndoButtonState();
}

function finalizeRectShape(start, end) {
  const rect = normalizeRect(start.x, start.y, end.x, end.y);

  if (rect.width < MIN_SHAPE_SIZE || rect.height < MIN_SHAPE_SIZE) {
    return null;
  }

  return createAnnotation('rect', rect);
}

function finalizeEllipseShape(start, end) {
  const rect = normalizeRect(start.x, start.y, end.x, end.y);

  if (rect.width < MIN_SHAPE_SIZE || rect.height < MIN_SHAPE_SIZE) {
    return null;
  }

  return createAnnotation('ellipse', rect);
}

function finalizeArrowShape(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (Math.hypot(dx, dy) < MIN_SHAPE_SIZE) {
    return null;
  }

  return createAnnotation('arrow', {
    x1: start.x,
    x2: end.x,
    y1: start.y,
    y2: end.y
  });
}

function startTextInput(point) {
  removePendingTextInput();

  if (!currentRect) {
    return;
  }

  const resizeInput = (input) => {
    const minWidth = Math.ceil(annotateSettings.fontSize * 2 + TEXT_INPUT_PADDING_X * 2 + 4);
    const maxWidth = Math.max(minWidth, window.innerWidth - (currentRect.x + point.x) - 16);
    const geometry = measureTextGeometry(input.value || '', annotateSettings.fontSize);
    input.style.width = `${Math.min(maxWidth, Math.max(minWidth, geometry.width + TEXT_INPUT_PADDING_X * 2 + 4))}px`;
  };

  const input = document.createElement('textarea');
  input.className = 'annotate-text-input';
  input.rows = 1;
  input.style.left = `${currentRect.x + point.x}px`;
  input.style.top = `${currentRect.y + point.y}px`;
  input.style.borderColor = annotateSettings.color;
  input.style.color = annotateSettings.color;
  input.style.fontSize = `${annotateSettings.fontSize}px`;
  root.appendChild(input);
  pendingTextInput = input;
  resizeInput(input);

  const finalize = () => {
    const text = input.value.trim();

    if (text) {
      const fontSize = clampTextFontSize(annotateSettings.fontSize);
      const geometry = measureTextGeometry(text, fontSize);
      annotations.push(
        createAnnotation('text', {
          fontSize,
          height: geometry.height,
          text,
          width: geometry.width,
          x: point.x + TEXT_INPUT_PADDING_X,
          y: point.y + TEXT_INPUT_PADDING_Y
        })
      );
      selectedAnnotationIndex = annotations.length - 1;
      syncToolbarFromSelectedShape();
      renderAnnotations();
    }

    removePendingTextInput();
  };

  input.addEventListener('blur', finalize, { once: true });
  input.addEventListener('input', () => {
    resizeInput(input);
  });
  input.addEventListener('mouseleave', () => {
    if (input.value.trim()) {
      input.blur();
    }
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      input.blur();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      input.value = '';
      input.blur();
    }
  });

  window.requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function createPreviewShape(tool, start) {
  if (tool === 'rect' || tool === 'ellipse') {
    return createAnnotation(tool, {
      height: 0,
      width: 0,
      x: start.x,
      y: start.y
    });
  }

  return createAnnotation('arrow', {
    x1: start.x,
    x2: start.x,
    y1: start.y,
    y2: start.y
  });
}

function finalizePreviewShape(start, end, type) {
  if (type === 'rect') {
    return finalizeRectShape(start, end);
  }

  if (type === 'ellipse') {
    return finalizeEllipseShape(start, end);
  }

  return finalizeArrowShape(start, end);
}

function handleTextToolPointer(event) {
  if (event.button !== 0 || isBusy || activeTool !== 'text' || !currentRect) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();

  const point = toSelectionPoint(event.clientX, event.clientY);
  const handleId = hitTestSelectionHandle(point);

  if (handleId && getSelectedAnnotation()) {
    resizeDragging = true;
    resizeHandleId = handleId;
    resizeStart = point;
    resizeSnapshot = cloneShapeGeometry(getSelectedAnnotation());
    document.body.style.cursor = getHandleCursor(handleId);
    return true;
  }

  if (isPointOnSelectedAnnotation(point)) {
    moveDragging = true;
    moveStart = point;
    moveSnapshot = cloneShapeGeometry(getSelectedAnnotation());
    document.body.style.cursor = 'grabbing';
    return true;
  }

  const hitIndex = findAnnotationIndexAtPoint(point);

  if (hitIndex !== null && annotations[hitIndex]?.type === 'text') {
    selectAnnotationIndex(hitIndex);
    return true;
  }

  startTextInput(point);
  return true;
}

function isScreenBorderVisible() {
  return Boolean(screenBorder && !screenBorder.hidden);
}

function hideSizeLabel() {
  if (sizeLabel) {
    sizeLabel.style.display = 'none';
  }
}

function showSizeLabelAt(x, y, width, height) {
  if (!sizeLabel) {
    return;
  }

  sizeLabel.style.display = 'block';
  sizeLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  sizeLabel.style.left = `${x}px`;
  sizeLabel.style.top = `${Math.max(8, y - 28)}px`;
}

function updateFullScreenSizeLabel() {
  if (!sizeLabel) {
    return;
  }

  sizeLabel.style.display = 'block';
  sizeLabel.textContent = `${Math.round(window.innerWidth)} × ${Math.round(window.innerHeight)}`;
  sizeLabel.style.left = '0px';
  sizeLabel.style.top = '8px';
}

function syncSizeLabelForCurrentState(rect) {
  const hasSelection = rect && rect.width >= 2 && rect.height >= 2;

  if (hasSelection) {
    showSizeLabelAt(rect.x, rect.y, rect.width, rect.height);
    return;
  }

  if (isScreenBorderVisible()) {
    updateFullScreenSizeLabel();
    return;
  }

  hideSizeLabel();
}

function setScreenBorderVisible(visible) {
  if (screenBorder) {
    screenBorder.hidden = !visible;
  }

  if (visible && (!currentRect || currentRect.width < 2 || currentRect.height < 2)) {
    updateFullScreenSizeLabel();
  }
}

function hideOverlayVisualsForCommit() {
  cancelPickerSampling();
  hideSizeLabel();
  hideSelectionMask();
  hidePickerInfo();
  hideOcrResultPanel();
  closeAllOptionPanels();
  setScreenBorderVisible(false);
  setOverlayPending(true);
  document.body.style.cursor = 'default';

  if (root) {
    root.style.pointerEvents = 'none';
  }

  selectionEl.style.display = 'none';
  hideDragPreview();

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }
}

async function waitForOverlayVisualsHidden() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await delay(35);
}

function restoreOverlayVisualsAfterCommitFailure() {
  setOverlayPending(false);

  if (root) {
    root.style.pointerEvents = '';
  }

  document.body.style.cursor = 'crosshair';

  if (currentRect && currentRect.width >= 10 && currentRect.height >= 10) {
    applyRect(currentRect, { maskOutside: !scrollCaptureMode });
  }
}

function hideSelectionMask() {
  if (selectionMask) {
    selectionMask.style.display = 'none';
  }
}

function updateSelectionMask(rect, visible) {
  if (!selectionMask || !rect || !visible) {
    hideSelectionMask();
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(0, Math.min(viewportWidth, rect.x));
  const top = Math.max(0, Math.min(viewportHeight, rect.y));
  const right = Math.max(0, Math.min(viewportWidth, rect.x + rect.width));
  const bottom = Math.max(0, Math.min(viewportHeight, rect.y + rect.height));

  selectionMask.style.display = 'block';

  if (selectionMaskPieces.top instanceof HTMLElement) {
    selectionMaskPieces.top.style.left = '0px';
    selectionMaskPieces.top.style.top = '0px';
    selectionMaskPieces.top.style.width = `${viewportWidth}px`;
    selectionMaskPieces.top.style.height = `${top}px`;
  }

  if (selectionMaskPieces.right instanceof HTMLElement) {
    selectionMaskPieces.right.style.left = `${right}px`;
    selectionMaskPieces.right.style.top = `${top}px`;
    selectionMaskPieces.right.style.width = `${Math.max(0, viewportWidth - right)}px`;
    selectionMaskPieces.right.style.height = `${Math.max(0, bottom - top)}px`;
  }

  if (selectionMaskPieces.bottom instanceof HTMLElement) {
    selectionMaskPieces.bottom.style.left = '0px';
    selectionMaskPieces.bottom.style.top = `${bottom}px`;
    selectionMaskPieces.bottom.style.width = `${viewportWidth}px`;
    selectionMaskPieces.bottom.style.height = `${Math.max(0, viewportHeight - bottom)}px`;
  }

  if (selectionMaskPieces.left instanceof HTMLElement) {
    selectionMaskPieces.left.style.left = '0px';
    selectionMaskPieces.left.style.top = `${top}px`;
    selectionMaskPieces.left.style.width = `${left}px`;
    selectionMaskPieces.left.style.height = `${Math.max(0, bottom - top)}px`;
  }
}

function applyRect(rect, options = {}) {
  const wantsMask = Boolean(options.maskOutside);
  const restoreScreenBorder = options.restoreScreenBorder !== false;
  const isTiny = !rect || rect.width < 2 || rect.height < 2;

  if (isTiny && !dragging) {
    selectionEl.style.display = 'none';
    selectionEl.classList.remove('with-mask');
    hideSelectionMask();
    clearOcrLayer();
    clearAnnotations();
    resetActiveTool();

    if (restoreScreenBorder) {
      setScreenBorderVisible(true);
    }

    if (!isBusy && toolbarWrap) {
      toolbarWrap.style.display = 'none';
    }

    syncSizeLabelForCurrentState(rect);
    return;
  }

  const displayWidth = dragging && rect.width < 1 ? 1 : rect.width;
  const displayHeight = dragging && rect.height < 1 ? 1 : rect.height;

  selectionEl.style.display = 'block';
  selectionEl.style.left = `${rect.x}px`;
  selectionEl.style.top = `${rect.y}px`;
  selectionEl.style.width = `${displayWidth}px`;
  selectionEl.style.height = `${displayHeight}px`;

  if (dragging) {
    return;
  }

  selectionEl.classList.toggle('with-mask', wantsMask);
  updateSelectionMask({ ...rect, height: displayHeight, width: displayWidth }, wantsMask);

  syncSizeLabelForCurrentState(rect);

  resizePaintLayer();
  updateAnnotateLayerInteractive();
  renderAnnotations();
  updateSelectionHandlesVisibility();
  positionOcrResultControls();
}

function placeToolbar(rect) {
  if (!toolbarWrap) {
    return;
  }

  if (toolbarManualPosition) {
    applyToolbarPosition(toolbarManualPosition.left, toolbarManualPosition.top);
    return;
  }

  toolbarWrap.style.left = '0px';
  toolbarWrap.style.top = '0px';
  toolbarWrap.style.visibility = 'hidden';
  toolbarWrap.style.display = 'flex';

  const toolbarBox = toolbarWrap.getBoundingClientRect();
  const toolbarWidth = Math.ceil(toolbarBox.width);
  const toolbarHeight = Math.ceil(toolbarBox.height);
  const padding = 8;
  
  let left = rect.x + rect.width - toolbarWidth;
  let top;

  // 优先检查下方空间是否足够
  const spaceBelow = window.innerHeight - (rect.y + rect.height);
  const spaceAbove = rect.y;
  
  // 如果下方空间足够（至少需要工具栏高度 + 两倍间距），则放下方
  if (spaceBelow >= toolbarHeight + padding * 2) {
    top = rect.y + rect.height + padding;
  } 
  // 否则放上方
  else {
    top = rect.y - toolbarHeight - padding;
    // 如果上方空间也不够，则尽量贴近选区上方
    if (top < padding) {
      top = padding;
    }
  }

  // 确保工具栏不超出左边界
  if (left < padding) {
    left = padding;
  }
  
  // 确保工具栏不超出右边界
  if (left + toolbarWidth > window.innerWidth - padding) {
    left = window.innerWidth - toolbarWidth - padding;
  }

  applyToolbarPosition(left, top);
}

function clampToolbarPosition(left, top) {
  if (!toolbarWrap) {
    return { left, top };
  }

  const padding = 8;
  const toolbarBox = toolbarWrap.getBoundingClientRect();
  const toolbarWidth = Math.ceil(toolbarBox.width);
  const toolbarHeight = Math.ceil(toolbarBox.height);

  return {
    left: Math.min(Math.max(padding, left), Math.max(padding, window.innerWidth - toolbarWidth - padding)),
    top: Math.min(Math.max(padding, top), Math.max(padding, window.innerHeight - toolbarHeight - padding))
  };
}

function applyToolbarPosition(left, top) {
  if (!toolbarWrap) {
    return;
  }

  const next = clampToolbarPosition(left, top);
  toolbarWrap.style.left = `${next.left}px`;
  toolbarWrap.style.top = `${next.top}px`;
  toolbarWrap.style.visibility = '';
  toolbarWrap.style.display = 'flex';
}

function beginToolbarDrag(event) {
  if (!(toolbarWrap instanceof HTMLElement) || event.button !== 0) {
    return;
  }

  const dragHandle = event.target instanceof Element ? event.target.closest('.screenshot-toolbar-drag-handle') : null;
  if (!(dragHandle instanceof HTMLButtonElement)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const rect = toolbarWrap.getBoundingClientRect();
  toolbarDragging = true;
  toolbarDragStart = {
    left: rect.left,
    top: rect.top,
    x: event.clientX,
    y: event.clientY
  };
  dragHandle.classList.add('dragging');
  document.body.style.cursor = 'grabbing';
}

function moveToolbarDrag(event) {
  if (!toolbarDragging || !toolbarDragStart) {
    return false;
  }

  const nextLeft = toolbarDragStart.left + event.clientX - toolbarDragStart.x;
  const nextTop = toolbarDragStart.top + event.clientY - toolbarDragStart.y;
  const next = clampToolbarPosition(nextLeft, nextTop);
  toolbarManualPosition = next;
  applyToolbarPosition(next.left, next.top);
  return true;
}

function endToolbarDrag() {
  if (!toolbarDragging) {
    return false;
  }

  toolbarDragging = false;
  toolbarDragStart = null;
  toolbar?.querySelector('.screenshot-toolbar-drag-handle')?.classList.remove('dragging');
  document.body.style.cursor = '';
  return true;
}

function toScreenRect(rect) {
  return {
    height: Math.round(rect.height * screenScale),
    width: Math.round(rect.width * screenScale),
    x: Math.round(rect.x * screenScale + offsetX),
    y: Math.round(rect.y * screenScale + offsetY)
  };
}

function applyDragPreviewRect(rect) {
  if (!(selectionDragPreviewEl instanceof HTMLElement)) {
    return;
  }

  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  selectionDragPreviewEl.hidden = false;
  selectionDragPreviewEl.style.display = 'block';
  selectionDragPreviewEl.style.width = `${width}px`;
  selectionDragPreviewEl.style.height = `${height}px`;
  selectionDragPreviewEl.style.transform = `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`;
}

function hideDragPreview() {
  if (!(selectionDragPreviewEl instanceof HTMLElement)) {
    return;
  }

  selectionDragPreviewEl.hidden = true;
  selectionDragPreviewEl.style.display = 'none';
}

function stopDragPreviewLoop() {
  if (dragPreviewRafId) {
    cancelAnimationFrame(dragPreviewRafId);
    dragPreviewRafId = 0;
  }

  if (dragPreviewLoopRafId) {
    cancelAnimationFrame(dragPreviewLoopRafId);
    dragPreviewLoopRafId = 0;
  }

  pendingDragPointer = null;
}

function applyDraggingSelectionPoint(clientX, clientY) {
  if (!dragging || isBusy) {
    return false;
  }

  if (clientX === lastDragPaintX && clientY === lastDragPaintY) {
    return true;
  }

  lastDragPaintX = clientX;
  lastDragPaintY = clientY;

  const point = toLocal(clientX, clientY);
  currentRect = normalizeRect(startX, startY, point.x, point.y);
  if (!selectionDragLogged && currentRect.width >= 2 && currentRect.height >= 2) {
    selectionDragLogged = true;
    const firstPaintMs = Math.round((window.performance?.now?.() ?? Date.now()) - selectionDragStartedAt);
    void window.screenshotOverlay?.debugLog?.(
      'screenshot-drag',
      `first paint duration_ms=${firstPaintMs} width=${Math.round(currentRect.width)} height=${Math.round(currentRect.height)} moves=${dragMoveEventCount} picker=${isPickerEnabled()}`
    );
  }

  if (selectionEl instanceof HTMLElement) {
    selectionEl.hidden = false;
    selectionEl.style.display = 'block';
    selectionEl.classList.remove('with-mask');
    selectionEl.style.left = `${Math.round(currentRect.x)}px`;
    selectionEl.style.top = `${Math.round(currentRect.y)}px`;
    selectionEl.style.width = `${Math.max(1, Math.round(currentRect.width))}px`;
    selectionEl.style.height = `${Math.max(1, Math.round(currentRect.height))}px`;
  }

  const showMask = currentRect.width >= 2 && currentRect.height >= 2;
  updateSelectionMask(currentRect, showMask);
  syncSizeLabelForCurrentState(currentRect);

  applyDragPreviewRect(currentRect);
  return true;
}

function flushDragPreviewFromPointer() {
  dragPreviewRafId = 0;

  if (!dragging || !pendingDragPointer) {
    return;
  }

  applyDraggingSelectionPoint(pendingDragPointer.x, pendingDragPointer.y);
}

function scheduleDragPointerUpdate(clientX, clientY) {
  pendingDragPointer = { x: clientX, y: clientY };
  dragMoveEventCount += 1;

  if (dragMoveEventCount === 1) {
    void window.screenshotOverlay?.debugLog?.(
      'screenshot-drag',
      `first move queued x=${Math.round(clientX)} y=${Math.round(clientY)} dragging=${dragging} busy=${isBusy} rect=${currentRect ? `${Math.round(currentRect.width)}x${Math.round(currentRect.height)}` : 'none'}`
    );
    applyDraggingSelectionPoint(clientX, clientY);
  }

  if (!dragPreviewRafId) {
    dragPreviewRafId = requestAnimationFrame(flushDragPreviewFromPointer);
  }
}

function startDragPreviewLoop() {
  stopDragPreviewLoop();
  dragMoveEventCount = 0;

  const tick = () => {
    if (!dragging) {
      dragPreviewLoopRafId = 0;
      return;
    }

    if (pendingDragPointer) {
      flushDragPreviewFromPointer();
    }

    dragPreviewLoopRafId = requestAnimationFrame(tick);
  };

  dragPreviewLoopRafId = requestAnimationFrame(tick);
}

function updateDraggingSelection(clientX, clientY) {
  if (!dragging || isBusy) {
    return false;
  }

  scheduleDragPointerUpdate(clientX, clientY);
  return true;
}

function handleDraggingPointerMove(event) {
  if (!dragging || isBusy) {
    return;
  }

  if (
    activeSelectionPointerId !== null &&
    event.pointerId !== activeSelectionPointerId &&
    (event.buttons & 1) !== 1
  ) {
    return;
  }

  updateDraggingSelection(event.clientX, event.clientY);
}

function handleDraggingMouseMove(event) {
  if (!dragging || isBusy) {
    return;
  }

  updateDraggingSelection(event.clientX, event.clientY);
}

function attachSelectionDragMoveListeners() {
  document.addEventListener('pointermove', handleDraggingPointerMove, true);
  document.addEventListener('mousemove', handleDraggingMouseMove, true);
}

function detachSelectionDragMoveListeners() {
  document.removeEventListener('pointermove', handleDraggingPointerMove, true);
  document.removeEventListener('mousemove', handleDraggingMouseMove, true);
  stopDragPreviewLoop();
  hideDragPreview();
}

function fromScreenRect(rect) {
  const scale = screenScale || 1;

  return {
    height: rect.height / scale,
    width: rect.width / scale,
    x: (rect.x - offsetX) / scale,
    y: (rect.y - offsetY) / scale
  };
}

function toInnerScreenRect(rect, inset = 3) {
  const safeInset = Math.max(0, Math.min(inset, Math.floor(Math.min(rect.width, rect.height) / 3)));

  return {
    height: Math.max(1, Math.round((rect.height - safeInset * 2) * screenScale)),
    width: Math.max(1, Math.round((rect.width - safeInset * 2) * screenScale)),
    x: Math.round((rect.x + safeInset) * screenScale + offsetX),
    y: Math.round((rect.y + safeInset) * screenScale + offsetY)
  };
}

function isToolbarTarget(target) {
  return target instanceof Element && Boolean(target.closest('#toolbar-wrap'));
}

function isTextLayerTarget(target) {
  return target instanceof Element && Boolean(target.closest('#text-layer'));
}

function isOcrInteractiveTarget(target) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '.ocr-word, .ocr-line, .translate-result, .translate-line, #ocr-result-open, #ocr-result-panel'
      )
    )
  );
}

function exitOcrMode() {
  if (!ocrReady && !translateReady) {
    return;
  }

  ocrGeneration += 1;
  clearOcrLayer();
  window.getSelection()?.removeAllRanges();
}

function isAnnotateInputTarget(target) {
  return target instanceof Element && Boolean(target.closest('.annotate-text-input'));
}

function isInsideCurrentSelection(clientX, clientY) {
  if (!currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return false;
  }

  return (
    clientX >= currentRect.x &&
    clientX <= currentRect.x + currentRect.width &&
    clientY >= currentRect.y &&
    clientY <= currentRect.y + currentRect.height
  );
}

function drawAnnotation(ctx, shape, scaleX, scaleY) {
  const style = getShapeStyle(shape);
  const lineScale = Math.max(scaleX, scaleY);
  const dashPattern = CANVAS_DASH_PATTERNS[style.lineStyle] ?? [];

  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.strokeWidth * lineScale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern.map((value) => value * lineScale));

  if (shape.type === 'rect') {
    ctx.strokeRect(shape.x * scaleX, shape.y * scaleY, shape.width * scaleX, shape.height * scaleY);
    ctx.setLineDash([]);
    return;
  }

  if (shape.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      (shape.x + shape.width / 2) * scaleX,
      (shape.y + shape.height / 2) * scaleY,
      (shape.width / 2) * scaleX,
      (shape.height / 2) * scaleY,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (shape.type === 'arrow') {
    const x1 = shape.x1 * scaleX;
    const y1 = shape.y1 * scaleY;
    const x2 = shape.x2 * scaleX;
    const y2 = shape.y2 * scaleY;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = Math.max(10, style.strokeWidth * 3) * lineScale;

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (shape.type === 'text' && shape.text) {
    ctx.setLineDash([]);
    const fontSize = (style.fontSize ?? ANNOTATE_FONT) * scaleY;
    ctx.font = `600 ${fontSize}px Segoe UI, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(shape.text, shape.x * scaleX, shape.y * scaleY);
  }
}

function compositeAnnotations(baseDataUrl, outputWidth, outputHeight) {
  return new Promise((resolve, reject) => {
    if (!annotations.length || !currentRect) {
      resolve(baseDataUrl);
      return;
    }

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(baseDataUrl);
        return;
      }

      ctx.drawImage(image, 0, 0, outputWidth, outputHeight);

      const scaleX = outputWidth / currentRect.width;
      const scaleY = outputHeight / currentRect.height;
      const mosaicStrokes = annotations.filter((item) => item.type === 'mosaic');
      const brushStrokes = annotations.filter((item) => item.type === 'brush');
      const vectorShapes = annotations.filter((item) => item.type !== 'brush' && item.type !== 'mosaic');

      drawMosaicStrokes(ctx, image, mosaicStrokes, scaleX, scaleY);

      for (const stroke of brushStrokes) {
        drawBrushStroke(ctx, stroke, scaleX, scaleY);
      }

      for (const shape of vectorShapes) {
        drawAnnotation(ctx, shape, scaleX, scaleY);
      }

      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('合成标注失败'));
    image.src = baseDataUrl;
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = dataUrl;
  });
}

function sampleFrameDifference(ctx, width, yA, yB, sampleRows) {
  let total = 0;
  const compareWidth = Math.max(1, Math.floor(width * 0.82));
  const startX = Math.max(0, Math.floor(width * 0.03));
  const stepX = Math.max(1, Math.floor(compareWidth / 96));
  let samples = 0;

  for (let row = 0; row < sampleRows; row += 1) {
    const a = ctx.getImageData(0, yA + row, width, 1).data;
    const b = ctx.getImageData(0, yB + row, width, 1).data;

    for (let x = startX; x < startX + compareWidth; x += stepX) {
      const index = x * 4;
      total += Math.abs(a[index] - b[index]);
      total += Math.abs(a[index + 1] - b[index + 1]);
      total += Math.abs(a[index + 2] - b[index + 2]);
      samples += 1;
    }
  }

  return samples > 0 ? total / samples : Number.POSITIVE_INFINITY;
}

function sampleOverlapDifference(ctx, width, matchHeight, overlap, sampleRows) {
  const safeRows = Math.max(2, Math.min(sampleRows, overlap));
  const maxBandOffset = Math.max(0, overlap - safeRows);
  const bandOffsets = Array.from(
    new Set([
      0,
      Math.floor(maxBandOffset * 0.25),
      Math.floor(maxBandOffset * 0.5),
      Math.floor(maxBandOffset * 0.75),
      maxBandOffset
    ])
  );
  let total = 0;
  let samples = 0;

  for (const offset of bandOffsets) {
    const yA = matchHeight - overlap + offset;
    const yB = matchHeight + offset;

    if (yA < 0 || yB + safeRows > matchHeight * 2) {
      continue;
    }

    const diff = sampleFrameDifference(ctx, width, yA, yB, safeRows);
    if (!Number.isFinite(diff)) {
      continue;
    }

    total += diff;
    samples += 1;
  }

  return samples > 0 ? total / samples : Number.POSITIVE_INFINITY;
}

function createOverlapMatchCanvas(previousImage, nextImage) {
  const width = Math.min(previousImage.width, nextImage.width);
  const scrollbarSafeWidth = Math.max(1, width - Math.min(28, Math.floor(width * 0.06)));
  const previousEdgeIgnore = getScrollFrameEdgeIgnore(previousImage);
  const nextEdgeIgnore = getScrollFrameEdgeIgnore(nextImage);
  const previousSourceY = previousEdgeIgnore.top;
  const nextSourceY = nextEdgeIgnore.top;
  const previousHeight = Math.max(1, previousImage.height - previousEdgeIgnore.top - previousEdgeIgnore.bottom);
  const nextHeight = Math.max(1, nextImage.height - nextEdgeIgnore.top - nextEdgeIgnore.bottom);
  const height = Math.min(previousHeight, nextHeight);
  const matchWidth = Math.min(OVERLAP_MATCH_WIDTH, scrollbarSafeWidth);
  const matchHeight = Math.max(1, Math.round(height * (matchWidth / scrollbarSafeWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = matchWidth;
  canvas.height = matchHeight * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return null;
  }

  ctx.drawImage(previousImage, 0, previousSourceY, scrollbarSafeWidth, height, 0, 0, matchWidth, matchHeight);
  ctx.drawImage(nextImage, 0, nextSourceY, scrollbarSafeWidth, height, 0, matchHeight, matchWidth, matchHeight);

  return { canvas, ctx, matchHeight, matchWidth, scale: height / matchHeight };
}

function findScrollFrameOverlap(previousImage, nextImage) {
  const match = createOverlapMatchCanvas(previousImage, nextImage);

  if (!match) {
    return 0;
  }

  const { ctx, matchHeight, matchWidth, scale } = match;
  const sampleRows = Math.min(96, Math.max(32, Math.floor(matchHeight / 5)));
  const scaledSampleRows = Math.min(18, Math.max(6, Math.floor(sampleRows / scale / 2)));
  const minOverlap = Math.min(Math.floor(matchHeight * 0.08), matchHeight - scaledSampleRows);
  const maxOverlap = Math.min(Math.floor(matchHeight * 0.97), matchHeight - scaledSampleRows);

  if (maxOverlap <= minOverlap) {
    return 0;
  }

  let bestOverlap = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  let secondBestDiff = Number.POSITIVE_INFINITY;
  const coarseStep = matchHeight > 420 ? 4 : 3;

  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += coarseStep) {
    const diff = sampleOverlapDifference(ctx, matchWidth, matchHeight, overlap, scaledSampleRows);

    if (diff < bestDiff) {
      secondBestDiff = bestDiff;
      bestDiff = diff;
      bestOverlap = overlap;
      continue;
    }

    if (diff < secondBestDiff) {
      secondBestDiff = diff;
    }
  }

  const refineStart = Math.max(minOverlap, bestOverlap - coarseStep * 2);
  const refineEnd = Math.min(maxOverlap, bestOverlap + coarseStep * 2);

  for (let overlap = refineStart; overlap <= refineEnd; overlap += 1) {
    const diff = sampleOverlapDifference(ctx, matchWidth, matchHeight, overlap, scaledSampleRows);

    if (diff < bestDiff) {
      secondBestDiff = bestDiff;
      bestDiff = diff;
      bestOverlap = overlap;
      continue;
    }

    if (diff < secondBestDiff) {
      secondBestDiff = diff;
    }
  }

  if (bestDiff >= SCROLL_OVERLAP_DIFF_THRESHOLD) {
    return 0;
  }

  if (Number.isFinite(secondBestDiff) && secondBestDiff - bestDiff < SCROLL_OVERLAP_AMBIGUITY_GAP && bestDiff > 20) {
    return 0;
  }

  return Math.round(bestOverlap * scale);
}

function getScrollFrameEdgeIgnore(image) {
  const edge = Math.min(96, Math.max(0, Math.floor(image.height * SCROLL_STITCH_EDGE_IGNORE_RATIO)));

  return {
    bottom: edge,
    top: edge
  };
}

function areScrollFramesSimilar(previousImage, nextImage) {
  const match = createOverlapMatchCanvas(previousImage, nextImage);

  if (!match) {
    return false;
  }

  const { ctx, matchHeight, matchWidth } = match;
  return sampleFrameDifference(ctx, matchWidth, 0, matchHeight, Math.min(16, Math.max(6, Math.floor(matchHeight / 8)))) < 2;
}

function getScrollFrameScrollbarState(image) {
  const stripWidth = Math.min(80, Math.max(1, image.width));
  const stripHeight = Math.max(1, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = stripWidth;
  canvas.height = stripHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return { atEnd: false, visible: false };
  }

  ctx.drawImage(image, image.width - stripWidth, 0, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight);
  const data = ctx.getImageData(0, 0, stripWidth, stripHeight).data;
  const rowHits = [];

  for (let y = 0; y < stripHeight; y += 1) {
    let hits = 0;

    for (let x = 0; x < stripWidth; x += 1) {
      const index = (y * stripWidth + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const brightness = (red + green + blue) / 3;

      if (alpha > 180 && max - min <= 42 && brightness >= 45 && brightness <= 210) {
        hits += 1;
      }
    }

    if (hits >= 2 && hits <= Math.max(24, stripWidth * 0.45)) {
      rowHits.push(y);
    }
  }

  if (rowHits.length < Math.max(24, stripHeight * 0.04)) {
    return { atEnd: false, visible: false };
  }

  const runs = [];
  let start = rowHits[0];
  let previous = rowHits[0];

  for (let index = 1; index < rowHits.length; index += 1) {
    const row = rowHits[index];

    if (row - previous > 4) {
      runs.push({ bottom: previous, top: start });
      start = row;
    }

    previous = row;
  }

  runs.push({ bottom: previous, top: start });
  const minThumbHeight = Math.max(24, stripHeight * 0.05);
  const thumb = runs
    .filter((run) => run.bottom - run.top + 1 >= minThumbHeight)
    .sort((left, right) => right.bottom - right.top - (left.bottom - left.top))[0];

  if (!thumb) {
    return { atEnd: false, visible: false };
  }

  return {
    atEnd: thumb.bottom >= stripHeight - SCROLLBAR_END_MARGIN,
    bottom: thumb.bottom,
    top: thumb.top,
    visible: true
  };
}

function canvasToPngBuffer(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      const base64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);

      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      resolve(bytes.buffer);
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('长图导出失败'));
        return;
      }

      blob.arrayBuffer().then(resolve).catch(() => reject(new Error('长图读取失败')));
    }, 'image/png');
  });
}

async function buildScrollCaptureImage() {
  logScrollCapture('build start');
  if (scrollCapturePieces.length === 0 || (scrollCapturePieces.length > 1 && !scrollCaptureStitchedWithOverlap)) {
    logScrollCapture('build skipped');
    return null;
  }

  const width = Math.min(...scrollCapturePieces.map((piece) => piece.image.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = scrollCaptureTotalHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    logScrollCapture('build skipped no canvas context');
    return null;
  }

  for (const piece of scrollCapturePieces) {
    const height = Math.min(piece.drawHeight ?? piece.image.height - piece.sourceY, piece.image.height - piece.sourceY);
    if (height <= 0) {
      continue;
    }
    ctx.drawImage(piece.image, 0, piece.sourceY, width, height, 0, piece.offsetY, width, height);
  }

  const png = await canvasToPngBuffer(canvas);
  logScrollCapture('build done', {
    height: canvas.height,
    pngBytes: png?.byteLength ?? 0,
    width: canvas.width
  });

  return {
    height: canvas.height,
    png,
    width: canvas.width
  };
}

function resetScrollCaptureStitchState() {
  scrollCaptureFrames = [];
  scrollCaptureLastStitchedFrame = null;
  scrollCapturePieces = [];
  scrollCapturePreparedImage = null;
  scrollCaptureTotalHeight = 0;
  scrollCaptureStitchedWithOverlap = false;
}

async function appendScrollCaptureFrame(frame, options = {}) {
  const silent = Boolean(options.silent);
  const auto = Boolean(options.auto);
  const detailed = Boolean(options.detailed);
  const makeResult = (appended, reason, extra = {}) => (detailed ? { appended, reason, ...extra } : appended);
  if (!frame?.dataUrl || scrollCaptureTotalHeight >= MAX_SCROLL_CAPTURE_OUTPUT_HEIGHT) {
    return makeResult(false, 'invalid');
  }

  const image = await loadImage(frame.dataUrl);
  const scrollbar = getScrollFrameScrollbarState(image);
  const previousFrame = scrollCaptureLastStitchedFrame;

  scrollCapturePreparedImage = null;
  scrollCaptureFrames.push(frame);
  if (scrollCaptureFrames.length > MAX_SCROLL_CAPTURE_FRAMES) {
    scrollCaptureFrames.shift();
  }

  if (!previousFrame) {
    const edgeIgnore = getScrollFrameEdgeIgnore(image);
    const drawHeight = Math.max(1, image.height - edgeIgnore.bottom);
    scrollCapturePieces.push({ image, offsetY: 0, sourceY: 0, drawHeight });
    scrollCaptureLastStitchedFrame = frame;
    scrollCaptureTotalHeight = drawHeight;
    return makeResult(true, 'first-frame', { scrollbar });
  }

  const previousImage = await loadImage(previousFrame.dataUrl);

  if (areScrollFramesSimilar(previousImage, image)) {
    return makeResult(false, 'unchanged', { scrollbar });
  }

  const overlap = findScrollFrameOverlap(previousImage, image);
  if (overlap <= 0) {
    return makeResult(false, 'no-overlap', { scrollbar });
  }

  const edgeIgnore = getScrollFrameEdgeIgnore(image);
  const sourceY = Math.min(image.height - 1, edgeIgnore.top + overlap);
  const addedHeight = Math.max(0, image.height - sourceY - edgeIgnore.bottom);
  const frameInnerHeight = Math.max(1, image.height - edgeIgnore.top - edgeIgnore.bottom);
  const addedRatio = addedHeight / frameInnerHeight;
  const maxNewContentRatio = auto ? SCROLL_AUTO_MAX_NEW_CONTENT_RATIO : SCROLL_MAX_NEW_CONTENT_RATIO;
  const minNewContentRatio = auto ? SCROLL_AUTO_MIN_NEW_CONTENT_RATIO : SCROLL_MIN_NEW_CONTENT_RATIO;

  if (addedHeight < 12 || addedRatio > maxNewContentRatio || addedRatio < minNewContentRatio) {
    return makeResult(false, 'invalid-added-height', { scrollbar });
  }

  if (addedHeight > image.height - edgeIgnore.top - edgeIgnore.bottom) {
    return makeResult(false, 'invalid-added-height', { scrollbar });
  }

  const nextTotalHeight = Math.min(MAX_SCROLL_CAPTURE_OUTPUT_HEIGHT, scrollCaptureTotalHeight + addedHeight);
  const drawHeight = nextTotalHeight - scrollCaptureTotalHeight;

  if (drawHeight <= 0) {
    return makeResult(false, 'max-height', { scrollbar });
  }

  scrollCapturePieces.push({ image, offsetY: scrollCaptureTotalHeight, sourceY, drawHeight });
  scrollCaptureLastStitchedFrame = frame;
  scrollCaptureTotalHeight = nextTotalHeight;
  scrollCaptureStitchedWithOverlap = true;
  logScrollCapture('append stitched', {
    addedHeight,
    addedRatio,
    drawHeight,
    offsetY: scrollCaptureTotalHeight - drawHeight,
    overlap,
    sourceY
  });
  return makeResult(true, 'stitched', { scrollbar });
}

async function rebuildScrollCapturePiecesFromFrames() {
  if (scrollCaptureFrames.length < 2) {
    return false;
  }

  const savedFrames = scrollCaptureFrames.map((entry) => ({ ...entry }));
  resetScrollCaptureStitchState();

  for (const frame of savedFrames) {
    await appendScrollCaptureFrame(frame);
  }

  return scrollCapturePieces.length > 1 && scrollCaptureStitchedWithOverlap;
}

async function captureScrollFrame(options = {}) {
  if (!scrollCaptureMode || scrollCaptureSampling || !currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return false;
  }

  scrollCaptureSampling = true;
  const screenRect = toInnerScreenRect(currentRect);

  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frame = await window.screenshotOverlay?.captureRegion(screenRect, {
      fresh: true,
      hideOverlay: false,
      restoreOverlay: false,
      scrollFrame: true
    });

    if (frame?.dataUrl && scrollCaptureMode) {
      return await appendScrollCaptureFrame(frame, options);
    }
  } catch {
    logScrollCapture('capture frame failed');
  } finally {
    scrollCaptureSampling = false;
  }

  return options.detailed ? { appended: false, reason: 'missing-frame' } : false;
}

function startScrollCaptureSampling() {
  window.clearInterval(scrollCaptureTimer);
  resetScrollCaptureStitchState();
  scrollCaptureTimer = window.setInterval(() => {
    if (scrollCaptureAutoRunning) {
      return;
    }

    void captureScrollFrame();
  }, SCROLL_CAPTURE_INTERVAL);
}

function stopScrollCaptureSampling() {
  window.clearInterval(scrollCaptureTimer);
  scrollCaptureTimer = 0;
  scrollCaptureSampling = false;
}

function stopAutoScrollCapture() {
  scrollCaptureAutoRunId += 1;
  scrollCaptureAutoRunning = false;
}

async function runAutoScrollCapture(runId) {
  logScrollCapture('auto start', { runId });
  if (!window.screenshotOverlay?.scrollTarget) {
    logScrollCapture('auto unsupported', { runId });
    scrollCaptureAutoRunning = false;
    void captureScrollFrame();
    return;
  }

  scrollCaptureAutoRunning = true;
  resetScrollCaptureStitchState();

  try {
    let idleCount = 0;
    await captureScrollFrame({ auto: true, silent: true });
    logScrollCapture('auto captured initial', { idleCount, runId });

    for (let step = 0; step < SCROLL_AUTO_MAX_STEPS; step += 1) {
      if (runId !== scrollCaptureAutoRunId || !scrollCaptureMode) {
        logScrollCapture('auto abort before step', { runId, step });
        return;
      }

      const screenRect = toInnerScreenRect(currentRect);
      const scrollPoint = {
        x: Math.round(screenRect.x + screenRect.width / 2),
        y: Math.round(screenRect.y + screenRect.height / 2)
      };

      setMousePassthrough(true, true);
      await window.screenshotOverlay.scrollTarget(SCROLL_AUTO_WHEEL_DELTA, scrollPoint);
      await delay(SCROLL_AUTO_STEP_DELAY);
      setMousePassthrough(false, false);
      await delay(80);

      const captureResult = await captureScrollFrame({ auto: true, detailed: true, silent: true });
      const appended = Boolean(captureResult?.appended);
      const idleReason =
        captureResult?.reason === 'unchanged' ||
        captureResult?.reason === 'missing-frame' ||
        captureResult?.reason === 'invalid';
      idleCount = appended || !idleReason ? 0 : idleCount + 1;
      const scrollbar = captureResult?.scrollbar;
      const reachedScrollEnd =
        scrollCapturePieces.length > 1 &&
        ((scrollbar?.visible && scrollbar.atEnd) ||
          (!scrollbar?.visible && captureResult?.reason === 'unchanged' && idleCount >= SCROLL_AUTO_IDLE_LIMIT));
      if (step % 5 === 0 || appended || reachedScrollEnd || idleCount >= SCROLL_AUTO_IDLE_LIMIT) {
        logScrollCapture('auto step', {
          appended,
          idleCount,
          reason: captureResult?.reason ?? '',
          reachedScrollEnd,
          runId,
          scrollbarAtEnd: Boolean(scrollbar?.atEnd),
          scrollbarBottom: scrollbar?.bottom ?? 0,
          scrollbarTop: scrollbar?.top ?? 0,
          scrollbarVisible: Boolean(scrollbar?.visible),
          step
        });
      }

      if (reachedScrollEnd) {
        logScrollCapture('auto break unchanged', { idleCount, runId, step });
        break;
      }

      if (idleCount >= SCROLL_AUTO_IDLE_LIMIT) {
        if (scrollbar?.visible && !scrollbar.atEnd) {
          logScrollCapture('auto keep scrolling with visible scrollbar', {
            idleCount,
            runId,
            scrollbarBottom: scrollbar.bottom ?? 0,
            step
          });
          idleCount = 0;
          continue;
        }

        logScrollCapture('auto break idle', { idleCount, runId, step });
        break;
      }

      if (scrollCaptureTotalHeight >= MAX_SCROLL_CAPTURE_OUTPUT_HEIGHT) {
        logScrollCapture('auto break max height', { runId, step });
        break;
      }
    }

    if (runId !== scrollCaptureAutoRunId || !scrollCaptureMode) {
      logScrollCapture('auto abort before finish', { runId });
      return;
    }

    setMousePassthrough(false, false);
    stopScrollCaptureSampling();
    try {
      scrollCapturePreparedImage = await buildScrollCaptureImage();
    } catch (error) {
      console.error('[tooldesk scroll-capture] build after auto failed', error);
      scrollCapturePreparedImage = null;
    }
    logScrollCapture('auto finish', {
      preparedHeight: scrollCapturePreparedImage?.height ?? 0,
      preparedPngBytes: scrollCapturePreparedImage?.png?.byteLength ?? 0,
      preparedWidth: scrollCapturePreparedImage?.width ?? 0,
      runId
    });
  } catch (error) {
    console.error('[tooldesk scroll-capture] auto failed', error);
    if (runId === scrollCaptureAutoRunId && scrollCaptureMode) {
      setMousePassthrough(false, false);
    }
  } finally {
    if (runId === scrollCaptureAutoRunId) {
      scrollCaptureAutoRunning = false;
    }
  }
}

function startAutoScrollCapture() {
  stopAutoScrollCapture();
  const runId = scrollCaptureAutoRunId;
  void runAutoScrollCapture(runId);
}

async function runAction(action) {
  if (isBusy || !currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return;
  }

  isBusy = true;
  clearPickerState();
  if (action !== 'pin' && action !== 'save') {
    hideOverlayVisualsForCommit();
  }
  detachSelectionDragMoveListeners();
  dragging = false;
  annotateDragging = false;
  paintDragging = false;
  selectionResizeDragging = false;
  selectionResizeHandleId = null;
  selectionResizeStart = null;
  selectionResizeSnapshot = null;
  previewShape = null;
  activePaintStroke = null;
  removePendingTextInput();
  resetActiveTool();

  const screenRect = toScreenRect(currentRect);
  const shouldUseScrollCapture = scrollCaptureMode;
  stopScrollCaptureSampling();
  stopAutoScrollCapture();
  cancelScrollCapturePassthroughReset();
  setMousePassthrough(false, false);

  let sessionEnded = false;

  try {
    if (shouldUseScrollCapture) {
      logScrollCapture('finish action start', { action });

      if (scrollCapturePieces.length === 0) {
        logScrollCapture('finish capture missing first frame', { action });
        await captureScrollFrame();
      }

      if (scrollCapturePieces.length <= 1 && scrollCaptureFrames.length >= 2) {
        logScrollCapture('finish rebuild pieces', { action });
        await rebuildScrollCapturePiecesFromFrames();
      }

      const scrollImage = scrollCapturePreparedImage || (await buildScrollCaptureImage());
      logScrollCapture('finish image selected', {
        action,
        fromPrepared: scrollImage === scrollCapturePreparedImage,
        height: scrollImage?.height ?? 0,
        pngBytes: scrollImage?.png?.byteLength ?? 0,
        width: scrollImage?.width ?? 0
      });

      if (scrollImage?.png) {
        try {
          const finishResult = await window.screenshotOverlay?.confirmWithPng(screenRect, action, scrollImage);
          logScrollCapture('finish invoke done', { action, canceled: Boolean(finishResult?.canceled) });
          if (finishResult?.canceled) {
            restoreOverlayVisualsAfterCommitFailure();
            applyRect(currentRect, { maskOutside: true });
            return;
          }
          exitScrollCaptureMode();
          sessionEnded = true;
          return;
        } catch (error) {
          console.error('[tooldesk scroll-capture] finish invoke failed', error);
        }
      }

      logScrollCapture('finish fallback start', { action });
      if (action === 'save') {
        hideOverlayVisualsForCommit();
      }
      await waitForOverlayVisualsHidden();
      const fallbackBase = await window.screenshotOverlay?.captureRegion(toInnerScreenRect(currentRect, 0), {
        fresh: true,
        restoreOverlay: false
      });

      if (fallbackBase?.dataUrl) {
        logScrollCapture('finish fallback captured', {
          action,
          height: fallbackBase.height ?? 0,
          width: fallbackBase.width ?? 0
        });
        if (action === 'save') {
          restoreOverlayVisualsAfterCommitFailure();
          applyRect(currentRect, { maskOutside: true });
        }

        const finishResult = await window.screenshotOverlay?.confirmWithImage(screenRect, action, fallbackBase.dataUrl);
        logScrollCapture('finish fallback invoke done', { action, canceled: Boolean(finishResult?.canceled) });
        if (finishResult?.canceled) {
          restoreOverlayVisualsAfterCommitFailure();
          applyRect(currentRect, { maskOutside: true });
          return;
        }
        exitScrollCaptureMode();
        sessionEnded = true;
        return;
      }

      logScrollCapture('finish fallback missing image', { action });
      restoreOverlayVisualsAfterCommitFailure();
      return;
    }

    if (action === 'pin' || action === 'save') {
      hideOverlayVisualsForCommit();
    }
    await waitForOverlayVisualsHidden();

    const base = await window.screenshotOverlay?.captureRegion(screenRect, { fresh: true, restoreOverlay: false });
    const dataUrl = base?.dataUrl
      ? await compositeAnnotations(base.dataUrl, base.width, base.height)
      : null;

    if (dataUrl) {
      if (action === 'save') {
        restoreOverlayVisualsAfterCommitFailure();
        applyRect(currentRect, { maskOutside: true });
      }

      const finishResult = await window.screenshotOverlay?.confirmWithImage(screenRect, action, dataUrl);
      if (finishResult?.canceled) {
        restoreOverlayVisualsAfterCommitFailure();
        applyRect(currentRect, { maskOutside: true });
        return;
      }
      sessionEnded = true;
    } else {
      restoreOverlayVisualsAfterCommitFailure();
      applyRect(currentRect, { maskOutside: true });
    }
  } catch {
    exitScrollCaptureMode();
    restoreOverlayVisualsAfterCommitFailure();
    applyRect(currentRect, { maskOutside: true });
    setOcrStatus(action === 'save' ? '截图保存失败' : '截图处理失败');
  } finally {
    isBusy = false;

    if (sessionEnded) {
      flushPendingShortcutOverlayStart();
      return;
    }

    if (!sessionEnded && toolbarWrap && currentRect && currentRect.width >= 10 && currentRect.height >= 10) {
      toolbarWrap.style.display = 'flex';
      placeToolbar(currentRect);
      updateScrollCaptureToolbarUI();
    }
  }
}

function hasActiveScreenshotSelection() {
  return Boolean(
    currentRect &&
      currentRect.width >= 10 &&
      currentRect.height >= 10 &&
      toolbarWrap?.style.display !== 'none'
  );
}

function hasActiveScreenshotInteraction() {
  return Boolean(
    hasActiveScreenshotSelection() ||
      dragging ||
      annotateDragging ||
      paintDragging ||
      moveDragging ||
      resizeDragging ||
      selectionResizeDragging ||
      toolbarDragging ||
      recordingRegionMode ||
      regionPlaybackMode ||
      scrollCaptureMode
  );
}

function requestShortcutOverlayStart(config) {
  if (isBusy) {
    pendingShortcutStartConfig = config || {};
    void window.screenshotOverlay?.debugLog?.('screenshot-ui', 'shortcut pending reason=busy');
    return true;
  }

  if (hasActiveScreenshotInteraction()) {
    pendingShortcutStartConfig = config || {};
    void window.screenshotOverlay?.debugLog?.('screenshot-ui', 'shortcut pending reason=interaction');
    return true;
  }

  window.tauriScreenshotOverlayStart?.(config || {});
  return true;
}

function flushPendingShortcutOverlayStart() {
  if (!pendingShortcutStartConfig) {
    return;
  }

  const config = pendingShortcutStartConfig;
  pendingShortcutStartConfig = null;
  void window.screenshotOverlay?.debugLog?.('screenshot-ui', 'shortcut pending flush');
  window.tauriScreenshotOverlayStart?.(config);
}

function resetLocalSelection() {
  if (isBusy) {
    return;
  }

  exitScrollCaptureMode();
  exitRecordingRegionMode();
  detachSelectionDragMoveListeners();
  dragging = false;
  annotateDragging = false;
  paintDragging = false;
  selectionResizeDragging = false;
  selectionResizeHandleId = null;
  selectionResizeStart = null;
  selectionResizeSnapshot = null;
  toolbarDragging = false;
  toolbarDragStart = null;
  toolbarManualPosition = null;
  previewShape = null;
  activePaintStroke = null;
  removePendingTextInput();
  resetActiveTool();
  ocrGeneration += 1;
  clearOcrLayer();
  clearAnnotations();
  currentRect = null;
  pickerSuppressedAfterSelectionStart = false;

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  applyRect({ height: 0, width: 0, x: 0, y: 0 });
  setScreenBorderVisible(true);
}

function exitScreenshot() {
  if (isBusy) {
    return;
  }

  isBusy = true;
  clearPickerState();
  exitScrollCaptureMode();
  exitRecordingRegionMode();

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  detachSelectionDragMoveListeners();
  dragging = false;
  annotateDragging = false;
  paintDragging = false;
  previewShape = null;
  activePaintStroke = null;
  removePendingTextInput();
  resetActiveTool();
  
  // 清理选区状态，避免下次启动时闪现
  currentRect = null;
  clearOcrLayer();
  clearAnnotations();
  applyRect({ height: 0, width: 0, x: 0, y: 0 });
  
  void window.screenshotOverlay?.cancel();
}

function setMousePassthrough(enabled, forward) {
  const nextForward = forward ?? (regionPlaybackMode ? false : !recordingRegionMode);

  if (mousePassthroughActive === enabled && mousePassthroughForward === nextForward) {
    return;
  }

  mousePassthroughActive = enabled;
  mousePassthroughForward = nextForward;
  void window.screenshotOverlay?.setMousePassthrough?.(enabled, nextForward);
}

function resetPointerInteractionState() {
  if (activeSelectionPointerId !== null) {
    try {
      root.releasePointerCapture?.(activeSelectionPointerId);
    } catch {}
  }

  activeSelectionPointerId = null;
  setMousePassthrough(false, false);
}

function cancelScrollCapturePassthroughReset() {
  if (!scrollCapturePassthroughTimer) {
    return;
  }

  window.clearTimeout(scrollCapturePassthroughTimer);
  scrollCapturePassthroughTimer = 0;
}

function scheduleScrollCapturePassthroughReset() {
  if (scrollCapturePointerPassthrough) {
    return;
  }

  cancelScrollCapturePassthroughReset();
  scrollCapturePassthroughTimer = window.setTimeout(() => {
    scrollCapturePassthroughTimer = 0;

    if (scrollCaptureMode && !scrollCapturePointerPassthrough) {
      setMousePassthrough(false, false);
    }
  }, SCROLL_PASSTHROUGH_RELEASE_MS);
}

function isRegionPlaybackInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest('#recording-playback'));
}

function isRegionPlaybackInteractivePoint(clientX, clientY, target) {
  return (
    Boolean(
      currentRect &&
        currentRect.width >= 10 &&
        currentRect.height >= 10 &&
        isInsideCurrentSelection(clientX, clientY)
    ) || isRegionPlaybackInteractiveTarget(target)
  );
}

function updateRegionPlaybackPassthrough(clientX, clientY, target) {
  if (!regionPlaybackMode) {
    return;
  }

  const insideInteractive = isRegionPlaybackInteractivePoint(clientX, clientY, target);

  if (insideInteractive) {
    setMousePassthrough(false, false);
    return;
  }

  // 选区外保持穿透，但 forward 必须为 true，否则 renderer 收不到 mousemove，无法切回可点击态。
  setMousePassthrough(true, true);
}

function focusRegionPlaybackInteraction() {
  if (!regionPlaybackMode) {
    return;
  }

  setMousePassthrough(false, false);
}

function getRegionPlaybackDuration(video) {
  if (!(video instanceof HTMLVideoElement)) {
    return regionPlaybackDurationHint > 0 ? regionPlaybackDurationHint : 0;
  }

  if (Number.isFinite(video.duration) && video.duration > 0) {
    return video.duration;
  }

  if (video.buffered.length > 0) {
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);

    if (Number.isFinite(bufferedEnd) && bufferedEnd > 0) {
      return bufferedEnd;
    }
  }

  return regionPlaybackDurationHint > 0 ? regionPlaybackDurationHint : 0;
}

function updateRegionPlaybackSeekFromVideo() {
  if (!(recordingPlaybackVideo instanceof HTMLVideoElement) || !(recordingPlaybackSeek instanceof HTMLInputElement)) {
    return;
  }

  const duration = getRegionPlaybackDuration(recordingPlaybackVideo);
  const current = recordingPlaybackVideo.currentTime;

  if (duration > 0) {
    recordingPlaybackSeek.value = String(Math.round((current / duration) * 1000));
  }

  updateRegionPlaybackTimeLabel();
}

function startRegionPlaybackProgressLoop() {
  if (regionPlaybackProgressFrame) {
    return;
  }

  const tick = () => {
    if (!regionPlaybackMode || !(recordingPlaybackVideo instanceof HTMLVideoElement)) {
      regionPlaybackProgressFrame = 0;
      return;
    }

    if (!regionPlaybackSeekDragging) {
      updateRegionPlaybackSeekFromVideo();
    }

    regionPlaybackProgressFrame = window.requestAnimationFrame(tick);
  };

  regionPlaybackProgressFrame = window.requestAnimationFrame(tick);
}

function stopRegionPlaybackProgressLoop() {
  if (!regionPlaybackProgressFrame) {
    return;
  }

  window.cancelAnimationFrame(regionPlaybackProgressFrame);
  regionPlaybackProgressFrame = 0;
}

function updateScrollCapturePassthrough(clientX, clientY, target) {
  if (!scrollCaptureMode) {
    return;
  }

  if (!isInsideCurrentSelection(clientX, clientY) || isToolbarTarget(target)) {
    cancelScrollCapturePassthroughReset();
    setMousePassthrough(false, false);
  }

  document.body.style.cursor = 'default';
}

function releaseScrollCaptureWheelToPage(clientX, clientY, target) {
  if (!scrollCaptureMode || !isInsideCurrentSelection(clientX, clientY) || isToolbarTarget(target)) {
    return false;
  }

  setMousePassthrough(true, true);
  scheduleScrollCapturePassthroughReset();
  return true;
}

function beginScrollCapturePointerPassthrough(clientX, clientY, target) {
  if (!scrollCaptureMode || !isInsideCurrentSelection(clientX, clientY) || isToolbarTarget(target)) {
    return false;
  }

  cancelScrollCapturePassthroughReset();
  scrollCapturePointerPassthrough = true;
  setMousePassthrough(true, true);
  return true;
}

function endScrollCapturePointerPassthrough() {
  if (!scrollCapturePointerPassthrough) {
    return;
  }

  scrollCapturePointerPassthrough = false;
  scheduleScrollCapturePassthroughReset();
}

function enterScrollCaptureMode() {
  scrollCaptureMode = true;
  stopAutoScrollCapture();
  scrollCapturePointerPassthrough = false;
  clearActiveTool();
  closeLineStyleMenu();
  removePendingTextInput();
  hidePickerInfo();
  setScreenBorderVisible(false);
  selectionEl?.classList.remove('with-mask');
  hideSelectionMask();
  document.body.classList.add('scroll-capture-mode');
  document.body.style.cursor = 'default';
  setMousePassthrough(false);
  void window.screenshotOverlay?.refreshWindowChrome?.();
  updateSelectionHandlesVisibility();
  updateScrollCaptureToolbarUI();
  startScrollCaptureSampling();
}

function exitScrollCaptureMode() {
  if (!scrollCaptureMode && !mousePassthroughActive) {
    return;
  }

  stopAutoScrollCapture();
  stopScrollCaptureSampling();
  cancelScrollCapturePassthroughReset();
  scrollCapturePointerPassthrough = false;

  scrollCaptureMode = false;
  document.body.classList.remove('scroll-capture-mode');
  setMousePassthrough(false);
  setDefaultToolCursor();
  updateSelectionHandlesVisibility();
  updateScrollCaptureToolbarUI();
  setOcrStatus('');
  if (!currentRect || currentRect.width < 2 || currentRect.height < 2) {
    setScreenBorderVisible(true);
  }
}

function suppressOverlayVisualsDuringRecording() {
  pendingPickerPoint = null;
  lastPickerReady = false;

  if (pickerFrame) {
    window.cancelAnimationFrame(pickerFrame);
    pickerFrame = 0;
  }

  hidePickerInfo();
}

function enterRecordingRegionMode() {
  if (!currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return;
  }

  recordingRegionMode = true;
  clearActiveTool();
  closeAllOptionPanels();
  removePendingTextInput();
  suppressOverlayVisualsDuringRecording();
  hideOcrResultPanel();
  setScreenBorderVisible(false);
  selectionEl.classList.remove('with-mask');
  hideSelectionMask();
  selectionEl.classList.add('recording-region');
  selectionEl.style.display = 'block';
  selectionEl.style.pointerEvents = 'none';
  clearOcrLayer();
  updateSelectionHandlesVisibility();

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  document.body.classList.add('recording-region-mode');
  document.body.style.cursor = 'none';
  setMousePassthrough(true, false);
}

function exitRecordingRegionMode() {
  if (!recordingRegionMode) {
    return;
  }

  recordingRegionMode = false;
  selectionEl.classList.remove('recording-region');
  selectionEl.style.pointerEvents = '';
  document.body.classList.remove('recording-region-mode');
  setMousePassthrough(false);
  setDefaultToolCursor();
  updateSelectionHandlesVisibility();
}

function formatRegionPlaybackTime(value) {
  if (!Number.isFinite(value) || value < 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function updateRegionPlaybackTimeLabel() {
  if (!(recordingPlaybackTime instanceof HTMLElement) || !(recordingPlaybackVideo instanceof HTMLVideoElement)) {
    return;
  }

  const duration = getRegionPlaybackDuration(recordingPlaybackVideo);
  const current = recordingPlaybackVideo.currentTime;
  const durationLabel = duration > 0 ? formatRegionPlaybackTime(duration) : '--:--';
  recordingPlaybackTime.textContent = `${formatRegionPlaybackTime(current)} / ${durationLabel}`;
}

function updateRegionPlaybackPlayButton() {
  if (!(recordingPlaybackToggle instanceof HTMLButtonElement) || !(recordingPlaybackVideo instanceof HTMLVideoElement)) {
    return;
  }

  const isPaused = recordingPlaybackVideo.paused || recordingPlaybackVideo.ended;
  recordingPlaybackToggle.dataset.state = isPaused ? 'paused' : 'playing';
  recordingPlaybackToggle.title = isPaused ? '播放' : '暂停';
  recordingPlaybackToggle.setAttribute('aria-label', isPaused ? '播放' : '暂停');
}

function toggleRegionPlayback() {
  if (!(recordingPlaybackVideo instanceof HTMLVideoElement)) {
    return;
  }

  if (recordingPlaybackVideo.paused || recordingPlaybackVideo.ended) {
    if (recordingPlaybackVideo.ended) {
      recordingPlaybackVideo.currentTime = 0;
      if (recordingPlaybackSeek instanceof HTMLInputElement) {
        recordingPlaybackSeek.value = '0';
      }
    }

    void recordingPlaybackVideo.play().catch(() => {
      stopRegionPlaybackProgressLoop();
    });
    return;
  }

  recordingPlaybackVideo.pause();
  stopRegionPlaybackProgressLoop();
}

function layoutRegionPlaybackVideo() {
  if (
    !(recordingPlaybackVideo instanceof HTMLVideoElement) ||
    !regionPlaybackCropRect ||
    !regionPlaybackSourceSize ||
    !currentRect
  ) {
    return;
  }

  const wrap = recordingPlaybackVideo.parentElement;

  if (!(wrap instanceof HTMLElement)) {
    return;
  }

  const wrapWidth = wrap.clientWidth || currentRect.width;
  const wrapHeight = wrap.clientHeight || currentRect.height;
  const scale = Math.max(wrapWidth / regionPlaybackCropRect.width, wrapHeight / regionPlaybackCropRect.height);

  recordingPlaybackVideo.style.width = `${regionPlaybackSourceSize.width * scale}px`;
  recordingPlaybackVideo.style.height = `${regionPlaybackSourceSize.height * scale}px`;
  recordingPlaybackVideo.style.left = `${-regionPlaybackCropRect.x * scale}px`;
  recordingPlaybackVideo.style.top = `${-regionPlaybackCropRect.y * scale}px`;
}

function enterRegionRecordingPlaybackMode(payload) {
  if (
    !payload?.videoUrl ||
    !payload?.cropRect ||
    !(recordingPlaybackEl instanceof HTMLElement) ||
    !(recordingPlaybackVideo instanceof HTMLVideoElement) ||
    !(recordingPlaybackSeek instanceof HTMLInputElement)
  ) {
    return;
  }

  if (
    (!currentRect || currentRect.width < 10 || currentRect.height < 10) &&
    payload.selectionRect &&
    payload.selectionRect.width >= 10 &&
    payload.selectionRect.height >= 10
  ) {
    currentRect = fromScreenRect(payload.selectionRect);
    applyRect(currentRect, { maskOutside: false, restoreScreenBorder: false });
  }

  if (!currentRect || currentRect.width < 10 || currentRect.height < 10) {
    return;
  }

  regionPlaybackMode = true;
  regionPlaybackCropRect = payload.cropRect;
  regionPlaybackSourceSize = {
    height: payload.sourceHeight,
    width: payload.sourceWidth
  };
  regionPlaybackSeekDragging = false;
  regionPlaybackWasPlayingBeforeSeek = false;
  regionPlaybackDurationHint = Math.max(0, Number(payload.durationMs ?? 0) / 1000);

  if (recordingRegionMode) {
    recordingRegionMode = false;
    document.body.classList.remove('recording-region-mode');
    document.body.style.cursor = '';
  }

  clearActiveTool();
  closeAllOptionPanels();
  removePendingTextInput();
  suppressOverlayVisualsDuringRecording();
  hideOcrResultPanel();
  setScreenBorderVisible(false);
  setMousePassthrough(false, false);

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  selectionEl.classList.remove('with-mask');
  hideSelectionMask();
  selectionEl.classList.add('recording-region', 'playback-region');
  selectionEl.style.display = 'block';
  selectionEl.style.pointerEvents = 'auto';
  clearOcrLayer();
  updateSelectionHandlesVisibility();

  recordingPlaybackSeek.value = '0';
  updateRegionPlaybackTimeLabel();
  recordingPlaybackEl.hidden = false;

  const startPlayback = () => {
    layoutRegionPlaybackVideo();
    void recordingPlaybackVideo.play().catch(() => {
      updateRegionPlaybackPlayButton();
      stopRegionPlaybackProgressLoop();
    });
    updateRegionPlaybackTimeLabel();
    updateRegionPlaybackPlayButton();
    startRegionPlaybackProgressLoop();
  };

  recordingPlaybackVideo.onloadedmetadata = startPlayback;
  recordingPlaybackVideo.ondurationchange = () => {
    updateRegionPlaybackSeekFromVideo();
  };
  recordingPlaybackVideo.onended = () => {
    regionPlaybackSeekDragging = false;
    regionPlaybackWasPlayingBeforeSeek = false;
    if (getRegionPlaybackDuration(recordingPlaybackVideo) > 0) {
      recordingPlaybackSeek.value = '1000';
    }
    updateRegionPlaybackTimeLabel();
    updateRegionPlaybackPlayButton();
  };
  recordingPlaybackVideo.src = payload.videoUrl;
  recordingPlaybackVideo.load();
  startRegionPlaybackProgressLoop();
}

function exitRegionRecordingPlaybackMode() {
  if (!regionPlaybackMode) {
    return;
  }

  regionPlaybackMode = false;
  regionPlaybackCropRect = null;
  regionPlaybackSourceSize = null;
  regionPlaybackDurationHint = 0;
  regionPlaybackSeekDragging = false;
  regionPlaybackWasPlayingBeforeSeek = false;
  stopRegionPlaybackProgressLoop();

  if (recordingPlaybackVideo instanceof HTMLVideoElement) {
    recordingPlaybackVideo.pause();
    recordingPlaybackVideo.onloadedmetadata = null;
    recordingPlaybackVideo.ondurationchange = null;
    recordingPlaybackVideo.onended = null;
    recordingPlaybackVideo.removeAttribute('src');
    recordingPlaybackVideo.load();
  }

  if (recordingPlaybackSeek instanceof HTMLInputElement) {
    recordingPlaybackSeek.value = '0';
  }

  if (recordingPlaybackEl instanceof HTMLElement) {
    recordingPlaybackEl.hidden = true;
  }

  if (recordingPlaybackTime instanceof HTMLElement) {
    recordingPlaybackTime.textContent = '00:00 / 00:00';
  }

  if (recordingPlaybackToggle instanceof HTMLButtonElement) {
    recordingPlaybackToggle.dataset.state = 'paused';
    recordingPlaybackToggle.title = '播放';
    recordingPlaybackToggle.setAttribute('aria-label', '播放');
  }

  selectionEl?.classList.remove('playback-region');
}

function dismissScreenshotSubState() {
  if (regionPlaybackMode) {
    exitRegionRecordingPlaybackMode();
    if (currentRect && selectionEl) {
      selectionEl.classList.add('recording-region');
      selectionEl.style.display = 'block';
      selectionEl.style.pointerEvents = 'none';
    }
    return true;
  }

  if (ocrResultPanel instanceof HTMLElement && !ocrResultPanel.hidden) {
    hideOcrResultPanel();
    return true;
  }

  if (lineStylePicker?.classList.contains('open')) {
    closeLineStyleMenu();
    return true;
  }

  if (pendingTextInput) {
    pendingTextInput.value = '';
    pendingTextInput.blur();
    return true;
  }

  if (activeTool) {
    resetActiveTool();

    if (hasActiveScreenshotSelection()) {
      placeToolbar(currentRect);
    }

    return true;
  }

  return false;
}

function handleScreenshotRightClick(event) {
  if (isBusy) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  exitScreenshot();
}

window.addEventListener(
  'contextmenu',
  (event) => {
    if (!ocrReady || !getSelectedOcrText()) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    copySelectedText();
  },
  true
);

window.addEventListener('contextmenu', handleScreenshotRightClick);

// 注意：不再监听 auxclick，因为 contextmenu 已经能捕获右键点击
// 监听两个事件会导致 handleScreenshotRightClick 被调用两次

function copySelectedText() {
  const selected = getSelectedOcrText();

  if (!selected) {
    return false;
  }

  void window.screenshotOverlay?.copyText(selected);
  setOcrStatus('已复制文字');
  return true;
}

function beginSelectionDrag(event) {
  detachSelectionDragMoveListeners();
  dragging = true;
  selectionDragLogged = false;
  selectionDragStartedAt = window.performance?.now?.() ?? Date.now();
  lastDragPaintX = NaN;
  lastDragPaintY = NaN;
  setOverlayPending(false);

  if (root) {
    root.style.pointerEvents = '';
  }

  attachSelectionDragMoveListeners();
  void window.screenshotOverlay?.debugLog?.(
    'screenshot-drag',
    `start x=${Math.round(event.clientX)} y=${Math.round(event.clientY)} picker=${isPickerEnabled()} selectionDisplay=${selectionEl instanceof HTMLElement ? selectionEl.style.display || '(empty)' : 'n/a'} overlayPending=${root?.classList.contains('overlay-pending')}`
  );
  cancelPickerSampling();
  cancelInitialPickerSnapshot();
  cancelDeferredPickerWarmup();
  toolbarManualPosition = null;
  suppressPickerInfoAfterSelectionStart();
  setScreenBorderVisible(false);
  ocrGeneration += 1;
  clearOcrLayer();
  clearAnnotations();
  resetActiveTool();
  const point = toLocal(event.clientX, event.clientY);
  startX = point.x;
  startY = point.y;
  currentRect = { height: 0, width: 0, x: point.x, y: point.y };
  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  if (selectionEl instanceof HTMLElement) {
    selectionEl.hidden = false;
    selectionEl.style.display = 'block';
    selectionEl.style.left = `${point.x}px`;
    selectionEl.style.top = `${point.y}px`;
    selectionEl.style.width = '1px';
    selectionEl.style.height = '1px';
  }

  hideSelectionMask();
  hideDragPreview();
  startDragPreviewLoop();
  scheduleDragPointerUpdate(event.clientX, event.clientY);
}

function finishSelectionDrag(event) {
  if (!dragging || event.button !== 0 || isBusy) {
    return false;
  }

  detachSelectionDragMoveListeners();
  dragging = false;

  if (isToolbarTarget(event.target)) {
    return true;
  }

  const dragDurationMs = Math.round((window.performance?.now?.() ?? Date.now()) - selectionDragStartedAt);
  const point = toLocal(event.clientX, event.clientY);
  currentRect = normalizeRect(startX, startY, point.x, point.y);
  const selectionReady = currentRect.width >= 10 && currentRect.height >= 10;
  applyRect(currentRect, { maskOutside: selectionReady });

  if (selectionReady) {
    showToolbarAfterSelection();
  } else if (!colorSampler.ready && isPickerEnabled()) {
    scheduleDeferredPickerWarmup(colorSamplerSessionId);
  }

  void window.screenshotOverlay?.debugLog?.(
    'screenshot-drag',
    `finish duration_ms=${dragDurationMs} ready=${selectionReady} width=${Math.round(currentRect.width)} height=${Math.round(currentRect.height)} moves=${dragMoveEventCount}`
  );

  return true;
}

root.addEventListener('pointerdown', (event) => {
  if (
    event.button !== 0 ||
    isBusy ||
    dragging ||
    recordingRegionMode ||
    regionPlaybackMode ||
    scrollCaptureMode ||
    isToolbarTarget(event.target) ||
    isOcrInteractiveTarget(event.target) ||
    isAnnotateInputTarget(event.target)
  ) {
    return;
  }

  cancelPickerSampling();
  if (
    (currentRect && hitTestCurrentSelectionHandle(event.clientX, event.clientY)) ||
    (currentRect && currentRect.width >= 10 && isInsideCurrentSelection(event.clientX, event.clientY))
  ) {
    return;
  }

  resetPointerInteractionState();
  activeSelectionPointerId = event.pointerId;
  root.setPointerCapture?.(event.pointerId);
  beginSelectionDrag(event);
  event.preventDefault();
});

root.addEventListener('mousedown', (event) => {
  if (regionPlaybackMode) {
    if (isRegionPlaybackInteractiveTarget(event.target)) {
      focusRegionPlaybackInteraction();
    }

    return;
  }

  if (recordingRegionMode) {
    return;
  }

  if (
    event.button !== 0 ||
    isBusy ||
    dragging ||
    isToolbarTarget(event.target) ||
    isOcrInteractiveTarget(event.target) ||
    isAnnotateInputTarget(event.target)
  ) {
    return;
  }

  if (scrollCaptureMode) {
    beginScrollCapturePointerPassthrough(event.clientX, event.clientY, event.target);
    event.preventDefault();
    return;
  }

  const selectionHandleId = hitTestCurrentSelectionHandle(event.clientX, event.clientY);
  if (selectionHandleId && currentRect) {
    selectionResizeDragging = true;
    selectionResizeHandleId = selectionHandleId;
    selectionResizeStart = { x: event.clientX, y: event.clientY };
    selectionResizeSnapshot = { ...currentRect };
    document.body.style.cursor = getHandleCursor(selectionHandleId);
    suppressPickerInfoAfterSelectionStart();
    event.preventDefault();
    return;
  }

  if (currentRect && currentRect.width >= 10 && isInsideCurrentSelection(event.clientX, event.clientY)) {
    if (activeTool === 'text') {
      handleTextToolPointer(event);
      return;
    }

    if (activeTool === 'rect' || activeTool === 'ellipse') {
      beginShapeToolPointer(event, activeTool);
      return;
    }

    if (activeTool === 'arrow') {
      beginShapeToolPointer(event, 'arrow');
      return;
    }

    if (activeTool === 'brush' || activeTool === 'mosaic') {
      if (activeTool === 'mosaic' && !selectionBaseImageEl) {
        void cacheSelectionBaseImage();
      }

      paintDragging = true;
      const point = toSelectionPoint(event.clientX, event.clientY);
      activePaintStroke = activeTool === 'brush' ? createBrushStroke(point) : createMosaicStroke(point);
      renderPaintLayer();
      return;
    }

    if (ocrReady || translateReady) {
      if (isOcrInteractiveTarget(event.target)) {
        return;
      }

      exitOcrMode();
    }

    if (!activeTool) {
      moveDragging = true;
      moveStart = { x: event.clientX, y: event.clientY };
      moveSnapshot = { ...currentRect };
      document.body.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }

    return;
  }

  // New selection drag is handled by pointerdown; avoid resetting pointer capture on mousedown.
  if (dragging || activeSelectionPointerId !== null) {
    return;
  }

  beginSelectionDrag(event);
});

window.addEventListener('mousemove', (event) => {
  if (dragging && !isBusy) {
    updateDraggingSelection(event.clientX, event.clientY);
    return;
  }

  if (!recordingRegionMode) {
    schedulePickerUpdate(event.clientX, event.clientY);
  }

  updateRegionPlaybackPassthrough(event.clientX, event.clientY, event.target);
  updateScrollCapturePassthrough(event.clientX, event.clientY, event.target);

  if (moveToolbarDrag(event)) {
    hideMosaicCursor();
    return;
  }

  if (scrollCaptureMode) {
    hideMosaicCursor();
    return;
  }

  if (isToolbarTarget(event.target) || isOcrInteractiveTarget(event.target) || isAnnotateInputTarget(event.target)) {
    hideMosaicCursor();
  } else {
    updateMosaicCursor(event.clientX, event.clientY);
  }

  if (ocrPanelDragging && ocrPanelDragStart) {
    moveOcrResultPanel(
      ocrPanelDragStart.left + event.clientX - ocrPanelDragStart.x,
      ocrPanelDragStart.top + event.clientY - ocrPanelDragStart.y
    );
    return;
  }

  if (selectionResizeDragging && selectionResizeStart && selectionResizeSnapshot && selectionResizeHandleId) {
    currentRect = computeResizedScreenRect(
      selectionResizeSnapshot,
      selectionResizeHandleId,
      { x: event.clientX, y: event.clientY },
      selectionResizeStart
    );
    applyRect(currentRect, { maskOutside: true });
    if (toolbarWrap?.style.display !== 'none') {
      placeToolbar(currentRect);
    }
    return;
  }

  if (resizeDragging && selectedAnnotationIndex !== null && resizeStart && resizeSnapshot && resizeHandleId) {
    const shape = annotations[selectedAnnotationIndex];

    if (shape) {
      const point = toSelectionPoint(event.clientX, event.clientY);

      if (shape.type === 'rect' || shape.type === 'ellipse') {
        applyBoxResize(shape, resizeSnapshot, resizeHandleId, point, resizeStart);
      } else if (shape.type === 'arrow') {
        applyArrowResize(shape, resizeSnapshot, resizeHandleId, point, resizeStart);
      } else if (shape.type === 'text') {
        applyTextResize(shape, resizeSnapshot, resizeHandleId, point, resizeStart);
        syncToolbarFromSelectedShape();
      }

      renderAnnotations();
    }

    return;
  }

  if (moveDragging && selectedAnnotationIndex === null && moveStart && moveSnapshot) {
    currentRect = moveSelectionFromSnapshot(
      moveSnapshot,
      event.clientX - moveStart.x,
      event.clientY - moveStart.y
    );
    applyRect(currentRect, { maskOutside: true });
    if (toolbarWrap?.style.display !== 'none') {
      placeToolbar(currentRect);
    }
    return;
  }

  if (moveDragging && selectedAnnotationIndex !== null && moveStart && moveSnapshot) {
    const shape = annotations[selectedAnnotationIndex];

    if (shape) {
      const point = toSelectionPoint(event.clientX, event.clientY);
      const dx = point.x - moveStart.x;
      const dy = point.y - moveStart.y;
      moveShapeFromSnapshot(shape, moveSnapshot, dx, dy);
      renderAnnotations();
    }

    return;
  }

  if (paintDragging && activePaintStroke) {
    appendPaintPoint(activePaintStroke, toSelectionPoint(event.clientX, event.clientY));
    renderPaintLayer();
    return;
  }

  if (annotateDragging && previewShape && annotateStart) {
    const point = toSelectionPoint(event.clientX, event.clientY);

    if (previewShape.type === 'rect' || previewShape.type === 'ellipse') {
      const rect = normalizeRect(annotateStart.x, annotateStart.y, point.x, point.y);
      previewShape = createAnnotation(previewShape.type, rect);
    } else {
      previewShape = createAnnotation('arrow', {
        x1: annotateStart.x,
        x2: point.x,
        y1: annotateStart.y,
        y2: point.y
      });
    }

    renderAnnotations();
    return;
  }

  if (!dragging && !isBusy) {
    updateAnnotationHoverCursor(event.clientX, event.clientY);
  }
});

window.addEventListener('mouseleave', hideMosaicCursor);
window.addEventListener('blur', hideMosaicCursor);

window.addEventListener('mouseup', (event) => {
  endScrollCapturePointerPassthrough();

  if (event.button === 0 && endToolbarDrag()) {
    return;
  }

  if (ocrPanelDragging && event.button === 0) {
    ocrPanelDragging = false;
    ocrPanelDragStart = null;
    return;
  }

  if (selectionResizeDragging && event.button === 0) {
    selectionResizeDragging = false;
    selectionResizeHandleId = null;
    selectionResizeStart = null;
    selectionResizeSnapshot = null;
    updateAnnotationHoverCursor(event.clientX, event.clientY);
    return;
  }

  if (resizeDragging && event.button === 0) {
    resizeDragging = false;
    resizeHandleId = null;
    resizeStart = null;
    resizeSnapshot = null;
    updateAnnotationHoverCursor(event.clientX, event.clientY);
    return;
  }

  if (moveDragging && event.button === 0) {
    moveDragging = false;
    moveStart = null;
    moveSnapshot = null;
    updateAnnotationHoverCursor(event.clientX, event.clientY);
    return;
  }

  if (paintDragging && event.button === 0) {
    paintDragging = false;
    finalizePaintStroke();
    return;
  }

  if (annotateDragging && event.button === 0) {
    annotateDragging = false;

    if (previewShape && annotateStart) {
      const point = toSelectionPoint(event.clientX, event.clientY);
      const finalized = finalizePreviewShape(annotateStart, point, previewShape.type);

      if (finalized) {
        annotations.push(finalized);
        selectedAnnotationIndex = annotations.length - 1;
        syncToolbarFromSelectedShape();
      }
    }

    previewShape = null;
    annotateStart = null;
    renderAnnotations();
    return;
  }

  finishSelectionDrag(event);
});

window.addEventListener(
  'wheel',
  (event) => {
    if (!releaseScrollCaptureWheelToPage(event.clientX, event.clientY, event.target)) {
      return;
    }

    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener('pointerup', (event) => {
  if (!dragging) {
    return;
  }

  if (activeSelectionPointerId !== null && event.pointerId !== activeSelectionPointerId) {
    return;
  }

  finishSelectionDrag(event);

  if (activeSelectionPointerId !== null) {
    root.releasePointerCapture?.(event.pointerId);
    activeSelectionPointerId = null;
  }
});

window.addEventListener('pointercancel', (event) => {
  if (activeSelectionPointerId !== null && event.pointerId !== activeSelectionPointerId) {
    return;
  }

  if (activeSelectionPointerId !== null) {
    root.releasePointerCapture?.(event.pointerId);
    activeSelectionPointerId = null;
  }

  if (dragging) {
    finishSelectionDrag(event);
  }
});

textLayer.addEventListener('mousedown', (event) => {
  if ((ocrReady || translateReady) && activeTool !== 'text') {
    if (isOcrInteractiveTarget(event.target)) {
      event.stopPropagation();
      return;
    }

    exitOcrMode();
    return;
  }

  if (handleTextToolPointer(event)) {
    return;
  }

  if (activeTool === 'text' || (ocrReady && !activeTool)) {
    event.stopPropagation();
  }
});

ocrResultOpen?.addEventListener('mousedown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  showOcrResultPanel();
});

ocrResultOpen?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  showOcrResultPanel();
});

selectionEl?.addEventListener(
  'click',
  (event) => {
    if (event.target !== ocrResultOpen) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showOcrResultPanel();
  },
  true
);

ocrResultPanel?.addEventListener('mousedown', (event) => {
  event.stopPropagation();
});

ocrResultPanel?.addEventListener('click', (event) => {
  event.stopPropagation();
});

ocrResultPanel?.addEventListener('keydown', (event) => {
  event.stopPropagation();
});

ocrResultPanelHead?.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || !(ocrResultPanel instanceof HTMLElement)) {
    return;
  }

  if (event.target instanceof Element && event.target.closest('button')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  ocrPanelDragging = true;
  ocrPanelDragStart = {
    left: Number.parseFloat(ocrResultPanel.style.left || '8'),
    top: Number.parseFloat(ocrResultPanel.style.top || '8'),
    x: event.clientX,
    y: event.clientY
  };
});

ocrResultText?.addEventListener('input', () => {
  if (ocrResultText instanceof HTMLTextAreaElement) {
    lastOcrText = ocrResultText.value;
    resizeOcrResultPanelToContent();
    placeOcrResultPanelNearSelection();
  }
});

ocrResultCopy?.addEventListener('click', (event) => {
  event.stopPropagation();

  if (!(ocrResultText instanceof HTMLTextAreaElement)) {
    return;
  }

  const text = ocrResultText.value.trim();

  if (!text) {
    return;
  }

  lastOcrText = text;
  void window.screenshotOverlay?.copyText(text);
  setOcrStatus(translateReady ? '已复制译文' : '已复制文字');
});

ocrResultClose?.addEventListener('click', (event) => {
  event.stopPropagation();
  hideOcrResultPanel();
});

if (annotateLayer instanceof SVGSVGElement) {
  annotateLayer.addEventListener('mousedown', (event) => {
    handleTextToolPointer(event);
  });
}

toolbarWrap?.addEventListener('mouseenter', () => {
  if (scrollCaptureMode) {
    setMousePassthrough(false, false);
  }
});

toolbarWrap?.addEventListener('mousedown', (event) => {
  if (scrollCaptureMode) {
    setMousePassthrough(false, false);
  }

  beginToolbarDrag(event);
  event.stopPropagation();
});

toolbarWrap?.addEventListener('click', (event) => {
  if (scrollCaptureMode) {
    setMousePassthrough(false, false);
  }

  event.stopPropagation();

  const lineStyleOption = event.target.closest('.annotate-line-style-option[data-line-style]');

  if (lineStyleOption instanceof HTMLButtonElement && lineStyleOption.dataset.lineStyle) {
    setLineStyle(lineStyleOption.dataset.lineStyle);
    closeLineStyleMenu();
    return;
  }

  if (event.target instanceof Element && event.target.closest('.annotate-line-style-trigger')) {
    toggleLineStyleMenu();
    return;
  }

  if (event.target instanceof Element && event.target.closest('.annotate-tertiary, .annotate-stroke-trigger, .annotate-brush-trigger, .annotate-line-style-picker')) {
    return;
  }

  const colorButton = event.target.closest('button[data-color]');

  if (colorButton instanceof HTMLButtonElement && colorButton.dataset.color) {
    annotateSettings.color = colorButton.dataset.color;
    updateToolUI();
    return;
  }

  const toolButton = event.target.closest('button[data-tool]');

  if (toolButton instanceof HTMLButtonElement && toolButton.dataset.tool) {
    void window.screenshotOverlay?.debugLog?.(
      'screenshot-toolbar',
      `tool click tool=${toolButton.dataset.tool} rect=${currentRect ? `${Math.round(currentRect.width)}x${Math.round(currentRect.height)}` : 'none'}`
    );
    setActiveTool(toolButton.dataset.tool);
    return;
  }

  const button = event.target.closest('button[data-action]');

  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const action = button.dataset.action;
  void window.screenshotOverlay?.debugLog?.(
    'screenshot-toolbar',
    `action click action=${action || ''} rect=${currentRect ? `${Math.round(currentRect.width)}x${Math.round(currentRect.height)}` : 'none'} busy=${isBusy} scroll=${scrollCaptureMode} recording=${recordingRegionMode} ocr=${ocrReady} translate=${translateReady}`
  );

  if (action === 'drag-toolbar') {
    return;
  }

  clearActiveTool();

  if (action === 'close') {
    exitScreenshot();
    return;
  }

  if (action === 'ocr') {
    if (ocrReady && lastOcrText && ocrResultPanel instanceof HTMLElement && ocrResultPanel.hidden) {
      showOcrResultPanel();
      return;
    }

    if (ocrReady || translateReady) {
      exitOcrMode();
      return;
    }

    void scheduleOcr();
    return;
  }

  if (action === 'translate') {
    void scheduleTranslate();
    return;
  }

  if (action === 'scroll-capture') {
    if (!currentRect || isBusy) {
      return;
    }

    if (scrollCaptureMode) {
      exitScrollCaptureMode();
      setOcrStatus('');
      return;
    }

    enterScrollCaptureMode();
    const scrollPromise = window.screenshotOverlay?.startScrollCapture(toScreenRect(currentRect));
    if (scrollPromise && typeof scrollPromise.catch === 'function') {
      void scrollPromise
        .then((result) => {
          if (result && result.ok === false) {
            exitScrollCaptureMode();
          }
        })
        .catch(() => {
          exitScrollCaptureMode();
        });
    }
    return;
  }

  if (ocrReady || translateReady) {
    exitOcrMode();
  }

  if (action === 'done') {
    void runAction('copy');
    return;
  }

  if (action === 'undo') {
    if (!button.disabled) {
      undoLastShape();
    }

    return;
  }

  if (action === 'download') {
    void runAction('save');
    return;
  }

  if (action === 'pin') {
    void runAction('pin');
    return;
  }

  if (action === 'record') {
    if (!currentRect) {
      return;
    }

    enterRecordingRegionMode();
    const recordPromise = window.screenshotOverlay?.startRecordingRegion(toScreenRect(currentRect));
    if (recordPromise && typeof recordPromise.catch === 'function') {
      void recordPromise.catch(() => {
        setOcrStatus('录屏启动失败');
      });
    }
    return;
  }
});

window.addEventListener('keydown', (event) => {
  if (
    event.code === 'KeyC' &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !pendingTextInput &&
    !isTextEditingEventTarget(event.target) &&
    lastPickerReady &&
    lastPickerHex &&
    (!hasActiveScreenshotSelection() || (!ocrReady && !translateReady))
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void copyPickerColor();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyZ' && !pendingTextInput) {
    if (!isTextEditingEventTarget(event.target) && findLastUndoableShapeIndex() !== null) {
      event.preventDefault();
      undoLastShape();
      updateAnnotationHoverCursor(event.clientX, event.clientY);
      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC' && getSelectedOcrText()) {
    event.preventDefault();
    copySelectedText();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();

    if (scrollCaptureMode) {
      exitScrollCaptureMode();
      setOcrStatus('');
      return;
    }

    if (dismissScreenshotSubState()) {
      return;
    }

    if (hasActiveScreenshotSelection()) {
      resetLocalSelection();
      return;
    }

    exitScreenshot();
    return;
  }

  if (
    (event.key === 'Delete' || event.key === 'Backspace') &&
    !pendingTextInput &&
    !isTextEditingEventTarget(event.target)
  ) {
    if (selectedAnnotationIndex !== null && getSelectedAnnotation()) {
      event.preventDefault();
      deleteSelectedAnnotation();
      updateAnnotationHoverCursor(event.clientX, event.clientY);
      return;
    }
  }

  if (event.key === 'Enter' && !pendingTextInput) {
    event.preventDefault();
    void runAction('copy');
    return;
  }

  // 已移除 Ctrl+C 复制文字功能，改为右键菜单复制
});

document.addEventListener(
  'keydown',
  (event) => {
    if (event.code !== 'KeyC' || event.metaKey || event.altKey || event.shiftKey || event.isComposing) {
      return;
    }

    if (
      pendingTextInput ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (!lastPickerReady || !lastPickerHex) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void copyPickerColor();
  },
  true
);

document.addEventListener('copy', (event) => {
  if (!ocrReady) {
    return;
  }

  const selected = getSelectedOcrText();

  if (!selected) {
    return;
  }

  event.preventDefault();
  event.clipboardData?.setData('text/plain', selected);
  void window.screenshotOverlay?.copyText(selected);
  setOcrStatus(translateReady ? '已复制译文' : '已复制文字');
});

const ocrButton = document.querySelector('[data-action="ocr"]');
const translateButton = document.querySelector('[data-action="translate"]');
const scrollCaptureButton = document.querySelector('[data-action="scroll-capture"]');

function updateScrollCaptureToolbarUI() {
  if (scrollCaptureButton instanceof HTMLButtonElement) {
    scrollCaptureButton.classList.toggle('active', scrollCaptureMode);
    scrollCaptureButton.setAttribute('aria-pressed', scrollCaptureMode ? 'true' : 'false');
  }
}

function updateFeatureToolbarButtons() {
  if (ocrButton instanceof HTMLElement) {
    ocrButton.style.display = ocrEnabled ? '' : 'none';
  }

  if (translateButton instanceof HTMLElement) {
    translateButton.style.display = !ocrEnabled || !translateEnabled ? 'none' : '';
  }

  updateScrollCaptureToolbarUI();
}

function resetOverlaySession(config) {
  const resetStartedAt = window.performance?.now?.() ?? Date.now();
  setOverlayPending(true);
  pendingShortcutStartConfig = null;

  if (config) {
    offsetX = Number(config.offsetX ?? 0);
    offsetY = Number(config.offsetY ?? 0);
    screenScale = Number(config.scale ?? window.devicePixelRatio ?? 1) || 1;
    ocrEnabled = config.ocrEnabled !== false;
    translateEnabled = config.translateEnabled !== false;
    updateFeatureToolbarButtons();
  }

  isBusy = false;
  exitScrollCaptureMode();
  exitRegionRecordingPlaybackMode();
  exitRecordingRegionMode();
  resetPointerInteractionState();
  if (root) {
    root.style.pointerEvents = '';
  }
  detachSelectionDragMoveListeners();
  dragging = false;
  selectionDragLogged = false;
  annotateDragging = false;
  paintDragging = false;
  moveDragging = false;
  resizeDragging = false;
  selectionResizeDragging = false;
  selectionResizeHandleId = null;
  selectionResizeStart = null;
  selectionResizeSnapshot = null;
  toolbarDragging = false;
  toolbarDragStart = null;
  toolbarManualPosition = null;
  blockToolbarToolActivation = false;
  pickerSuppressedAfterSelectionStart = false;
  ocrGeneration += 1;
  currentRect = null;
  previewShape = null;
  activePaintStroke = null;
  clearOcrLayer();
  clearAnnotations();
  resetActiveTool();
  clearPickerState();

  if (toolbarWrap) {
    toolbarWrap.style.display = 'none';
  }

  applyRect({ height: 0, width: 0, x: 0, y: 0 }, { restoreScreenBorder: false });
  setOverlayPending(false);
  setScreenBorderVisible(true);
  updateFullScreenSizeLabel();
  scheduleDeferredPickerWarmup(colorSamplerSessionId);
  const resetDurationMs = Math.round((window.performance?.now?.() ?? Date.now()) - resetStartedAt);
  if (resetDurationMs > 50) {
    void window.screenshotOverlay?.debugLog?.('screenshot-ui', `session reset slow duration_ms=${resetDurationMs}`);
  }
  window.screenshotOverlay?.notifySessionReady?.();
}

function setOverlayPending(pending) {
  if (!root) {
    return;
  }

  root.classList.toggle('overlay-pending', pending);
}

function endOverlaySession() {
  exitScrollCaptureMode();
  exitRegionRecordingPlaybackMode();
  exitRecordingRegionMode();
  resetPointerInteractionState();
  setScreenBorderVisible(false);
  setOverlayPending(true);

  cancelPickerSampling();
  
  // 清理选区状态，避免下次启动时闪现
  currentRect = null;
  detachSelectionDragMoveListeners();
  dragging = false;
  selectionDragLogged = false;
  annotateDragging = false;
  paintDragging = false;
  moveDragging = false;
  resizeDragging = false;
  selectionResizeDragging = false;
  selectionResizeHandleId = null;
  selectionResizeStart = null;
  selectionResizeSnapshot = null;
  pickerSuppressedAfterSelectionStart = false;
  previewShape = null;
  activePaintStroke = null;
  clearOcrLayer();
  clearAnnotations();
  applyRect({ height: 0, width: 0, x: 0, y: 0 });
}

function revealScreenBorder() {
  setOverlayPending(false);
  setScreenBorderVisible(true);
  updateFullScreenSizeLabel();
  // 通知主进程边框已准备好
  window.screenshotOverlay?.notifyBorderReady?.();
}

updateFeatureToolbarButtons();
void window.screenshotOverlay?.debugLog?.(
  'screenshot-ui',
  `script loaded picker=${isPickerEnabled()}`
);
if (!isPickerEnabled() && pickerInfo instanceof HTMLElement) {
  pickerInfo.hidden = true;
}
window.tauriScreenshotOverlayHandleShortcutStart = requestShortcutOverlayStart;
window.screenshotOverlay?.onSessionStart?.((config) => {
  resetOverlaySession(config);
});
window.screenshotOverlay?.onSessionEnd?.(() => {
  endOverlaySession();
  window.screenshotOverlay?.notifySessionEndReady?.();
});
window.screenshotOverlay?.onSessionVisible?.(() => {
  if (scrollCaptureMode) {
    setOverlayPending(false);
    setScreenBorderVisible(false);
    return;
  }

  revealScreenBorder();
  showPickerAtCurrentCursor();
});
window.screenshotOverlay?.onHideForRecording?.(() => {
  exitRecordingRegionMode();
  suppressOverlayVisualsDuringRecording();
  hideSelectionMask();
  selectionEl.style.display = 'none';
});
window.screenshotOverlay?.onEnterRecordingRegion?.(() => {
  enterRecordingRegionMode();
});
window.screenshotOverlay?.onRegionRecordingPlayback?.((payload) => {
  enterRegionRecordingPlaybackMode(payload);
});
window.screenshotOverlay?.onExitRegionRecordingPlayback?.(() => {
  exitRegionRecordingPlaybackMode();
});

if (recordingPlaybackEl instanceof HTMLElement) {
  recordingPlaybackEl.addEventListener('pointerenter', focusRegionPlaybackInteraction);
  recordingPlaybackEl.addEventListener('pointerdown', focusRegionPlaybackInteraction);
  recordingPlaybackEl.addEventListener('mousedown', focusRegionPlaybackInteraction);
}

if (recordingPlaybackToggle instanceof HTMLButtonElement) {
  recordingPlaybackToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleRegionPlayback();
  });
}

if (recordingPlaybackSeek instanceof HTMLInputElement) {
  recordingPlaybackSeek.addEventListener('pointerdown', () => {
    focusRegionPlaybackInteraction();
    regionPlaybackSeekDragging = true;

    if (recordingPlaybackVideo instanceof HTMLVideoElement) {
      regionPlaybackWasPlayingBeforeSeek =
        !recordingPlaybackVideo.paused && !recordingPlaybackVideo.ended;
      recordingPlaybackVideo.pause();
      updateRegionPlaybackPlayButton();
    }
  });
  recordingPlaybackSeek.addEventListener('input', () => {
    if (!(recordingPlaybackVideo instanceof HTMLVideoElement)) {
      return;
    }

    const duration = getRegionPlaybackDuration(recordingPlaybackVideo);

    if (duration <= 0) {
      return;
    }

    recordingPlaybackVideo.currentTime = (Number(recordingPlaybackSeek.value) / 1000) * duration;
    updateRegionPlaybackTimeLabel();
  });
}

window.addEventListener('pointerup', () => {
  if (!regionPlaybackSeekDragging) {
    return;
  }

  regionPlaybackSeekDragging = false;

  if (
    recordingPlaybackVideo instanceof HTMLVideoElement &&
    regionPlaybackWasPlayingBeforeSeek &&
    !recordingPlaybackVideo.ended
  ) {
    void recordingPlaybackVideo.play().catch(() => {});
  }

  regionPlaybackWasPlayingBeforeSeek = false;
  updateRegionPlaybackPlayButton();
});

if (recordingPlaybackVideo instanceof HTMLVideoElement) {
  recordingPlaybackVideo.addEventListener('durationchange', updateRegionPlaybackSeekFromVideo);
  recordingPlaybackVideo.addEventListener('progress', updateRegionPlaybackSeekFromVideo);
  recordingPlaybackVideo.addEventListener('timeupdate', updateRegionPlaybackSeekFromVideo);
  recordingPlaybackVideo.addEventListener('play', () => {
    updateRegionPlaybackPlayButton();
    startRegionPlaybackProgressLoop();
  });
  recordingPlaybackVideo.addEventListener('pause', () => {
    updateRegionPlaybackPlayButton();
  });
  recordingPlaybackVideo.addEventListener('ended', () => {
    stopRegionPlaybackProgressLoop();
    updateRegionPlaybackSeekFromVideo();
  });
}

window.addEventListener('mouseleave', () => {
  hidePickerInfo();
});

setSubOptionsVisible(false);
updateStrokeSizeUI();
updateBrushSizeUI();
updateTextSizeUI();
updateLineStyleUI();
updateUndoButtonState();

function bindTertiaryPanel(trigger, tertiary, openClass) {
  if (!(trigger instanceof HTMLElement) || !(tertiary instanceof HTMLElement) || !annotateOptionsWrap) {
    return;
  }

  const open = () => {
    closeLineStyleMenu();
    closeTertiaryPanels();
    annotateOptionsWrap.classList.add(openClass);
  };

  trigger.addEventListener('mouseenter', open);
  tertiary.addEventListener('mouseenter', open);
  trigger.addEventListener('focusin', open);
  tertiary.addEventListener('focusin', open);

  for (const element of [trigger, tertiary]) {
    element.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
  }
}

if (annotateOptionsWrap instanceof HTMLElement) {
  annotateOptionsWrap.addEventListener('mouseleave', (event) => {
    if (!annotateOptionsWrap.contains(event.relatedTarget)) {
      closeAllOptionPanels();
    }
  });
}

bindTertiaryPanel(strokeTrigger, strokeTertiary, 'tertiary--stroke-open');
bindTertiaryPanel(brushTrigger, brushTertiary, 'tertiary--brush-open');

if (lineStylePicker instanceof HTMLElement) {
  lineStylePicker.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
}

window.addEventListener('mousedown', (event) => {
  if (!lineStylePicker?.classList.contains('open')) {
    return;
  }

  if (event.target instanceof Element && lineStylePicker.contains(event.target)) {
    return;
  }

  closeLineStyleMenu();
});

if (strokeSlider instanceof HTMLInputElement) {
  strokeSlider.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    annotateSettings.strokeWidth = clampStrokeWidth(event.target.value);
    updateStrokeSizeUI();
    applySettingsToSelectedAnnotation();
  });
}

if (brushSlider instanceof HTMLInputElement) {
  brushSlider.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    annotateSettings.brushSize = clampBrushSize(event.target.value);
    if (activePaintStroke?.type === 'brush') {
      activePaintStroke.strokeWidth = annotateSettings.brushSize;
      renderPaintLayer();
    } else if (activePaintStroke?.type === 'mosaic') {
      activePaintStroke.brushSize = annotateSettings.brushSize;
      renderPaintLayer();
    }
    updateBrushSizeUI();
  });
}

if (textSizeSlider instanceof HTMLInputElement) {
  textSizeSlider.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    annotateSettings.fontSize = clampTextFontSize(event.target.value);
    updateTextSizeUI();
    applySettingsToSelectedAnnotation();
  });
}
