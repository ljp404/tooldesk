/* eslint-env browser */
const menu = document.getElementById('tray-menu');
const icons = {
  calendar: '<svg viewBox="0 0 24 24"><path d="M8 2v4"></path><path d="M16 2v4"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18"></path></svg>',
  extensions: '<svg viewBox="0 0 24 24"><path d="M12 2v6"></path><path d="M12 16v6"></path><path d="M2 12h6"></path><path d="M16 12h6"></path><path d="M7.8 7.8l4.2 4.2 4.2-4.2"></path><path d="M7.8 16.2l4.2-4.2 4.2 4.2"></path></svg>',
  launcher: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h8l-1 8 9-12h-8z"></path></svg>',
  quit: '<svg viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"></path><path d="M15 12H3"></path><path d="M21 3v18"></path></svg>',
  record: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="12" cy="12" r="3"></circle></svg>',
  screenshot: '<svg viewBox="0 0 24 24"><path d="M7 4h10l2 3h2v15H3V7h2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20h-3v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2-2 .1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4v-3h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-2 .1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v3h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>',
  show: '<svg viewBox="0 0 24 24"><path d="M4 5h16v12H4z"></path><path d="M8 21h8"></path><path d="M12 17v4"></path></svg>',
  'super-clipboard': '<svg viewBox="0 0 24 24"><path d="M9 4h6l1 2h3v16H5V6h3z"></path><path d="M9 4h6"></path><path d="M8 11h8"></path><path d="M8 15h6"></path></svg>'
};

function invoke(command, args) {
  return window.__TAURI__?.core?.invoke(command, args);
}

const defaultShortcuts = {
  launcher: 'Ctrl+Alt+Space',
  record: 'Ctrl+Shift+R',
  screenshot: 'Ctrl+Shift+A',
  superClipboard: 'Ctrl+Alt+V'
};

async function getShortcutLabels() {
  try {
    return await invoke('get_tray_menu_shortcuts');
  } catch {
    return defaultShortcuts;
  }
}

function clearMenu() {
  menu.replaceChildren();
}

function addItem(label, action, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'tray-menu-icon';
  iconSpan.innerHTML = icons[action] || '';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'tray-menu-label';
  labelSpan.textContent = label;
  button.append(iconSpan, labelSpan);

  if (options.shortcut) {
    const shortcutSpan = document.createElement('span');
    shortcutSpan.className = 'tray-menu-shortcut';
    shortcutSpan.textContent = options.shortcut;
    button.appendChild(shortcutSpan);
  }

  if (options.danger) {
    button.classList.add('danger');
  }

  button.addEventListener('click', () => {
    void invoke('run_tray_menu_action', { action });
  });
  menu.append(button);
}

function addSeparator() {
  const sep = document.createElement('div');
  sep.className = 'tray-menu-sep';
  sep.setAttribute('role', 'separator');
  menu.append(sep);
}

function reportMenuSize() {
  const rect = menu.getBoundingClientRect();
  void invoke('resize_tray_menu', {
    height: Math.ceil(rect.height),
    width: Math.ceil(rect.width)
  });
}

function renderMenu(shortcuts) {
  clearMenu();
  addItem('打开工作台', 'show');
  addItem('快速启动', 'launcher', { shortcut: shortcuts.launcher });
  addItem('日历', 'calendar');
  addSeparator();
  addItem('截图', 'screenshot', { shortcut: shortcuts.screenshot });
  addItem('录屏', 'record', { shortcut: shortcuts.record });
  addItem('超级剪切板', 'super-clipboard', { shortcut: shortcuts.superClipboard });
  addSeparator();
  addItem('扩展中心', 'extensions');
  addItem('设置', 'settings');
  addSeparator();
  addItem('退出', 'quit', { danger: true });

  requestAnimationFrame(() => {
    requestAnimationFrame(reportMenuSize);
  });
}

renderMenu(defaultShortcuts);

void getShortcutLabels().then((shortcuts) => {
  renderMenu(shortcuts);
});

void window.__TAURI__?.event?.listen('tray-menu:shortcuts', (event) => {
  renderMenu({
    ...defaultShortcuts,
    ...(event?.payload ?? {})
  });
});
