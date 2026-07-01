import { describe, expect, it } from 'vitest';
import { comparePluginVersions, isPluginUpdateAvailable } from './pluginVersion';

describe('comparePluginVersions', () => {
  it('compares numeric semver segments', () => {
    expect(comparePluginVersions('0.1.2', '0.1.3')).toBe(-1);
    expect(comparePluginVersions('1.0.0', '0.9.9')).toBe(1);
    expect(comparePluginVersions('2.4.10', '2.4.10')).toBe(0);
  });

  it('treats missing segments as zero', () => {
    expect(comparePluginVersions('1.0', '1.0.1')).toBe(-1);
    expect(comparePluginVersions('1.0.1', '1.0')).toBe(1);
  });
});

describe('isPluginUpdateAvailable', () => {
  it('returns true when market version is newer', () => {
    expect(isPluginUpdateAvailable('0.1.2', '0.1.3')).toBe(true);
  });

  it('returns false when versions match or installed is newer', () => {
    expect(isPluginUpdateAvailable('0.1.3', '0.1.3')).toBe(false);
    expect(isPluginUpdateAvailable('0.2.0', '0.1.9')).toBe(false);
    expect(isPluginUpdateAvailable('', '0.1.9')).toBe(false);
  });
});
