/* eslint-env browser */
(function () {
  const core = window.__TAURI__?.core;
  const tauriWindow = window.__TAURI__?.window;
  const searchParams = new URLSearchParams(window.location.search);
  const label = searchParams.get('label') || '';
  const imageListeners = new Set();
  const focusListeners = new Set();
  const wheelListeners = new Set();
  let resizeFrame = 0;
  let pendingResize = null;

  function invoke(command, payload) {
    if (!core?.invoke) {
      return Promise.reject(new Error('Tauri API 不可用'));
    }

    return core.invoke(command, payload);
  }

  function emit(listeners, payload) {
    for (const listener of listeners) {
      listener(payload);
    }
  }

  function subscribe(listeners, callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  window.screenshotPin = {
    close() {
      return invoke('close_pin_screenshot_window', { label });
    },
    copy(payload) {
      return invoke('copy_pin_screenshot', { payload });
    },
    download(payload) {
      return invoke('save_pin_screenshot', { payload });
    },
    focus() {
      return Promise.resolve(true);
    },
    moveBy(delta) {
      return invoke('move_pin_screenshot_window', {
        dx: Number(delta?.dx ?? 0),
        dy: Number(delta?.dy ?? 0),
        label
      });
    },
    onFocusChange(callback) {
      return subscribe(focusListeners, callback);
    },
    onImage(callback) {
      const unsubscribe = subscribe(imageListeners, callback);

      if (label) {
        void invoke('get_pin_screenshot_payload', { label }).then((payload) => {
          if (payload) {
            callback(payload);
          }
        });
      }

      return unsubscribe;
    },
    onWheel(callback) {
      return subscribe(wheelListeners, callback);
    },
    ready() {
      return invoke('reveal_pin_screenshot_window', { label });
    },
    resize(size) {
      pendingResize = {
        height: Number(size?.height ?? 0),
        label,
        width: Number(size?.width ?? 0)
      };

      if (!resizeFrame) {
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          const next = pendingResize;
          pendingResize = null;

          if (next) {
            void invoke('resize_pin_screenshot_window', next);
          }
        });
      }

      return Promise.resolve(true);
    },
    showMenu(payload) {
      const request = {
        clientX: Number(payload?.clientX ?? 0),
        clientY: Number(payload?.clientY ?? 0),
        label,
        x: Number(payload?.screenX ?? 0),
        y: Number(payload?.screenY ?? 0)
      };
      return invoke('show_pin_screenshot_menu', {
        payload: request
      });
    }
  };

  window.addEventListener('focus', () => emit(focusListeners, true));
  window.addEventListener('blur', () => emit(focusListeners, false));
  window.addEventListener(
    'wheel',
    (event) => {
      emit(wheelListeners, { deltaY: event.deltaY });
    },
    { passive: true }
  );

})();
