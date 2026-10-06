import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { config, updateConfig, validateConfig } from './config.js';
import {
  startWhatsApp,
  stopWhatsApp,
  getWhatsAppStatus,
  onQr,
  onStatus,
  onReady,
  searchGroups,
  getSocket,
} from './whatsapp.js';
import { resolveBufferTarget, getOrganizations, getChannels, publishToBuffer } from './buffer.js';
import { verifySetup, postToPage, postPhotoToPage } from './facebook.js';
import { extractMessageContent, extractText, parseCommand } from './filter.js';
import { uploadImage, deleteCatboxImage } from './media.js';
import { saveDraft } from './drafts.js';

let isRunning = false;
let isPaused = false;
let bufferTarget = null;
let fbPage = null;
let latestQrDataUrl = null;
let activityLogs = [];

const listeners = {
  onQr: null,
  onStatus: null,
  onPost: null,
  onLog: null,
};

const seen = new Set();
const sentMessageIds = new Set();
setInterval(() => {
  seen.clear();
  sentMessageIds.clear();
}, 10 * 60_000).unref();

function addLog(type, message, details = null) {
  const item = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    type, // 'info' | 'success' | 'warning' | 'error'
    message,
    details,
  };
  activityLogs.unshift(item);
  if (activityLogs.length > 50) activityLogs.pop();
  if (listeners.onLog) listeners.onLog(item);
}

const normalizeJid = (jid) => jid?.replace(/:\d+(?=@)/, '');
const configuredSelfJids = (sock) =>
  [
    config.selfJid,
    config.selfLid,
    sock?.user?.id,
    sock?.user?.lid,
  ]
    .filter(Boolean)
    .map(normalizeJid);

