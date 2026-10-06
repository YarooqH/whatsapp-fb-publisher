import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { existsSync, rmSync } from 'node:fs';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { config } from './config.js';

const logger = pino({ level: 'silent' });

const whatsappStatus = {
  connection: 'idle',
  selfJidMatches: false,
  lastConnectedAt: null,
  lastDisconnectAt: null,
  lastMessageEventAt: null,
};

let qrCallback = null;
let statusCallback = null;

export function onQr(cb) {
  qrCallback = cb;
}

export function onStatus(cb) {
  statusCallback = cb;
}

function notifyStatus(update = {}) {
  Object.assign(whatsappStatus, update);
  if (statusCallback) statusCallback({ ...whatsappStatus });
}

export function getWhatsAppStatus() {
  return { ...whatsappStatus };
}

/**
 * Start the WhatsApp socket with persistent auth + auto-reconnect.
 * @param {(sock: ReturnType<typeof makeWASocket>) => void} onReady
 * @param {(msg: object) => Promise<void>} onMessage receives each message
 */
export async function startWhatsApp(onMessage) {
  whatsappStatus.connection = 'connecting';
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  // WhatsApp may address the self-chat using the linked account's LID rather
  // than the phone-number JID supplied in WHATSAPP_SELF_JID.
  config.selfLid = state.creds.me?.lid || null;
  const { version } = await fetchLatestBaileysVersion();

  let sock = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  // Create a socket and attach all listeners to that socket. This must happen
  // for every reconnect; Baileys does not carry listeners over to a new socket.
  const connect = () => {
    const nextSock = makeWASocket({
      version,
      auth: state,
      logger,
      // keep the session alive behind NATs / flaky free-tier VMs
      keepAliveIntervalMs: 30_000,
      markOnlineOnConnect: false, // don't show as "online" — stealth mode
      // Keep own-message events enabled so self-chat messages from this linked
      // account are observable by the messages.upsert handler.
      emitOwnEvents: true,
      syncFullHistory: false,
    });
    sock = nextSock;
    let socketOpen = false;
    let socketOpenedAt = 0;

    nextSock.ev.on('creds.update', saveCreds);

    nextSock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log('\n📱 Scan this QR with WhatsApp → Settings → Linked Devices:\n');
        qrcodeTerminal.generate(qr, { small: true });
        QRCode.toDataURL(qr, { margin: 2, scale: 8 })
          .then((dataUrl) => {
            if (qrCallback) qrCallback(qr, dataUrl);
          })
          .catch((err) => console.error('Failed to generate QR data URL:', err));
        notifyStatus({ connection: 'qr_ready' });
      }

      if (connection === 'open') {
        socketOpen = true;
        socketOpenedAt = Math.floor(Date.now() / 1000);
        reconnectAttempts = 0;
        const sessionJid = nextSock.user?.id || '';
        if (!config.selfJid && sessionJid) {
          config.selfJid = sessionJid.replace(/:\d+(?=@)/, '');
        }
        if (nextSock.user?.lid) {
          config.selfLid = nextSock.user.lid.replace(/:\d+(?=@)/, '');
        }
        const configuredJids = [config.selfJid, config.selfLid].filter(Boolean);
        const normalized = (jid) => jid.replace(/:\d+(?=@)/, '');
        const selfJidMatches = configuredJids.some((jid) => normalized(jid) === normalized(sessionJid));
        notifyStatus({
          connection: 'open',
          selfJidMatches,
          accountJid: sessionJid,
          lastConnectedAt: new Date().toISOString(),
        });
        console.log(`✅ WhatsApp connected (self-JID ${selfJidMatches ? 'matches' : 'does not match'} configuration).`);
        if (onReadyCallback) onReadyCallback(nextSock);
      }

      if (connection === 'close') {
        socketOpen = false;
        // Ignore a stale socket if a newer connection has already replaced it.
        if (nextSock !== sock) return;
        notifyStatus({
          connection: 'closed',
          lastDisconnectAt: new Date().toISOString(),
        });

        const statusCode =
          lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : undefined;

        if (statusCode === DisconnectReason.loggedOut) {
          console.warn('⚠️ WhatsApp session logged out or expired. Clearing auth credentials to generate a fresh QR code…');
          notifyStatus({ connection: 'connecting' });
          try {
            if (existsSync(config.authDir)) {
              rmSync(config.authDir, { recursive: true, force: true });
            }
          } catch (e) {
            console.error('Failed to clear auth dir:', e.message);
          }

          // Re-initialize fresh auth state and reconnect to generate a new QR
          setTimeout(async () => {
            try {
              const freshAuth = await useMultiFileAuthState(config.authDir);
              Object.assign(state, freshAuth.state);
              connect();
            } catch (err) {
              console.error('Failed to reset WhatsApp connection:', err.message);
            }
          }, 1000);
          return;
        }

        // Exponential-ish backoff, capped at 60s. Guard against duplicate close
        // events scheduling multiple replacement sockets.
        if (reconnectTimer) return;
        reconnectAttempts += 1;
        const delay = Math.min(reconnectAttempts * 3_000, 60_000);
        console.log(`↻ Disconnected (${statusCode}). Reconnecting in ${delay / 1000}s…`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      }
    });

    nextSock.ev.on('messages.upsert', async ({ messages, type }) => {
      whatsappStatus.lastMessageEventAt = new Date().toISOString();
      console.log(`📥 WhatsApp messages.upsert: ${type || 'unknown'} (${messages.length} message(s))`);

      // Incoming messages use 'notify'. Self-chat messages may use 'append',
      // including when they were sent from another linked device. Only accept
      // recent appends after this socket is open; startup history must not be
      // published.
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages) {
        const timestamp = Number(msg.messageTimestamp || 0);
        if (type === 'append' &&
            (!socketOpen || (timestamp && timestamp < socketOpenedAt - 5))) continue;
        try {
          await onMessage(msg, nextSock);
        } catch (err) {
          console.error('✖ Error handling message:', err.message || err);
        }
      }
    });

    return nextSock;
  };

  sock = connect();
  return sock;
}

// small helper so index.js can run code once the socket is live
let onReadyCallback = null;
export function onReady(cb) {
  onReadyCallback = cb;
}

/** Fetch all participating WhatsApp groups. */
export async function getParticipatingGroups(sock) {
  if (!sock) return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map((g) => ({
      id: g.id,
      subject: g.subject || 'Unnamed Group',
      participantsCount: g.participants?.length || 0,
    }));
  } catch (err) {
    console.error('✖ Failed to fetch groups:', err.message || err);
    return [];
  }
}

/** Search participating WhatsApp groups by name (case-insensitive). */
export async function searchGroups(sock, query = '') {
  if (!sock) return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    const all = Object.values(groups).map((g) => ({
      id: g.id,
      subject: g.subject || 'Unnamed Group',
      participantsCount: g.participants?.length || 0,
    }));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((g) => g.subject.toLowerCase().includes(q));
  } catch (err) {
    console.error('✖ Failed to search groups:', err.message || err);
    return [];
  }
}

/** Disconnect and stop the WhatsApp client. */
export async function stopWhatsApp() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch {}
    sock = null;
  }
  notifyStatus({ connection: 'idle' });
}

export function getSocket() {
  return sock;
}


