import { onBeforeUnmount, ref } from 'vue';

export function useClipboardCopy() {
  const copyStatus = ref('');
  let copyStatusTimer: number | undefined;

  onBeforeUnmount(() => {
    clearCopyStatusTimer();
  });

  function clearCopyStatusTimer() {
    if (copyStatusTimer) {
      window.clearTimeout(copyStatusTimer);
      copyStatusTimer = undefined;
    }
  }

  function showCopyStatus(message: string) {
    clearCopyStatusTimer();
    copyStatus.value = message;
    copyStatusTimer = window.setTimeout(() => {
      copyStatus.value = '';
      copyStatusTimer = undefined;
    }, 1600);
  }

  async function writeClipboardText(text: string) {
    if (!window.tooldeskShortcut?.copyText) {
      return false;
    }

    return window.tooldeskShortcut.copyText(text);
  }

  async function copyText(text: string, successMessage = '已复制', failureMessage = '复制失败') {
    const copied = await writeClipboardText(text);
    showCopyStatus(copied ? successMessage : failureMessage);
    return copied;
  }

  function clearCopyStatus() {
    clearCopyStatusTimer();
    copyStatus.value = '';
  }

  return {
    clearCopyStatus,
    copyStatus,
    copyText
  };
}
