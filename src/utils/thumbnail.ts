export function extractThumbnailUrl(thumbnail: unknown): string | undefined {
  if (typeof thumbnail === 'string' && thumbnail.trim()) {
    return thumbnail;
  }

  if (Array.isArray(thumbnail)) {
    for (const item of thumbnail) {
      const url = extractThumbnailUrl(item);
      if (url) {
        return url;
      }
    }
  }

  if (thumbnail && typeof thumbnail === 'object') {
    const obj = thumbnail as Record<string, unknown>;
    if (typeof obj.url === 'string' && obj.url.trim()) {
      return obj.url;
    }
  }

  return undefined;
}
