function parseDurationValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (value > 60000) {
      return Math.round(value / 1000);
    }
    return Math.round(value);
  }

  if (typeof value === 'string' && value.trim()) {
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num) || num <= 0) {
      return 0;
    }
    if (num > 60000) {
      return Math.round(num / 1000);
    }
    return Math.round(num);
  }

  return 0;
}

export function extractCloudFileDuration(file: Record<string, unknown>): number {
  const direct = parseDurationValue(file.duration);
  if (direct > 0) {
    return direct;
  }

  const audioMeta = file.audio_media_metadata as { duration?: unknown } | undefined;
  const audioDuration = parseDurationValue(audioMeta?.duration);
  if (audioDuration > 0) {
    return audioDuration;
  }

  const videoMeta = file.video_media_metadata as {
    duration?: unknown;
    video_media_audio_stream?: Array<{ duration?: unknown }>;
  } | undefined;

  const videoDuration = parseDurationValue(videoMeta?.duration);
  if (videoDuration > 0) {
    return videoDuration;
  }

  const streamDuration = parseDurationValue(videoMeta?.video_media_audio_stream?.[0]?.duration);
  if (streamDuration > 0) {
    return streamDuration;
  }

  return 0;
}