function atToDate(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

async function handleMessage(msg, sock) {
  if (isPaused) {
    addLog('warning', 'Message received while publisher is paused — skipped.');
    return;
  }

  const remoteJid = normalizeJid(msg.key.remoteJid);
  const selfJids = configuredSelfJids(sock);
  const destJid = normalizeJid(msg.message?.deviceSentMessage?.destinationJid);
  const isSelfChat = selfJids.includes(remoteJid) || Boolean(destJid && selfJids.includes(destJid));
  const isGroupChat = Boolean(config.groupJid && normalizeJid(config.groupJid) === remoteJid);
  const isAnyGroup = remoteJid?.endsWith('@g.us');

  const participantJid = normalizeJid(
    msg.key.participant || msg.participant || (msg.key.fromMe ? (sock.user?.id || config.selfJid) : null)
  );
  const isOwner = msg.key.fromMe || selfJids.includes(participantJid);

  // Group permission validation
  if (isGroupChat) {
    if (!config.groupAllowAll && !isOwner) {
      addLog('info', `Ignored group message from non-owner (${participantJid}).`);
      return;
    }
  } else if (!isSelfChat) {
    // Unconfigured group probe for #group / #groupid
    if (isAnyGroup && isOwner) {
      const probe = (extractText(msg) || '').trim().toLowerCase();
      if (!probe.startsWith('#group') && !probe.startsWith('#findgroup')) {
        return;
      }
    } else {
      addLog('info', `Ignored message from ${remoteJid || 'unknown'} (only self-chat or configured group are processed).`);
      return;
    }
  }

  if (msg.key.id && (seen.has(msg.key.id) || sentMessageIds.has(msg.key.id))) return;

  const content = extractMessageContent(msg);
  if (!content) return;
  if (msg.key.id) seen.add(msg.key.id);

  const text = content.text;
  const isImage = content.isImage;
  const { action, payload, at } = parseCommand(text, isImage);
  addLog('info', `Received WhatsApp ${isGroupChat ? 'group' : 'self-chat'} ${isImage ? 'image' : 'message'}: ${action}`);

  const reply = async (t) => {
    const selfTarget = config.selfJid || (sock.user?.id ? normalizeJid(sock.user.id) : null);
    const targetJid = isSelfChat && remoteJid?.endsWith('@lid') && selfTarget ? selfTarget : remoteJid;
    let sent;
    try {
      sent = await sock.sendMessage(targetJid, { text: t });
    } catch (err) {
      if (targetJid !== remoteJid) {
        sent = await sock.sendMessage(remoteJid, { text: t });
      } else {
        throw err;
      }
    }
    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
      seen.add(sent.key.id);
    }
    return sent;
  };

  switch (action) {
    case 'post': {
      try {
        let imageUrl = null;
        let imageBuffer = null;

        if (isImage) {
          addLog('info', 'Downloading image from WhatsApp…');
          imageBuffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { reuploadRequest: sock.updateMediaMessage }
          );
          addLog('info', 'Hosting image for Facebook/Buffer delivery…');
          imageUrl = await uploadImage(imageBuffer, content.rawImage?.mimetype || 'image/jpeg', config.catboxUserhash);

          if (config.catboxUserhash && imageUrl) {
            setTimeout(async () => {
              try {
                const ok = await deleteCatboxImage(imageUrl, config.catboxUserhash);
                if (ok) {
                  addLog('info', `Temporary image auto-deleted from Catbox (${imageUrl.split('/').pop()}).`);
                }
              } catch (err) {
                console.warn('Failed to auto-delete Catbox image:', err.message);
              }
            }, 10 * 60_000).unref();
          }
        }

        if (config.postingProvider === 'buffer') {
          if (!bufferTarget?.channel) {
            throw new Error('Buffer target not configured or not yet resolved');
          }
          const dueAt = at ? atToDate(at) : new Date(Date.now() + 5 * 60_000);
          const post = await publishToBuffer(payload, {
            channelId: bufferTarget.channel.id,
            dueAt,
            imageUrl,
          });
          const timeStr = dueAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          addLog(
            'success',
            `${isImage ? 'Photo' : 'Post'} scheduled on Buffer channel "${bufferTarget.channel.name}" at ${timeStr}`
          );
          await reply(
            `🚀 Scheduled ${isImage ? 'photo ' : ''}with Buffer → "${bufferTarget.channel.name}" at ${timeStr}\n🆔 ${post.id}`
          );
        } else {
          let id;
          if (isImage && imageBuffer) {
            const result = await postPhotoToPage(imageBuffer, payload);
            id = result.id;
          } else {
            const result = await postToPage(payload);
            id = result.id;
          }
          addLog('success', `${isImage ? 'Photo' : 'Post'} published to Facebook Page (${id})`);
          await reply(`✅ Posted ${isImage ? 'photo ' : ''}to Facebook\n🔗 facebook.com/${config.fbPageId}/posts/${(id || '').split('_')[1] || id}\n🆔 ${id}`);
        }
      } catch (err) {
        addLog('error', `Publish failed: ${err.message}`);
        await reply(`❌ ${isImage ? 'Photo publish' : 'Post'} failed:\n${err.message}`);
      }
      break;
    }

    case 'groups': {
      try {
        const matches = await searchGroups(sock, payload?.trim());
        if (payload?.trim()) {
          if (!matches.length) {
            await reply(`🔍 No WhatsApp groups found matching "${payload}".`);
          } else {
            const list = matches.slice(0, 8).map((g) => `• *${g.subject}*\n  ID: \`${g.id}\``).join('\n');
            await reply(`🔍 *Matching Groups:*\n${list}`);
          }
        } else {
          await reply(`👥 You are in ${matches.length} groups. Send \`#group <name>\` to search.`);
        }
      } catch (err) {
        await reply(`❌ Group search error: ${err.message}`);
      }
      break;
    }

    case 'groupid': {
      if (isAnyGroup) {
        await reply(`📌 *Group ID:* \`${remoteJid}\``);
      }
      break;
    }

    case 'draft': {
      const n = saveDraft(payload);
      addLog('info', `Saved draft #${n}`);
      await reply(`📝 Saved as draft #${n} (not published).`);
      break;
    }

    case 'ping': {
      await reply(`🏓 pong — publisher is ${isPaused ? 'PAUSED' : 'ACTIVE'} ✓`);
      break;
    }

    case 'help': {
      await reply(
        '🤖 *WhatsApp → Facebook Publisher*\n' +
        '• Plain text → schedule via Buffer / post\n' +
        '• #at 18:00 <text> → schedule at time\n' +
        '• #group <name> → find group ID\n' +
        '• #draft <text> → save draft\n' +
        '• #ping → status check'
      );
      break;
    }
  }
}

