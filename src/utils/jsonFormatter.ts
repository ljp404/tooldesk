type JsonObject = Record<string, unknown>;

function createIndent(level: number, size: number) {
  return ' '.repeat(level * size);
}

function formatPrimitive(value: unknown) {
  return JSON.stringify(value) ?? 'null';
}

function formatValue(value: unknown, level: number, indentSize: number): string {
  if (value === null || typeof value !== 'object') {
    return formatPrimitive(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    const indent = createIndent(level, indentSize);
    const childIndent = createIndent(level + 1, indentSize);
    const rows = value.map((item) => `${childIndent}${formatValue(item, level + 1, indentSize)}`);

    return `[\n${rows.join(',\n')}\n${indent}]`;
  }

  const entries = Object.entries(value as JsonObject);

  if (entries.length === 0) {
    return '{}';
  }

  const indent = createIndent(level, indentSize);
  const childIndent = createIndent(level + 1, indentSize);
  const rows = entries.map(
    ([key, entryValue]) => `${childIndent}${JSON.stringify(key)}: ${formatValue(entryValue, level + 1, indentSize)}`
  );

  return `{\n${rows.join(',\n')}\n${indent}}`;
}

export function formatJsonWithInlineValues(source: string, indentSize = 4) {
  const parsed = JSON.parse(source) as unknown;
  return formatValue(parsed, 0, indentSize);
}
