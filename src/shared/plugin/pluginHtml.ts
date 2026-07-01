export const PLUGIN_SDK_SCRIPT_TAG =
  '<script data-tooldesk-sdk="1" src="tooldesk-plugin://__host__/tooldesk-plugin-sdk.js"></script>';
const PLUGIN_GLOBAL_STYLE_TAG = `<style data-tooldesk-global-style="1">
textarea:focus,
textarea:focus-visible,
input:not([type='checkbox'], [type='radio'], [type='range'], [type='file'], [type='color']):focus,
input:not([type='checkbox'], [type='radio'], [type='range'], [type='file'], [type='color']):focus-visible {
  border-color: var(--panel-border, #dbe4ef) !important;
  box-shadow: none !important;
  outline: none !important;
}
</style>`;

const PLUGIN_SDK_SCRIPT_PATTERN = /<script\b[^>]*tooldesk-plugin-sdk\.js[^>]*>\s*<\/script>/gi;
const PLUGIN_SDK_SELF_CLOSING_PATTERN = /<script\b[^>]*tooldesk-plugin-sdk\.js[^>]*\/>/gi;
const PLUGIN_SDK_INLINE_PATTERN = /<script\b[^>]*data-tooldesk-sdk=["']1["'][^>]*>[\s\S]*?<\/script>/gi;
const PLUGIN_GLOBAL_STYLE_PATTERN = /<style\b[^>]*data-tooldesk-global-style=["']1["'][^>]*>[\s\S]*?<\/style>/gi;

function escapeInlineScriptSource(source: string) {
  return source.replace(/<\/script/gi, '<\\/script');
}

export function buildInlinePluginSdkScriptTag(sdkSource: string) {
  const normalized = String(sdkSource ?? '').replace(/^\uFEFF/, '').trim();

  if (!normalized) {
    return PLUGIN_SDK_SCRIPT_TAG;
  }

  return `<script data-tooldesk-sdk="1">${escapeInlineScriptSource(normalized)}</script>`;
}

export function injectPluginSdkIntoHtml(html: string, sdkSource?: string) {
  const stripped = html
    .replace(PLUGIN_GLOBAL_STYLE_PATTERN, '')
    .replace(PLUGIN_SDK_INLINE_PATTERN, '')
    .replace(PLUGIN_SDK_SCRIPT_PATTERN, '')
    .replace(PLUGIN_SDK_SELF_CLOSING_PATTERN, '');

  const headInjection = `${PLUGIN_GLOBAL_STYLE_TAG}${sdkSource?.trim() ? buildInlinePluginSdkScriptTag(sdkSource) : PLUGIN_SDK_SCRIPT_TAG}`;

  if (/<head\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head(\b[^>]*)>/i, `<head$1>${headInjection}`);
  }

  return `${headInjection}${stripped}`;
}
