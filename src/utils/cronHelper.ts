import { CronExpressionParser } from 'cron-parser';

export interface CronPreset {
  expression: string;
  label: string;
}

export interface CronRunItem {
  label: string;
  value: string;
}

export interface CronParseResult {
  description: string;
  error: string;
  expression: string;
  nextRuns: CronRunItem[];
  valid: boolean;
}

export const cronPresets: CronPreset[] = [
  { expression: '* * * * *', label: '每分钟' },
  { expression: '0 * * * *', label: '每小时整点' },
  { expression: '0 0 * * *', label: '每天 00:00' },
  { expression: '0 12 * * *', label: '每天 12:00' },
  { expression: '0 0 * * 1', label: '每周一 00:00' },
  { expression: '0 0 1 * *', label: '每月 1 日 00:00' },
  { expression: '0 0 1 1 *', label: '每年 1 月 1 日 00:00' },
  { expression: '*/5 * * * *', label: '每 5 分钟' },
  { expression: '0 9-18 * * 1-5', label: '工作日 9-18 点整点' }
];

const fieldLabels = ['分', '时', '日', '月', '周'];

function describeExpression(expression: string) {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== 5) {
    return '标准 Cron 为 5 段：分 时 日 月 周';
  }

  return fields.map((field, index) => `${fieldLabels[index]}=${field}`).join(' · ');
}

function formatRunDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function parseCronExpression(expression: string, count = 8): CronParseResult {
  const trimmed = expression.trim();

  if (!trimmed) {
    return {
      description: '',
      error: '',
      expression: trimmed,
      nextRuns: [],
      valid: true
    };
  }

  try {
    const interval = CronExpressionParser.parse(trimmed, {
      currentDate: new Date(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    const nextRuns: CronRunItem[] = [];

    for (let index = 0; index < count; index += 1) {
      const next = interval.next().toDate();
      nextRuns.push({
        label: `#${index + 1}`,
        value: formatRunDate(next)
      });
    }

    return {
      description: describeExpression(trimmed),
      error: '',
      expression: trimmed,
      nextRuns,
      valid: true
    };
  } catch (error) {
    return {
      description: describeExpression(trimmed),
      error: error instanceof Error ? error.message : 'Cron 表达式无效',
      expression: trimmed,
      nextRuns: [],
      valid: false
    };
  }
}
