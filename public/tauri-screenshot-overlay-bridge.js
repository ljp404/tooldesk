/* eslint-env browser */
(function () {
  const core = window.__TAURI__?.core;
  const tauriWindow = window.__TAURI__?.window;
  const eventApi = window.__TAURI__?.event;
  const searchParams = new URLSearchParams(window.location.search);

  const sessionStartListeners = new Set();
  const sessionEndListeners = new Set();
  const sessionVisibleListeners = new Set();
  const hideForRecordingListeners = new Set();
  const enterRecordingRegionListeners = new Set();
  const regionRecordingPlaybackListeners = new Set();
  const exitRegionRecordingPlaybackListeners = new Set();
  let sessionVisible = false;

  const initialLabel = searchParams.get('label') || '';

  const initialConfig = {
    mode: searchParams.get('mode') || null,
    ocrEnabled: searchParams.get('ocrEnabled') !== '0',
    offsetX: Number(searchParams.get('offsetX') ?? 0),
    offsetY: Number(searchParams.get('offsetY') ?? 0),
    translateEnabled: searchParams.get('translateEnabled') !== '0',
    warm: searchParams.get('warm') === '1'
  };

  if (initialLabel) {
    window.tauriScreenshotOverlayLabel = initialLabel;
  }

  const pendingInitialConfig =
    window.tauriScreenshotOverlayPendingStartConfig && typeof window.tauriScreenshotOverlayPendingStartConfig === 'object'
      ? window.tauriScreenshotOverlayPendingStartConfig
      : null;

  window.tauriScreenshotOverlayConfig = pendingInitialConfig || initialConfig;

  function invoke(command, payload) {
    if (!core?.invoke) {
      return Promise.reject(new Error('Tauri API 不可用'));
    }

    return core.invoke(command, payload);
  }

  function debugLog(area, message) {
    return invoke('log_screenshot_debug', {
      area: String(area ?? ''),
      message: String(message ?? '')
    }).catch((error) => {
      console.warn('[tooldesk screenshot debug]', error);
      return false;
    });
  }

  function currentLabel() {
    return window.tauriScreenshotOverlayLabel || '';
  }

  function normalizeDataUrl(dataUrl) {
    return String(dataUrl || '');
  }

  function pngBufferToDataUrl(png) {
    if (!png) {
      return '';
    }

    let bytes;
    if (png instanceof Uint8Array) {
      bytes = png;
    } else if (Array.isArray(png)) {
      bytes = new Uint8Array(png);
    } else if (png instanceof ArrayBuffer) {
      bytes = new Uint8Array(png);
    } else {
      return '';
    }

    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return `data:image/png;base64,${window.btoa(binary)}`;
  }

  function normalizeOcrResult(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const text = String(result.text ?? result.rawText ?? '').trim();
    const lines = Array.isArray(result.lines) ? result.lines : text.split(/\r?\n/).filter(Boolean);

    return {
      ...result,
      imageHeight: Number(result.imageHeight ?? result.image_height ?? 0),
      imageWidth: Number(result.imageWidth ?? result.image_width ?? 0),
      lines,
      rawText: text,
      text,
      words: Array.isArray(result.words) ? result.words : []
    };
  }

  function subscribe(listeners, callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function emit(listeners, payload) {
    for (const listener of listeners) {
      listener(payload);
    }
  }

  function closeOverlay() {
    return invoke('cancel_screenshot_selection', { label: currentLabel() });
  }

  async function finishOverlay(rect, action, dataUrl) {
    return invoke('finish_screenshot_overlay_image', {
      action,
      dataUrl: normalizeDataUrl(dataUrl),
      label: currentLabel(),
      rect
    });
  }

  window.screenshotOverlay = {
    cancel: closeOverlay,
    captureRegion(rect) {
      return invoke('capture_screenshot_selection_frame', { rect });
    },
    confirmWithImage(rect, action, dataUrl) {
      return finishOverlay(rect, action, dataUrl);
    },
    confirmWithPng(rect, action, image) {
      return finishOverlay(rect, action, pngBufferToDataUrl(image?.png));
    },
    copyText(text) {
      return invoke('copy_screenshot_text', { text: String(text ?? '') });
    },
    debugLog(area, message) {
      return debugLog(area, message);
    },
    getColorFrames() {
      return invoke('get_screenshot_color_frames');
    },
    getCursorPosition() {
      return invoke('get_screenshot_cursor_position');
    },
    getMagnifierFrame(options) {
      return invoke('capture_screenshot_magnifier_frame', {
        options: {
          sampleSize: Math.round(Number(options?.sampleSize ?? 25)),
          x: Math.round(Number(options?.x ?? 0)),
          y: Math.round(Number(options?.y ?? 0))
        }
      });
    },
    getPickerSnapshot(options) {
      return invoke('get_screenshot_picker_snapshot', {
        sampleSize: Math.round(Number(options?.sampleSize ?? 25))
      });
    },
    sampleColor(screenPoint) {
      return invoke('sample_screenshot_color', {
        x: Math.round(Number(screenPoint?.x ?? 0)),
        y: Math.round(Number(screenPoint?.y ?? 0))
      });
    },
    notifyBorderReady() {
      return Promise.resolve(true);
    },
    notifySessionReady() {
      const reveal = () => {
        sessionVisible = true;
        emit(sessionVisibleListeners);
      };

      const label = currentLabel();

      if (label) {
        void invoke('show_screenshot_overlay', { label }).finally(reveal);
        return Promise.resolve(true);
      }

      window.setTimeout(reveal, 0);
      return Promise.resolve(true);
    },
    notifySessionEndReady() {
      return Promise.resolve(true);
    },
    onEnterRecordingRegion(callback) {
      return subscribe(enterRecordingRegionListeners, callback);
    },
    onExitRegionRecordingPlayback(callback) {
      return subscribe(exitRegionRecordingPlaybackListeners, callback);
    },
    onHideForRecording(callback) {
      return subscribe(hideForRecordingListeners, callback);
    },
    onRegionRecordingPlayback(callback) {
      return subscribe(regionRecordingPlaybackListeners, callback);
    },
    onSessionEnd(callback) {
      return subscribe(sessionEndListeners, callback);
    },
    onSessionStart(callback) {
      const unsubscribe = subscribe(sessionStartListeners, callback);
      if (window.tauriScreenshotOverlayConfig && !window.tauriScreenshotOverlayConfig.warm) {
        window.setTimeout(() => callback(window.tauriScreenshotOverlayConfig), 0);
      }
      return unsubscribe;
    },
    onSessionVisible(callback) {
      const unsubscribe = subscribe(sessionVisibleListeners, callback);
      if (sessionVisible) {
        window.setTimeout(callback, 0);
      }
      return unsubscribe;
    },
    async recognize(rect, options) {
      return normalizeOcrResult(await invoke('recognize_screenshot_overlay_region', { options: options ?? {}, rect }));
    },
    scrollTarget(delta, point) {
      return invoke('scroll_screenshot_overlay_target', {
        delta,
        x: point?.x,
        y: point?.y
      });
    },
    setMousePassthrough(enabled, forward) {
      const current = tauriWindow?.getCurrentWindow?.();
      return current?.setIgnoreCursorEvents?.(Boolean(enabled), { forward: forward !== false }) ?? Promise.resolve();
    },
    refreshWindowChrome() {
      const label = currentLabel();
      return label ? invoke('show_screenshot_overlay', { label }) : Promise.resolve(false);
    },
    startRecordingRegion(rect) {
      emit(enterRecordingRegionListeners);
      return invoke('open_region_screen_recorder', {
        label: currentLabel(),
        rect
      });
    },
    startScrollCapture(rect) {
      emit(sessionVisibleListeners);
      return invoke('start_screenshot_overlay_scroll_capture', {
        label: currentLabel(),
        rect
      });
    },
    translate(payload) {
      return invoke('translate_screenshot_overlay_text', { payload });
    }
  };

  function startOverlaySession(config) {
    window.tauriScreenshotOverlayConfig = config || {};
    sessionVisible = false;
    emit(sessionStartListeners, window.tauriScreenshotOverlayConfig);
  }

  window.tauriScreenshotOverlayStart = startOverlaySession;

  if (pendingInitialConfig && !pendingInitialConfig.warm) {
    window.tauriScreenshotOverlayPendingStartConfig = null;
    window.setTimeout(() => startOverlaySession(pendingInitialConfig), 0);
  }

  if (eventApi?.listen) {
    void eventApi.listen('screenshot:recording-playback', (event) => {
      const payload = event.payload || {};
      const videoUrl =
        payload.videoUrl ||
        (payload.filePath && typeof core?.convertFileSrc === 'function'
          ? core.convertFileSrc(payload.filePath)
          : '');

      emit(regionRecordingPlaybackListeners, {
        ...payload,
        videoUrl
      });
    });
    void eventApi.listen('screenshot:recording-playback-exit', () => {
      emit(exitRegionRecordingPlaybackListeners);
    });
    void eventApi.listen('screenshot:session-end', () => {
      emit(sessionEndListeners);
    });
    void eventApi.listen('screenshot:hide-for-recording', () => {
      emit(hideForRecordingListeners);
    });
  }
})();
