const video = document.getElementById('video');
const playBtn = document.getElementById('playBtn');
const seek = document.getElementById('seek');
const timeEl = document.getElementById('time');
const closeBtn = document.getElementById('closeBtn');

let currentObjectUrl = '';
let seeking = false;

function pad(value) {
  return String(Math.floor(value)).padStart(2, '0');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${pad(minutes)}:${pad(rest)}`;
}

function updateControls() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  playBtn.textContent = video.paused ? '▶' : 'Ⅱ';
  timeEl.textContent = `${formatTime(current)} / ${formatTime(duration)}`;

  if (!seeking) {
    seek.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
  }
}

function toAssetUrl(filePath) {
  if (!filePath) {
    return '';
  }

  const tauriCore = window.__TAURI__?.core;
  if (tauriCore?.convertFileSrc) {
    return tauriCore.convertFileSrc(filePath);
  }

  return filePath;
}

async function closeWindow() {
  URL.revokeObjectURL(currentObjectUrl);
  const tauriWindow = window.__TAURI__?.window;
  const currentWindow = tauriWindow?.getCurrentWindow?.();

  if (currentWindow?.close) {
    await currentWindow.close();
    return;
  }

  window.close();
}

function loadPlayback(payload) {
  const assetUrl = toAssetUrl(payload?.filePath);
  if (!assetUrl) {
    return;
  }

  video.src = assetUrl;
  video.play().catch(() => undefined);
  updateControls();
}

playBtn.addEventListener('click', () => {
  if (video.paused) {
    video.play().catch(() => undefined);
  } else {
    video.pause();
  }
});

seek.addEventListener('input', () => {
  seeking = true;
});

seek.addEventListener('change', () => {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const ratio = Number(seek.value) / 1000;
  video.currentTime = duration * ratio;
  seeking = false;
  updateControls();
});

video.addEventListener('loadedmetadata', updateControls);
video.addEventListener('play', updateControls);
video.addEventListener('pause', updateControls);
video.addEventListener('timeupdate', updateControls);
video.addEventListener('ended', updateControls);
closeBtn.addEventListener('click', () => {
  void closeWindow();
});

window.tauriRegionRecordingPlaybackReady = loadPlayback;
