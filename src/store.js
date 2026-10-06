import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let storageDir = ROOT;

/** Configure the base storage directory (e.g. app.getPath('userData') in Electron). */
export function setStorageDir(dir) {
  storageDir = dir;
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
}

export function getStorageDir() {
  return storageDir;
}

export function getSettingsPath() {
  return join(storageDir, 'settings.json');
}

/** Load settings from settings.json, merging with existing .env variables as fallbacks. */
export function loadSettings() {
  const settingsFile = getSettingsPath();
  let fileSettings = {};

  if (existsSync(settingsFile)) {
    try {
      fileSettings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    } catch (err) {
      console.error('Failed to parse settings.json:', err.message);
    }
  }

  // Fallback to process.env if not set in settings.json
  const envGroupJid = process.env.WHATSAPP_GROUP_JID?.trim();
  const rawGroup = fileSettings.whatsappGroupJid || envGroupJid;
  const groupJid = rawGroup ? (rawGroup.includes('@') ? rawGroup : `${rawGroup}@g.us`) : null;

  return {
    postingProvider: (fileSettings.postingProvider || process.env.POSTING_PROVIDER || 'buffer').trim().toLowerCase(),
    bufferApiKey: fileSettings.bufferApiKey || process.env.BUFFER_API_KEY?.trim() || '',
    bufferOrgId: fileSettings.bufferOrgId || process.env.BUFFER_ORG_ID?.trim() || null,
    bufferChannelId: fileSettings.bufferChannelId || process.env.BUFFER_CHANNEL_ID?.trim() || null,
    whatsappSelfJid: fileSettings.whatsappSelfJid || process.env.WHATSAPP_SELF_JID?.trim() || '',
    whatsappGroupName: fileSettings.whatsappGroupName || process.env.WHATSAPP_GROUP_NAME?.trim() || '',
    whatsappGroupJid: groupJid,
    whatsappGroupAllowAll: Boolean(
      fileSettings.whatsappGroupAllowAll ??
      (process.env.WHATSAPP_GROUP_ALLOW_ALL || 'false').trim().toLowerCase() === 'true'
    ),
    catboxUserhash: fileSettings.catboxUserhash || process.env.CATBOX_USERHASH?.trim() || '',
    openAtLogin: Boolean(fileSettings.openAtLogin ?? true),
  };
}

/** Save updated settings into settings.json. */
export function saveSettings(newSettings) {
  const current = loadSettings();
  const merged = { ...current, ...newSettings };
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
  writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}
