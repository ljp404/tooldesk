/* eslint-env browser */
const invoke = (command) => window.__TAURI__?.core?.invoke(command);

let lastOpenAt = 0;

function openCalendar(event) {
  const now = Date.now();
  if (now - lastOpenAt < 250) {
    return;
  }
  lastOpenAt = now;
  event?.preventDefault();
  event?.stopPropagation();
  void invoke('open_taskbar_calendar_hotzone');
}

function refreshPosition() {
  void invoke('refresh_taskbar_calendar_hotzone');
}

window.addEventListener('pointerdown', openCalendar, { capture: true });
window.addEventListener('click', openCalendar, { capture: true });
window.addEventListener('contextmenu', openCalendar, { capture: true });
window.addEventListener('resize', refreshPosition);

refreshPosition();
setInterval(refreshPosition, 1000);
