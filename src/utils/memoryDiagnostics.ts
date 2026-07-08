import { invoke } from '@tauri-apps/api/core';

type JsMemoryInfo = {
  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
};

type PerformanceWithMemory = Performance & {
  memory?: JsMemoryInfo;
};

type FrameWindowLike = {
  performance?: {
    memory?: JsMemoryInfo;
  };
};

type MemoryReport = {
  context: string;
  extra?: Record<string, string | number | boolean | null | undefined>;
  source: string;
};

const REPORT_INTERVAL_MS = 30000;

function mb(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? (value / 1024 / 1024).toFixed(1) : 'unavailable';
}

function getMemory() {
  return (window.performance as PerformanceWithMemory).memory;
}

function formatExtra(extra?: MemoryReport['extra']) {
  if (!extra) {
    return '';
  }

  return Object.entries(extra)
    .map(([key, value]) => `${key}=${String(value ?? '')}`)
    .join(' ');
}

/** Write a frontend diagnostic line to tooldesk-flow.log for future memory investigations. */
export function logAppDebug(area: string, message: string) {
  void invoke('log_app_debug', {
    area,
    message
  }).catch(() => undefined);
}

export function logComponentMemory(report: MemoryReport) {
  const memory = getMemory();
  const message = [
    `source=${report.source}`,
    `context=${report.context}`,
    `url=${window.location.href}`,
    `title=${document.title}`,
    `used_js_heap_mb=${mb(memory?.usedJSHeapSize)}`,
    `total_js_heap_mb=${mb(memory?.totalJSHeapSize)}`,
    `js_heap_limit_mb=${mb(memory?.jsHeapSizeLimit)}`,
    formatExtra(report.extra)
  ]
    .filter(Boolean)
    .join(' ');

  logAppDebug('component-memory', message);
}

export function startComponentMemoryReporter(getReport: () => MemoryReport) {
  logComponentMemory(getReport());
  const timer = window.setInterval(() => {
    logComponentMemory(getReport());
  }, REPORT_INTERVAL_MS);

  return () => window.clearInterval(timer);
}

export function readFrameMemory(frameWindow: FrameWindowLike | null | undefined) {
  try {
    return frameWindow?.performance?.memory;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function frameMemoryExtra(memory: ReturnType<typeof readFrameMemory>) {
  if (!memory) {
    return { iframeMemory: 'unavailable' };
  }

  if ('error' in memory) {
    return { iframeMemoryError: memory.error };
  }

  return {
    iframeJsHeapLimitMb: mb(memory.jsHeapSizeLimit),
    iframeTotalJsHeapMb: mb(memory.totalJSHeapSize),
    iframeUsedJsHeapMb: mb(memory.usedJSHeapSize)
  };
}
