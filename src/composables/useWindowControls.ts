import { onBeforeUnmount, onMounted, ref } from 'vue';

export function useWindowControls() {
  const isMaximized = ref(false);
  let stopWindowStateListener: (() => void) | undefined;

  function minimizeWindow() {
    void window.tooldeskShortcut?.minimizeCurrentWindow();
  }

  function toggleMaximizeWindow() {
    void window.tooldeskShortcut?.toggleMaximizeCurrentWindow().then((value) => {
      isMaximized.value = value;
    });
  }

  function closeWindow() {
    void window.tooldeskShortcut?.closeCurrentWindow();
  }

  onMounted(() => {
    if (!window.tooldeskShortcut) {
      return;
    }

    void window.tooldeskShortcut.isWindowMaximized().then((value) => {
      isMaximized.value = value;
    });

    stopWindowStateListener = window.tooldeskShortcut.onWindowMaximizedChange((value) => {
      isMaximized.value = value;
    });
  });

  onBeforeUnmount(() => {
    stopWindowStateListener?.();
  });

  return {
    closeWindow,
    isMaximized,
    minimizeWindow,
    toggleMaximizeWindow
  };
}
