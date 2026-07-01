export interface LrcLine {
  time: number;
  text: string;
}

export function parseLrc(content: string): LrcLine[] {
  const lines: LrcLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const timePattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    const times: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = timePattern.exec(trimmed)) !== null) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      const fraction = match[3] ? Number.parseInt(match[3].padEnd(3, '0'), 10) : 0;
      times.push(minutes * 60 + seconds + fraction / 1000);
    }

    const text = trimmed.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text || times.length === 0) {
      continue;
    }

    for (const time of times) {
      lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function getActiveLineIndex(lines: LrcLine[], currentTime: number): number {
  if (lines.length === 0) {
    return -1;
  }

  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].time <= currentTime + 0.05) {
      index = i;
    } else {
      break;
    }
  }

  return index;
}
