export interface TranslateRequest {
  from: string;
  text: string;
  to: string;
}

export function resolveTranslateDirection(request: TranslateRequest) {
  if (request.from !== 'auto' || request.to.toLowerCase() !== 'zh-cn') {
    return {
      from: request.from,
      to: request.to
    };
  }

  const compactText = request.text.replace(/\s+/g, '');

  if (!compactText) {
    return {
      from: request.from,
      to: request.to
    };
  }

  let cjkCount = 0;
  let latinCount = 0;

  for (const char of compactText) {
    if (/[\u4e00-\u9fff]/.test(char)) {
      cjkCount += 1;
    } else if (/[A-Za-z]/.test(char)) {
      latinCount += 1;
    }
  }

  if (latinCount === 0 && cjkCount > 0) {
    return {
      from: 'zh-CN',
      to: 'en'
    };
  }

  if (cjkCount > latinCount) {
    return {
      from: 'auto',
      to: 'en'
    };
  }

  return {
    from: request.from,
    to: request.to
  };
}

export async function translateText(request: TranslateRequest) {
  const source = request.text.trim();
  const direction = resolveTranslateDirection({
    ...request,
    text: source
  });

  if (!source) {
    throw new Error('请输入要翻译的文本');
  }

  if (direction.from !== 'auto' && direction.from === direction.to) {
    throw new Error('源语言和目标语言不能相同');
  }

  if (!window.tooldeskShortcut?.translateText) {
    throw new Error('翻译 API 仅在桌面客户端中可用，请先配置 tooldesk 翻译 API');
  }

  const result = await window.tooldeskShortcut.translateText({
    from: direction.from,
    text: source,
    to: direction.to
  });

  return result.text;
}

export function splitTranslateText(text: string) {
  if (text.length <= 450) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 450) {
    const splitAt = remaining.lastIndexOf('\n', 450);

    if (splitAt > 0) {
      chunks.push(remaining.slice(0, splitAt + 1));
      remaining = remaining.slice(splitAt + 1);
      continue;
    }

    chunks.push(remaining.slice(0, 450));
    remaining = remaining.slice(450);
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
