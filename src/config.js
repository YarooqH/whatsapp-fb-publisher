import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings, getStorageDir } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Tiny .env loader (for development and fallback)
(function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

const stored = loadSettings();

const rawGroup = stored.whatsappGroupJid || process.env.WHATSAPP_GROUP_JID?.trim();
const groupJid = rawGroup ? (rawGroup.includes('@') ? rawGroup : `${rawGroup}@g.us`) : null;
const groupName = stored.whatsappGroupName || process.env.WHATSAPP_GROUP_NAME?.trim() || null;
const groupAllowAll = Boolean(stored.whatsappGroupAllowAll);

export const config = {
  postingProvider: stored.postingProvider || (process.env.POSTING_PROVIDER || 'buffer').trim().toLowerCase(),
  selfJid: stored.whatsappSelfJid || process.env.WHATSAPP_SELF_JID?.trim() || '',
  selfLid: stored.whatsappSelfLid || null,

  // Group chat destination
  groupJid,
  groupName,
  groupAllowAll,

  // Graph API mode
  fbPageId: process.env.FB_PAGE_ID?.trim() || '',
  fbPageToken: process.env.FB_PAGE_TOKEN?.trim() || '',
  fbApiVersion: (process.env.FB_API_VERSION || 'v21.0').trim(),

  // Buffer mode
  bufferApiKey: stored.bufferApiKey || process.env.BUFFER_API_KEY?.trim() || '',
  bufferOrgId: stored.bufferOrgId || process.env.BUFFER_ORG_ID?.trim() || null,
  bufferChannelId: stored.bufferChannelId || process.env.BUFFER_CHANNEL_ID?.trim() || null,

  // Catbox auto-delete mode
  catboxUserhash: stored.catboxUserhash || process.env.CATBOX_USERHASH?.trim() || '',

  port: process.env.PORT ? Number(process.env.PORT) : null,
  authDir: join(ROOT, 'auth_info_baileys'),
};

/** Set authDir dynamically (e.g. into userData for packaged app) */
export function setAuthDir(dir) {
  config.authDir = dir;
}

/** Update running config dynamically */
export function updateConfig(updates) {
  if (updates.postingProvider) config.postingProvider = updates.postingProvider;
  if (updates.whatsappSelfJid) config.selfJid = updates.whatsappSelfJid;
  if (updates.whatsappSelfLid) config.selfLid = updates.whatsappSelfLid;
  if (updates.bufferApiKey !== undefined) config.bufferApiKey = updates.bufferApiKey;
  if (updates.bufferOrgId !== undefined) config.bufferOrgId = updates.bufferOrgId;
  if (updates.bufferChannelId !== undefined) config.bufferChannelId = updates.bufferChannelId;
  if (updates.catboxUserhash !== undefined) config.catboxUserhash = updates.catboxUserhash;
  if (updates.whatsappGroupName !== undefined) {
    config.groupName = updates.whatsappGroupName ? updates.whatsappGroupName.trim() : null;
    if (!config.groupName) {
      config.groupJid = null;
    }
  }
  if (updates.whatsappGroupJid !== undefined) {
    const raw = updates.whatsappGroupJid?.trim();
    config.groupJid = raw ? (raw.includes('@') ? raw : `${raw}@g.us`) : null;
  }
  if (updates.whatsappGroupAllowAll !== undefined) {
    config.groupAllowAll = Boolean(updates.whatsappGroupAllowAll);
  }
}

/** Check if current config has minimum required values */
export function validateConfig(cfg = config) {
  const missing = [];
  if (!cfg.selfJid) missing.push('WHATSAPP_SELF_JID');
  if (cfg.postingProvider === 'buffer' && !cfg.bufferApiKey) {
    missing.push('BUFFER_API_KEY');
  } else if (cfg.postingProvider === 'graph' && (!cfg.fbPageId || !cfg.fbPageToken)) {
    missing.push('FB_PAGE_ID / FB_PAGE_TOKEN');
  }
  return { valid: missing.length === 0, missing };
}