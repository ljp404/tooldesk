function parseVersionPart(part: string) {
  const match = part.match(/^\d+/);
  return match ? Number(match[0]) : 0;
}

function normalizeVersionParts(version: string) {
  return version
    .trim()
    .split(/[.-]/)
    .map(parseVersionPart);
}

export function comparePluginVersions(installed: string, market: string) {
  const installedParts = normalizeVersionParts(installed);
  const marketParts = normalizeVersionParts(market);
  const maxLength = Math.max(installedParts.length, marketParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const installedPart = installedParts[index] ?? 0;
    const marketPart = marketParts[index] ?? 0;

    if (installedPart !== marketPart) {
      return installedPart < marketPart ? -1 : 1;
    }
  }

  return 0;
}

export function isPluginUpdateAvailable(installed: string | undefined, market: string) {
  const normalizedInstalled = installed?.trim();

  if (!normalizedInstalled) {
    return false;
  }

  return comparePluginVersions(normalizedInstalled, market.trim()) < 0;
}
