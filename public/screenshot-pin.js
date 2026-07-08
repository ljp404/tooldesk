/* eslint-env browser */
const pinImage = document.getElementById('pin-image');
const pinHit = document.getElementById('pin-hit');
const pinFrame = document.getElementById('pin-frame');
const pinZoomLabel = document.getElementById('pin-zoom-label');

const GLOW_PADDING = 14;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

let capturePayload = null;
let pinReadySent = false;
let isDragging = false;
let isHovering = false;
let isPinSelected = false;
let isPinFocused = false;
let zoom = 1;
let baseWidth = 0;
let baseHeight = 0;
let zoomLabelTimer = null;
let dragPointer = null;
let dragMoveFrame = 0;
let dragMoveInFlight = false;
let pendingDragDelta = { dx: 0, dy: 0 };
let lastWheelHandledAt = 0;
let wheelEnabledAt = 0;
const ZOOM_LABEL_HIDE_MS = 2000;
const WHEEL_DEDUPE_MS = 40;
const WHEEL_ENABLE_DELAY_MS = 300;

function schedulePinMove() {
  if (dragMoveFrame || dragMoveInFlight) {
    return;
  }

  dragMoveFrame = window.requestAnimationFrame(() => {
    dragMoveFrame = 0;

    const dx = pendingDragDelta.dx;
    const dy = pendingDragDelta.dy;
    pendingDragDelta = { dx: 0, dy: 0 };

    if (dx === 0 && dy === 0) {
      return;
    }

    dragMoveInFlight = true;
    const movePromise = window.screenshotPin?.moveBy({ dx, dy }) ?? Promise.resolve();

    void movePromise.finally(() => {
      dragMoveInFlight = false;

      if (pendingDragDelta.dx !== 0 || pendingDragDelta.dy !== 0) {
        schedulePinMove();
      }
    });
  });
}

function resetPendingPinMove() {
  pendingDragDelta = { dx: 0, dy: 0 };

  if (dragMoveFrame) {
    window.cancelAnimationFrame(dragMoveFrame);
    dragMoveFrame = 0;
  }
}

function updatePinFocusState() {
  if (!(pinHit instanceof HTMLElement)) {
    return;
  }

  pinHit.classList.toggle('is-pin-focused', isPinFocused);
}

function updatePinHighlight() {
  if (!(pinHit instanceof HTMLElement)) {
    return;
  }

  const highlighted = isHovering;

  pinHit.classList.toggle('is-highlighted', highlighted);
  pinHit.classList.toggle('is-dragging', isDragging);
}

function setPinFocused(focused) {
  if (isPinFocused === focused) {
    return;
  }

  isPinFocused = focused;
  updatePinFocusState();
}

function selectPin() {
  isPinSelected = true;
  setPinFocused(true);
  void window.screenshotPin?.focus();
}

function focusPinForInput() {
  void window.screenshotPin?.focus();
}

function getBaseContentSize(payload) {
  const naturalWidth = Math.max(1, Number(payload.width) || 1);
  const naturalHeight = Math.max(1, Number(payload.height) || 1);

  return {
    height: Math.round(naturalHeight),
    width: Math.round(naturalWidth)
  };
}

function updateZoomLabelText() {
  if (pinZoomLabel) {
    pinZoomLabel.textContent = `缩放：${Math.round(zoom * 100)}%`;
  }
}

function hideZoomLabel() {
  if (zoomLabelTimer) {
    clearTimeout(zoomLabelTimer);
    zoomLabelTimer = null;
  }

  pinZoomLabel?.classList.remove('is-visible');
}

function showZoomLabelTemporary() {
  if (!(pinZoomLabel instanceof HTMLElement)) {
    return;
  }

  updateZoomLabelText();
  pinZoomLabel.classList.add('is-visible');

  if (zoomLabelTimer) {
    clearTimeout(zoomLabelTimer);
  }

  zoomLabelTimer = setTimeout(() => {
    pinZoomLabel?.classList.remove('is-visible');
    zoomLabelTimer = null;
  }, ZOOM_LABEL_HIDE_MS);
}

function applyZoom() {
  if (!baseWidth || !baseHeight) {
    return;
  }

  const contentWidth = Math.max(1, Math.round(baseWidth * zoom));
  const contentHeight = Math.max(1, Math.round(baseHeight * zoom));
  const windowWidth = contentWidth + GLOW_PADDING * 2;
  const windowHeight = contentHeight + GLOW_PADDING * 2;

  if (pinFrame instanceof HTMLElement) {
    pinFrame.style.flex = 'none';
    pinFrame.style.width = `${contentWidth}px`;
    pinFrame.style.height = `${contentHeight}px`;
  }

  if (pinHit instanceof HTMLElement) {
    pinHit.style.flex = 'none';
    pinHit.style.height = `${windowHeight}px`;
  }

  void window.screenshotPin?.resize({
    height: windowHeight,
    minHeight: Math.round(baseHeight * MIN_ZOOM) + GLOW_PADDING * 2,
    minWidth: Math.round(baseWidth * MIN_ZOOM) + GLOW_PADDING * 2,
    width: windowWidth
  });
}

