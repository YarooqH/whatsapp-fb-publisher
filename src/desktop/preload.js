import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  testBuffer: (apiKey) => ipcRenderer.invoke('test-buffer', apiKey),
  fetchGroups: (query) => ipcRenderer.invoke('fetch-groups', query),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  toggleAutoStart: (enable) => ipcRenderer.invoke('toggle-autostart', enable),
  restartWhatsApp: () => ipcRenderer.invoke('restart-whatsapp'),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onQrUpdate: (callback) => ipcRenderer.on('qr-update', (_e, data) => callback(data)),
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (_e, data) => callback(data)),
  onLogUpdate: (callback) => ipcRenderer.on('log-update', (_e, data) => callback(data)),
});
