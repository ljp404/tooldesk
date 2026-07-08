import { onMounted, watch } from 'vue';

interface InitialToolContentOptions {
  accepts: (content: string) => boolean;
  apply: (content: string) => void | Promise<void>;
  shortcutContent?: () => string | undefined;
  shortcutContentVersion?: () => number | undefined;
}

async function readClipboardText() {
  if (!window.tooldeskShortcut?.readText) {
    return '';
  }

  return window.tooldeskShortcut.readText();
}

export function useInitialToolContent(options: InitialToolContentOptions) {
  let mounted = false;

  async function applyIfAccepted(content: string | undefined) {
    const value = content?.trim() ?? '';
    if (!value || !options.accepts(value)) {
      return false;
    }

    await options.apply(value);
    return true;
  }

  onMounted(async () => {
    if (await applyIfAccepted(options.shortcutContent?.())) {
      mounted = true;
      return;
    }

    await applyIfAccepted(await readClipboardText());
    mounted = true;
  });

  watch(
    () => options.shortcutContentVersion?.(),
    () => {
      if (!mounted) {
        return;
      }

      void applyIfAccepted(options.shortcutContent?.());
    }
  );
}