/** Start the background publisher worker */
export async function startPublisher(options = {}) {
  Object.assign(listeners, options);

  onQr((qr, dataUrl) => {
    latestQrDataUrl = dataUrl;
    if (listeners.onQr) listeners.onQr(qr, dataUrl);
  });

  onStatus((status) => {
    if (status.connection === 'open') {
      latestQrDataUrl = null;
    }
    if (listeners.onStatus) listeners.onStatus(getPublisherStatus());
  });

  onReady(async (sock) => {
    addLog('success', 'WhatsApp socket connected and ready.');

    // Auto-resolve group name if specified
    if (config.groupName && !config.groupJid) {
      try {
        const matches = await searchGroups(sock, config.groupName);
        const match =
          matches.find((g) => g.subject.toLowerCase() === config.groupName.toLowerCase()) ||
          matches[0];
        if (match) {
          config.groupJid = match.id;
          addLog('info', `Resolved group "${config.groupName}" to ${match.id}`);
        }
      } catch (err) {
        addLog('warning', `Could not auto-resolve group name: ${err.message}`);
      }
    }

    // Resolve Buffer target if Buffer API key is configured
    if (config.postingProvider === 'buffer' && config.bufferApiKey) {
      try {
        bufferTarget = await resolveBufferTarget();
        addLog('success', `Buffer connected: "${bufferTarget.channel.name}" (${bufferTarget.channel.service})`);
      } catch (err) {
        addLog('warning', `Buffer verification failed: ${err.message}`);
      }
    }

    if (listeners.onStatus) listeners.onStatus(getPublisherStatus());
  });

  isRunning = true;
  addLog('info', 'Starting WhatsApp client…');
  await startWhatsApp(handleMessage);
}

/** Stop the background publisher */
export async function stopPublisher() {
  isRunning = false;
  await stopWhatsApp();
  addLog('info', 'Publisher stopped.');
}

/** Pause or resume publishing */
export function setPublisherPaused(paused) {
  isPaused = paused;
  addLog('info', `Publisher is now ${isPaused ? 'PAUSED' : 'RESUMED'}.`);
  if (listeners.onStatus) listeners.onStatus(getPublisherStatus());
}

export function isPublisherPaused() {
  return isPaused;
}

/** Test Buffer API Key and return channels */
export async function testBufferKey(apiKey) {
  const orgs = await getOrganizations(apiKey);
  if (!orgs.length) throw new Error('No organizations found on this Buffer account.');
  const channels = await getChannels(orgs[0].id, apiKey);
  const fbChannels = channels.filter((c) => c.service === 'facebook');
  return {
    organization: orgs[0],
    facebookChannels: fbChannels,
    allChannels: channels,
  };
}

/** Fetch WhatsApp groups on demand */
export async function fetchGroups(query = '') {
  const sock = getSocket();
  if (!sock) return [];
  return searchGroups(sock, query);
}

/** Get consolidated health & configuration status */
export function getPublisherStatus() {
  const wa = getWhatsAppStatus();
  return {
    isRunning,
    isPaused,
    whatsapp: {
      connection: wa.connection, // 'idle' | 'connecting' | 'qr_ready' | 'open' | 'closed' | 'logged_out'
      selfJid: config.selfJid || wa.accountJid || null,
      qrDataUrl: latestQrDataUrl,
      lastConnectedAt: wa.lastConnectedAt,
    },
    buffer: {
      isReady: Boolean(bufferTarget?.channel),
      channelName: bufferTarget?.channel?.name || null,
      channelId: bufferTarget?.channel?.id || null,
      orgName: bufferTarget?.org?.name || null,
    },
    destination: {
      type: config.groupJid || config.groupName ? 'group' : 'self',
      groupName: config.groupName || null,
      groupJid: config.groupJid || null,
      groupAllowAll: config.groupAllowAll,
    },
    activityLogs,
  };
}
