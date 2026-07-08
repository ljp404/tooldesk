import type { HiddenChar } from '../types/toolbox';

export function findHiddenChars(text: string) {
  const found: HiddenChar[] = [];

  Array.from(text).forEach((char, index) => {
    const point = char.codePointAt(0) ?? 0;
    const name = getHiddenCharName(point);

    if (name) {
      found.push({
        index,
        codePoint: `U+${point.toString(16).toUpperCase().padStart(4, '0')}`,
        name,
        preview: char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\t' ? '\\t' : '不可见'
      });
    }
  });

  return found;
}

export function removeHiddenChars(text: string) {
  return Array.from(text)
    .filter((char) => !getHiddenCharName(char.codePointAt(0) ?? 0))
    .join('');
}

function getHiddenCharName(point: number) {
  if (point === 0x0009) return '制表符';
  if (point === 0x000a) return '换行符';
  if (point === 0x000d) return '回车符';
  if (point === 0x00a0) return '不换行空格';
  if (point === 0x200b) return '零宽空格';
  if (point === 0x200c) return '零宽非连接符';
  if (point === 0x200d) return '零宽连接符';
  if (point === 0x2060) return '单词连接符';
  if (point === 0xfeff) return '字节顺序标记';
  if (point < 0x20 || point === 0x7f) return '控制字符';
  return '';
}
