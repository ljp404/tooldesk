import type { InstalledApplication } from '../types/installedApplication';

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function applicationSearchScore(application: InstalledApplication, query: string) {
  const name = normalizeSearchText(application.name);
  const keywords = application.keywords.map(normalizeSearchText).filter(Boolean);

  if (name === query) {
    return 0;
  }

  if (name.startsWith(query)) {
    return 1;
  }

  if (name.includes(query)) {
    return 2;
  }

  if (keywords.some((keyword) => keyword === query || keyword.startsWith(query))) {
    return 3;
  }

  if (keywords.some((keyword) => keyword.includes(query))) {
    return 4;
  }

  return null;
}

export function filterInstalledApplications(applications: InstalledApplication[], rawQuery: string) {
  const query = normalizeSearchText(rawQuery);

  if (!query) {
    return [];
  }

  return applications
    .map((application) => ({ application, score: applicationSearchScore(application, query) }))
    .filter((item): item is { application: InstalledApplication; score: number } => item.score !== null)
    .sort((current, next) => current.score - next.score || current.application.name.localeCompare(next.application.name, 'zh-CN'))
    .map((item) => item.application);
}
