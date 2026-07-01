interface JsonSearchHighlight {
  activeStart?: number;
  query: string;
}

export function highlightJson(text: string, search?: JsonSearchHighlight) {
  const searchRanges = search?.query ? buildSearchRanges(text, search.query, search.activeStart) : [];
  let offset = 0;

  return text
    .split('\n')
    .map((line, lineIndex) => {
      const tokens =
        line.match(
          /"(?:\\.|[^"\\])*"|\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]|\s+|./g
        ) ?? [];

      const highlightedLine = tokens
        .map((token, index) => {
          const tokenStart = offset;
          const tokenEnd = tokenStart + token.length;
          const escapedToken = highlightSearchToken(token, tokenStart, tokenEnd, searchRanges);
          offset = tokenEnd;

          if (/^\s+$/.test(token)) {
            return escapedToken;
          }

          if (/^"(?:\\.|[^"\\])*"$/.test(token)) {
            const nextNonSpace = tokens.slice(index + 1).find((item) => !/^\s+$/.test(item));
            const className = nextNonSpace === ':' ? 'json-key' : 'json-string';
            return `<span class="${className}">${escapedToken}</span>`;
          }

          if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
            return `<span class="json-number">${escapedToken}</span>`;
          }

          if (/^(true|false|null)$/.test(token)) {
            return `<span class="json-const">${escapedToken}</span>`;
          }

          if (/^[{}[\],:]$/.test(token)) {
            return `<span class="json-punct">${escapedToken}</span>`;
          }

          return escapedToken;
        })
        .join('');

      if (lineIndex < text.split('\n').length - 1) {
        offset += 1;
      }

      return highlightedLine;
    })
    .join('\n');
}

export function findTextMatches(text: string, query: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const matches: Array<{ end: number; start: number }> = [];
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = normalizedQuery.toLocaleLowerCase();
  let start = 0;

  while (start < text.length) {
    const index = lowerText.indexOf(lowerQuery, start);

    if (index === -1) {
      break;
    }

    matches.push({
      end: index + normalizedQuery.length,
      start: index
    });
    start = index + Math.max(1, normalizedQuery.length);
  }

  return matches;
}

function buildSearchRanges(text: string, query: string, activeStart?: number) {
  return findTextMatches(text, query).map((range) => ({
    ...range,
    active: activeStart === range.start
  }));
}

function highlightSearchToken(
  token: string,
  tokenStart: number,
  tokenEnd: number,
  ranges: Array<{ active: boolean; end: number; start: number }>
) {
  if (ranges.length === 0) {
    return escapeHtml(token);
  }

  const pieces: string[] = [];
  let cursor = 0;

  ranges.forEach((range) => {
    const start = Math.max(tokenStart, range.start);
    const end = Math.min(tokenEnd, range.end);

    if (start >= end) {
      return;
    }

    const localStart = start - tokenStart;
    const localEnd = end - tokenStart;

    pieces.push(escapeHtml(token.slice(cursor, localStart)));
    pieces.push(
      `<mark class="json-search-match${range.active ? ' active' : ''}">${escapeHtml(token.slice(localStart, localEnd))}</mark>`
    );
    cursor = localEnd;
  });

  pieces.push(escapeHtml(token.slice(cursor)));
  return pieces.join('');
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