function resetZoom(payload) {
  const base = getBaseContentSize(payload);

  zoom = 1;
  baseWidth = base.width;
  baseHeight = base.height;
  updateZoomLabelText();
  hideZoomLabel();

  if (pinFrame instanceof HTMLElement) {
    pinFrame.style.flex = 'none';
    pinFrame.style.width = `${baseWidth}px`;
    pinFrame.style.height = `${baseHeight}px`;
  }

  if (pinHit instanceof HTMLElement) {
    pinHit.style.flex = 'none';
    pinHit.style.height = `${baseHeight + GLOW_PADDING * 2}px`;
  }
}

function applyLayout(payload) {
  const imageWrap = document.querySelector('.pin-image-wrap');

  if (!(imageWrap instanceof HTMLElement)) {
    return;
  }

  imageWrap.style.width = `${baseWidth + GLOW_PADDING * 2}px`;
  imageWrap.style.height = `${baseHeight + GLOW_PADDING * 2}px`;
  imageWrap.style.flex = 'none';
  imageWrap.style.padding = `${GLOW_PADDING}px`;
}

document.addEventListener('selectstart', (event) => {
  event.preventDefault();
});

document.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

pinHit?.addEventListener('mouseenter', () => {
  isHovering = true;
  focusPinForInput();
  updatePinHighlight();
});

pinHit?.addEventListener('mouseleave', () => {
  isHovering = false;
  updatePinHighlight();
});

pinHit?.addEventListener('mousedown', (event) => {
  selectPin();

  if (event.button === 0) {
    isDragging = true;
    dragPointer = { screenX: event.screenX, screenY: event.screenY };
    updatePinHighlight();
  }
});

window.addEventListener('mousemove', (event) => {
  if (!dragPointer) {
    return;
  }

  const dx = event.screenX - dragPointer.screenX;
  const dy = event.screenY - dragPointer.screenY;

  if (dx === 0 && dy === 0) {
    return;
  }

  dragPointer = { screenX: event.screenX, screenY: event.screenY };
  pendingDragDelta = {
    dx: pendingDragDelta.dx + dx,
    dy: pendingDragDelta.dy + dy
  };
  schedulePinMove();
});

window.addEventListener('mouseup', () => {
  dragPointer = null;

  if (!isDragging) {
    return;
  }

  isDragging = false;
  resetPendingPinMove();
  updatePinHighlight();
});

function handlePinWheel(deltaY) {
  if (!capturePayload || !baseWidth || !baseHeight || deltaY === 0) {
    return;
  }

  const now = Date.now();

  if (now < wheelEnabledAt || now - lastWheelHandledAt < WHEEL_DEDUPE_MS) {
    return;
  }

  lastWheelHandledAt = now;

  const direction = deltaY < 0 ? 1 : -1;
  const nextZoom = Math.round((zoom + direction * ZOOM_STEP) * 100) / 100;
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));

  if (clamped === zoom) {
    showZoomLabelTemporary();
    return;
  }

  zoom = clamped;
  applyZoom();
  showZoomLabelTemporary();
}

window.screenshotPin?.onWheel((payload) => {
  handlePinWheel(payload.deltaY);
});

document.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    handlePinWheel(event.deltaY);
  },
  { capture: true, passive: false }
);

pinHit?.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  selectPin();
  isHovering = true;
  updatePinHighlight();
  const menuPayload = {
    ...capturePayload,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY
  };
  const menuPromise = window.screenshotPin?.showMenu(menuPayload);

  void menuPromise
    ?.then((handled) => {
      if (!handled) {
        console.warn('[tooldesk screenshot pin] context menu was not created');
      }
    })
    .catch((error) => {
      console.warn('[tooldesk screenshot pin] show context menu failed', error);
    });
});

window.screenshotPin?.onFocusChange((focused) => {
  if (!focused) {
    isPinSelected = false;
    setPinFocused(false);
    return;
  }

  setPinFocused(isPinSelected);
});

setPinFocused(false);
isPinSelected = false;

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  }
});

function notifyPinReady() {
  if (pinReadySent) {
    return;
  }

  pinReadySent = true;
  void window.screenshotPin?.ready();
}

function setPinImage(payload) {
  pinReadySent = false;
  wheelEnabledAt = Date.now() + WHEEL_ENABLE_DELAY_MS;
  capturePayload = payload;
  isPinSelected = true;
  setPinFocused(true);
  resetZoom(payload);
  pinImage.alt = `贴图 ${payload.width}×${payload.height}`;
  applyLayout(payload);

  pinImage.onload = () => {
    notifyPinReady();
  };

  pinImage.src = payload.dataUrl;

  if (pinImage.complete) {
    notifyPinReady();
  }
}

window.screenshotPin?.onImage((payload) => {
  setPinImage(payload);
});
