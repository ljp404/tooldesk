import type { SuperClipboardCategory, SuperClipboardContentType } from './types.js';

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const PATH_PATTERN = /^[a-zA-Z]:\\[^\n*?"<>|]+$/;
const UNIX_PATH_PATTERN = /^\/(?:[\w.-]+\/)+[\w.-]+$/;

export function detectCategory(type: SuperClipboardContentType, text: string, _html?: string): SuperClipboardCategory {
  if (type === 'image') {
    return 'image';
  }

  if (type === 'html') {
    return 'html';
  }

  const normalized = text.trim();

  if (!normalized) {
    return 'text';
  }

  if (URL_PATTERN.test(normalized)) {
    return 'link';
  }

  if (PATH_PATTERN.test(normalized) || UNIX_PATH_PATTERN.test(normalized)) {
    return 'path';
  }

  if (looksLikeHtmlSource(normalized)) {
    return 'html';
  }

  if (looksLikeJson(normalized)) {
    return 'json';
  }

  if (looksLikeCode(normalized)) {
    return 'code';
  }

  return 'text';
}

function looksLikeHtmlSource(text: string) {
  const head = text.slice(0, 4096).trim().toLowerCase();

  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return true;
  }

  if (/<!doctype\s+html/i.test(head) && /<html[\s>]/i.test(text)) {
    return true;
  }

  if (head.startsWith('<?xml') && /<html[\s>]/i.test(text)) {
    return true;
  }

  return false;
}

function looksLikeJson(text: string) {
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      JSON.parse(text);
      return true;
    } catch {
      // not json
    }
  }

  return false;
}

function looksLikeCode(text: string) {
  if (looksLikeHtmlSource(text)) {
    return false;
  }

  if (/^(function|const|let|var|import|export|class|interface|#include|def |public |private )/m.test(text)) {
    return true;
  }

  if (text.includes('<?xml')) {
    return true;
  }

  return false;
}

export function buildPreview(type: SuperClipboardContentType, text: string, html?: string) {
  if (type === 'image') {
    return '[图片]';
  }

  const source = text.trim() || stripHtml(html ?? '');

  if (!source) {
    return '[空内容]';
  }

  return source.replace(/\s+/g, ' ').slice(0, 160);
}

export function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 Windows CF_HTML / 富文本 HTML 中提取与 readText 可比的纯文本 */
export function extractPlainTextFromClipboardHtml(html: string) {
  const fragmentMatch = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);

  if (fragmentMatch) {
    return stripHtml(fragmentMatch[1]);
  }

  return stripHtml(html);
}

/** 剪贴板 HTML 是否包含与纯文本不同的富文本/结构（排除系统自动加的 HTML 包装） */
export function shouldStoreAsHtmlClipboard(html: string, text: string) {
  const trimmedHtml = html.trim();
  const trimmedText = text.trim();

  if (!trimmedHtml) {
    return false;
  }

  if (!trimmedText) {
    return extractPlainTextFromClipboardHtml(trimmedHtml).length > 0;
  }

  const extracted = extractPlainTextFromClipboardHtml(trimmedHtml);

  // 完全相同，不需要存储为 HTML
  if (extracted === trimmedText) {
    return false;
  }

  // 去除所有标签后相同，不需要存储为 HTML
  if (stripHtml(trimmedHtml) === trimmedText) {
    return false;
  }

  // 如果 HTML 只是简单的包装（没有格式化标签），不需要存储为 HTML
  if (!hasRichFormatting(trimmedHtml)) {
    return false;
  }

  return trimmedHtml !== trimmedText;
}

/** 检查 HTML 是否包含富文本格式化标签 */
function hasRichFormatting(html: string) {
  // 富文本格式化标签
  const richTags = /<(b|i|u|strong|em|mark|del|ins|sub|sup|code|pre|h[1-6]|ul|ol|li|table|tr|td|th|a|img|br|hr|blockquote|style|font|color|background)[\s>]/i;
  
  // 如果包含富文本标签，认为是真正的 HTML
  if (richTags.test(html)) {
    return true;
  }

  // 如果包含 style 属性，认为是富文本
  if (/style\s*=\s*["'][^"']*["']/i.test(html)) {
    return true;
  }

  return false;
}
