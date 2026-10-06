import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { setStorageDir, loadSettings, saveSettings } from '../store.js';
import { setAuthDir, updateConfig, config } from '../config.js';
import {
  startPublisher,
  stopPublisher,
  getPublisherStatus,
  setPublisherPaused,
  isPublisherPaused,
  testBufferKey,
  fetchGroups,
} from '../worker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// Set data directory to Windows AppData folder (writable without admin rights)
setStorageDir(app.getPath('userData'));
setAuthDir(join(app.getPath('userData'), 'auth_info_baileys'));

// Single instance enforcement
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let appIsQuitting = false;
let hasShownTrayNotice = false;

function getIconImage() {
  const iconPath = join(ROOT, 'assets', 'icon.png');
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}

function updateTrayMenu() {
  if (!tray) return;

  const status = getPublisherStatus();
  const isPaused = isPublisherPaused();
  const isOnline = status.whatsapp.connection === 'open';

  let statusLabel = '🔴 Disconnected';
  if (isPaused) {
    statusLabel = '⏸️ Paused';
  } else if (isOnline) {
    statusLabel = status.buffer.channelName
      ? `🟢 Active: ${status.buffer.channelName}`
      : '🟢 WhatsApp Connected';
  } else if (status.whatsapp.connection === 'qr_ready') {
    statusLabel = '🟡 Waiting for QR Scan';
  } else if (status.whatsapp.connection === 'connecting') {
    statusLabel = '🟡 Connecting…';
  }

  const loginSettings = app.getLoginItemSettings();

  const contextMenu = Menu.buildFromTemplate([
    { label: 'WhatsApp → Facebook Publisher', enabled: false },
    { label: `Status: ${statusLabel}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Dashboard & Setup',
      click: () => showWindow(),
    },
    {
      label: isPaused ? '▶️ Resume Publishing' : '⏸️ Pause Publishing',
      click: () => {
        setPublisherPaused(!isPaused);
        updateTrayMenu();
        sendToRenderer('status-update', getPublisherStatus());
      },
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: loginSettings.openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,
        });
        saveSettings({ openAtLogin: item.checked });
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`WhatsApp Publisher (${statusLabel})`);
}

function showWindow() {
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 780,
    minHeight: 600,
    title: 'WhatsApp → Facebook Publisher',
    icon: getIconImage(),
    frame: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(ROOT, 'src', 'ui', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (!hasShownTrayNotice && tray) {
        tray.displayBalloon?.({
          title: 'WhatsApp Publisher',
          content: 'The app is still running in the background. Right-click the tray icon to manage it.',
        });
        hasShownTrayNotice = true;
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    const settings = loadSettings();
    const hasConfig = Boolean(settings.bufferApiKey && (settings.whatsappSelfJid || settings.whatsappGroupJid));
    const status = getPublisherStatus();

    // If unconfigured or needing QR scan, show window; otherwise start quiet in tray
    if (!hasConfig || status.whatsapp.connection !== 'open') {
      mainWindow.show();
    }
  });
}

function createTray() {
  const icon = getIconImage().resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('WhatsApp → Facebook Publisher');

  tray.on('double-click', () => showWindow());
  tray.on('click', () => showWindow());

  updateTrayMenu();
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-state', async () => {
  const settings = loadSettings();
  const status = getPublisherStatus();
  const loginSettings = app.getLoginItemSettings();
  return {
    settings,
    status,
    openAtLogin: loginSettings.openAtLogin,
  };
});

ipcMain.handle('save-settings', async (_e, newSettings) => {
  const saved = saveSettings(newSettings);
  updateConfig({
    postingProvider: saved.postingProvider,
    whatsappSelfJid: saved.whatsappSelfJid,
    whatsappGroupName: saved.whatsappGroupName,
    whatsappGroupJid: saved.whatsappGroupJid,
    whatsappGroupAllowAll: saved.whatsappGroupAllowAll,
    bufferApiKey: saved.bufferApiKey,
    bufferOrgId: saved.bufferOrgId,
    bufferChannelId: saved.bufferChannelId,
  });

  if (newSettings.openAtLogin !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: Boolean(newSettings.openAtLogin),
      openAsHidden: true,
    });
  }

  updateTrayMenu();
  return { success: true, settings: saved };
});

ipcMain.handle('test-buffer', async (_e, apiKey) => {
  try {
    const result = await testBufferKey(apiKey);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fetch-groups', async (_e, query) => {
  try {
    const groups = await fetchGroups(query);
    return { success: true, groups };
  } catch (err) {
    return { success: false, error: err.message, groups: [] };
  }
});

ipcMain.handle('toggle-pause', async () => {
  const next = !isPublisherPaused();
  setPublisherPaused(next);
  updateTrayMenu();
  return { isPaused: next };
});

ipcMain.handle('toggle-autostart', async (_e, enable) => {
  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: true,
  });
  saveSettings({ openAtLogin: enable });
  updateTrayMenu();
  return { openAtLogin: enable };
});

ipcMain.handle('restart-whatsapp', async () => {
  try {
    await stopPublisher();
    await startPublisher({
      onQr: (_qr, dataUrl) => sendToRenderer('qr-update', dataUrl),
      onStatus: (status) => {
        updateTrayMenu();
        sendToRenderer('status-update', status);
      },
      onLog: (log) => sendToRenderer('log-update', log),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) mainWindow.hide();
  return true;
});

ipcMain.handle('open-external', (_e, url) => {
  shell.openExternal(url);
  return true;
});

// ── App Lifecycle ────────────────────────────────────────────────────────────

app.on('second-instance', () => {
  showWindow();
});

app.whenReady().then(async () => {
  const initialSettings = loadSettings();
  if (initialSettings.openAtLogin !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: Boolean(initialSettings.openAtLogin),
      openAsHidden: true,
    });
  }

  createTray();
  createMainWindow();

  // Start publisher engine in background
  try {
    await startPublisher({
      onQr: (_qr, dataUrl) => sendToRenderer('qr-update', dataUrl),
      onStatus: (status) => {
        updateTrayMenu();
        sendToRenderer('status-update', status);
      },
      onLog: (log) => sendToRenderer('log-update', log),
    });
  } catch (err) {
    console.error('Failed to start publisher engine:', err);
  }
});

app.on('window-all-closed', () => {
  // On Windows, keep the app alive in system tray unless user explicitly quits
});

app.on('before-quit', async () => {
  appIsQuitting = true;
  await stopPublisher();
});
