const timerEl = document.getElementById('timer');
const pauseBtn = document.getElementById('pause');
const stopBtn = document.getElementById('stop');

let accumulatedMs = 0;
let startedAt = 0;
let paused = false;
let timerId = 0;

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');

  return `${minutes}:${seconds}`;
}

function renderTimer() {
  if (!timerEl) {
    return;
  }

  const elapsed = paused ? accumulatedMs : accumulatedMs + Math.max(0, Date.now() - startedAt);
  timerEl.textContent = formatDuration(elapsed);
}

function startLocalTimer() {
  window.clearInterval(timerId);
  renderTimer();
  timerId = window.setInterval(renderTimer, 1000);
}

function applySessionState(config) {
  accumulatedMs = Math.max(0, Number(config?.accumulatedMs) || 0);
  startedAt = Number(config?.startedAt) || Date.now();
  paused = Boolean(config?.paused);
  startLocalTimer();

  if (pauseBtn) {
    pauseBtn.textContent = paused ? '继续' : '暂停';
  }
}

window.regionRecordingControl?.onSessionState?.(applySessionState);

pauseBtn?.addEventListener('click', () => {
  void window.regionRecordingControl?.togglePause?.();
});

stopBtn?.addEventListener('click', () => {
  window.clearInterval(timerId);
  timerId = 0;
  void window.regionRecordingControl?.stop?.();
});
