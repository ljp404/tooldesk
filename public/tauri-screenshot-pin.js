/* eslint-env browser */
const frame = document.getElementById('pin-frame');
const image = document.getElementById('pin-image');
const searchParams = new URLSearchParams(window.location.search);
const pinLabel = searchParams.get('label') || '';

let dragging = false;
let lastPointer = { x: 0, y: 0 };

function renderPinnedScreenshot(payload) {
  if (image instanceof HTMLImageElement) {
    image.src = payload?.dataUrl || '';
  }
}

window.tauriScreenshotPinReady = renderPinnedScreenshot;
window.tauriScreenshotPinLabel = pinLabel || window.tauriScreenshotPinLabel || '';

if (window.tauriScreenshotPinPendingPayload) {
  renderPinnedScreenshot(window.tauriScreenshotPinPendingPayload);
}

if (pinLabel) {
  void window.__TAURI__?.core
    ?.invoke('get_pin_screenshot_payload', { label: pinLabel })
    .then((payload) => {
      if (payload) {
        renderPinnedScreenshot(payload);
      }
    });
}

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  dragging = true;
  lastPointer = { x: event.screenX, y: event.screenY };
  document.body.setPointerCapture?.(event.pointerId);
});

window.addEventListener('pointermove', (event) => {
  if (!dragging) {
    return;
  }

  const dx = Math.round(event.screenX - lastPointer.x);
  const dy = Math.round(event.screenY - lastPointer.y);
  lastPointer = { x: event.screenX, y: event.screenY };

  if (dx !== 0 || dy !== 0) {
    void window.__TAURI__?.core?.invoke('move_pin_screenshot_window', {
      dx,
      dy,
      label: window.tauriScreenshotPinLabel || ''
    });
  }
});

window.addEventListener('pointerup', (event) => {
  dragging = false;
  document.body.releasePointerCapture?.(event.pointerId);
});

window.addEventListener('dblclick', () => {
  void window.__TAURI__?.window?.getCurrentWindow?.().close();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    void window.__TAURI__?.window?.getCurrentWindow?.().close();
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  void window.__TAURI__?.window?.getCurrentWindow?.().close();
});

window.addEventListener('blur', () => {
  frame?.classList.add('is-inactive');
});

window.addEventListener('focus', () => {
  frame?.classList.remove('is-inactive');
});
