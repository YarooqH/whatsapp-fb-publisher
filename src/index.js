import { createServer } from 'node:http';
import { config } from './config.js';
import { startWhatsApp, onReady, getWhatsAppStatus, searchGroups } from './whatsapp.js';
import { verifySetup, postToPage, deletePost } from './facebook.js';
import { getChannels, publishToBuffer, resolveBufferTarget } from './buffer.js';
import { extractText, parseCommand, COMMANDS } from './filter.js';
import { saveDraft } from './drafts.js';

const PROVIDER_IS_BUFFER = config.postingProvider === 'buffer';
const DEFAULT_DELAY_MINUTES = 5;

const HELP_TEXT = [
  '🤖 *WhatsApp → Facebook Page*',
  `Provider: ${PROVIDER_IS_BUFFER ? '*Buffer*' : '*Graph API*'}`,
  '',
  `• Plain text → ${PROVIDER_IS_BUFFER ? `scheduled via Buffer in ${DEFAULT_DELAY_MINUTES} minutes` : 'posts now'}`, 
  `• ${COMMANDS.at} 18:00 <text> → schedule (Buffer mode only)`,
  `• ${COMMANDS.profiles} → list connected Facebook pages`,
  `• ${COMMANDS.groups} <name> → search group by name & get ID`,
  `• ${COMMANDS.groupid} → get current group's ID (inside group)`,
  `• ${COMMANDS.draft} <text> → save as draft (not published)`,
  `• ${COMMANDS.del} <postId> → delete a post (Graph mode only)`,
  `• ${COMMANDS.ping} → check I'm alive`,
  `• ${COMMANDS.help} → this menu`,
].join('\n');

/** Compute a due-at Date from "HH:MM" (local time; rolls to tomorrow if in the past). */
function atToDate(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

const normalizeJid = (jid) => jid?.replace(/:\d+(?=@)/, '');
const maskJid = (jid) => {
  if (!jid) return 'unknown';
  const [local, domain = '?'] = jid.split('@');
  return `${local.slice(-4)}@${domain}`;
};
const configuredSelfJids = (sock) =>
  [
    config.selfJid,
    config.selfLid,
    sock?.user?.id,
    sock?.user?.lid,
  ]
    .filter(Boolean)
    .map(normalizeJid);

// Resolved at startup: Graph → page info; Buffer → org/channel target
let fbPage = null;
let bufferTarget = null;

async function handleMessage(msg, sock) {
  // ── Destination checks ──
  const remoteJid = normalizeJid(msg.key.remoteJid);
  const selfJids = configuredSelfJids(sock);
  const destJid = normalizeJid(msg.message?.deviceSentMessage?.destinationJid);
  const isSelfChat = selfJids.includes(remoteJid) || Boolean(destJid && selfJids.includes(destJid));
  const isGroupChat = Boolean(config.groupJid && normalizeJid(config.groupJid) === remoteJid);
  const isAnyGroup = remoteJid?.endsWith('@g.us');

  // Identify sender identity and ownership
  const participantJid = normalizeJid(
    msg.key.participant || msg.participant || (msg.key.fromMe ? (sock.user?.id || config.selfJid) : null)
  );
  const isOwner = msg.key.fromMe || selfJids.includes(participantJid);

  // If message is in an unconfigured group, allow ONLY discovery commands (#group, #groups, #groupid) from the owner
  if (!isSelfChat && !isGroupChat) {
    if (!isAnyGroup || !isOwner) return;
    const probeText = extractText(msg)?.trim().toLowerCase();
    if (!probeText?.startsWith('#group') && !probeText?.startsWith('#findgroup')) {
      return;
    }
  }

  // If in a configured group chat, enforce sender permission policy
  if (isGroupChat) {
    if (!config.groupAllowAll && !isOwner) {
      console.log(`↩ Ignored message in group from ${maskJid(participantJid)} (only owner allowed; set WHATSAPP_GROUP_ALLOW_ALL=true to allow all).`);
      return;
    }
  }

  if (msg.key.id && (seen.has(msg.key.id) || sentMessageIds.has(msg.key.id))) return;

  const text = extractText(msg);
  if (!text) {
    console.log(`↩ Ignored message with unsupported content: ${Object.keys(msg.message || {}).join(', ') || 'none'}`);
    return;
  }
  if (msg.key.id) seen.add(msg.key.id);

  const { action, payload, at } = parseCommand(text);
  console.log(`📨 Message received (${isGroupChat ? 'group' : 'self-chat'}) → ${action}`);
  const reply = async (t) => {
    // Reply back to the chat where the message originated
    const sent = await sock.sendMessage(remoteJid, { text: t });
    // Track reply ID to avoid loopback feedback in self-chat or group
    if (sent?.key?.id) {
      sentMessageIds.add(sent.key.id);
      seen.add(sent.key.id);
    }
    return sent;
  };

  switch (action) {
    case 'post': {
      try {
        if (PROVIDER_IS_BUFFER) {
          // Plain Buffer posts are intentionally delayed by five minutes so
          // there is a short cancellation window before they are published.
          const dueAt = at
            ? atToDate(at)
            : new Date(Date.now() + DEFAULT_DELAY_MINUTES * 60_000);
          const post = await publishToBuffer(payload, {
            channelId: bufferTarget.channel.id,
            dueAt,
          });
          console.log(`✅ Buffer post created: ${post.id}`);
          const human = (dueAt ?? new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const [h, m] = at?.split(':') ?? [human.slice(0, 2), human.slice(3, 5)];
          await reply(
            at
              ? `🚀 Scheduled with Buffer → "${bufferTarget.channel.name}" at ${h}:${m}\n🆔 ${post.id}`
              : `🚀 Scheduled with Buffer → "${bufferTarget.channel.name}" in ${DEFAULT_DELAY_MINUTES} minutes (at ${h}:${m})\n🆔 ${post.id}`
          );
        } else {
          // Graph API mode — #at scheduling unsupported
          if (at) {
            await reply(`😕 Scheduling needs Buffer mode — set POSTING_PROVIDER=buffer in .env. Posted immediately instead:`);
          }
          const { id } = await postToPage(payload);
          await reply(`✅ Posted to Facebook\n🔗 facebook.com/${config.fbPageId}/posts/${id.split('_')[1]}\n🆔 ${id}`);
        }
      } catch (err) {
        console.error('✖ Publish failed:', err.message);
        await reply(`❌ Post failed:\n${err.message}`);
      }
      break;
    }

    case 'profiles': {
      try {
        if (PROVIDER_IS_BUFFER) {
          const channels = await getChannels(bufferTarget.org.id);
          const fb = channels.filter((c) => c.service === 'facebook');
          const others = channels.filter((c) => c.service !== 'facebook');
          const lines = [
            `📡 *Buffer connections — org "${bufferTarget.org.name}"*`,
            `Facebook pages (${fb.length}):`,
            ...(fb.length ? fb.map((c) => `• ${c.name} — \`${c.id}\``) : ['• (none)']),
            ...(others.length ? [`Other channels: ${others.map((c) => `${c.service} (${c.name})`).join(', ')}`] : []),
            ...(config.bufferChannelId ? ['', `Active channel: \`${config.bufferChannelId}\``] : ['', 'Tip: set BUFFER_CHANNEL_ID in .env to pin one.']),
          ];
          await reply(lines.join('\n'));
        } else {
          await reply(
            fbPage
              ? `📄 Posting via Graph API → Page "${fbPage.name}" (${fbPage.id})`
              : '📄 Graph API mode (Page info unavailable)'
          );
        }
      } catch (err) {
        await reply(`❌ ${err.message}`);
      }
      break;
    }

    case 'groups': {
      const query = payload?.trim() || '';
      try {
        const matches = await searchGroups(sock, query);
        if (query) {
          if (!matches.length) {
            await reply(
              `🔍 No WhatsApp groups found matching "${query}".\n` +
              `Tip: Check spelling or try a shorter search word.`
            );
          } else {
            const display = matches.slice(0, 10);
            const lines = [
              `🔍 *Found ${matches.length} group(s) matching "${query}":*`,
              ...display.map((g) => {
                const isActive = config.groupJid && normalizeJid(config.groupJid) === normalizeJid(g.id);
                return `• *${g.subject}* ${isActive ? '⭐ *(active)*' : ''}\n  ID: \`${g.id}\` (${g.participantsCount} members)`;
              }),
              ...(matches.length > 10 ? [`_…and ${matches.length - 10} more. Refine your search to narrow down._`] : []),
              '',
              'To use a group, set in `.env`:\n`WHATSAPP_GROUP_JID=<id>`\nor:\n`WHATSAPP_GROUP_NAME="<group name>"`',
            ];
            await reply(lines.join('\n'));
          }
        } else {
          // If no query was given and they are in many groups, prompt them to search instead of dumping all of them
          if (matches.length > 8) {
            await reply(
              `👥 You are in ${matches.length} groups.\n\n` +
              `To find your group without flooding the chat, search by name:\n` +
              `*#group <name>*\n\n` +
              `Example: \`#group Facebook Posts\` or \`#group marketing\``
            );
          } else if (!matches.length) {
            await reply('👥 No WhatsApp groups found for this account.');
          } else {
            const lines = [
              '👥 *WhatsApp Groups:*',
              ...matches.map((g) => {
                const isActive = config.groupJid && normalizeJid(config.groupJid) === normalizeJid(g.id);
                return `• *${g.subject}* ${isActive ? '⭐ *(active)*' : ''}\n  ID: \`${g.id}\``;
              }),
              '',
              'Tip: You can search anytime with `#group <name>`.',
            ];
            await reply(lines.join('\n'));
          }
        }
      } catch (err) {
        await reply(`❌ Failed to search groups: ${err.message}`);
      }
      break;
    }

    case 'groupid': {
      if (isAnyGroup) {
        await reply(
          `📌 *Group ID:* \`${remoteJid}\`\n\n` +
          `To use this group for Facebook publishing, add to your \`.env\`:\n` +
          `\`WHATSAPP_GROUP_JID=${remoteJid}\``
        );
      } else {
        await reply(
          'ℹ️ Send `#groupid` inside any WhatsApp group to get its ID, or send `#groups` to view all groups.'
        );
      }
      break;
    }

    case 'draft': {
      const n = saveDraft(payload);
      await reply(`📝 Saved as draft #${n} (not published).`);
      break;
    }

    case 'delete': {
      if (PROVIDER_IS_BUFFER) {
        await reply('🗑️ Deleting via the API is not supported in Buffer mode — remove the post in the Buffer dashboard.');
        break;
      }
      try {
        await deletePost(payload);
        await reply(`🗑️ Deleted post ${payload}`);
      } catch (err) {
        await reply(`❌ Delete failed:\n${err.message}`);
      }
      break;
    }

    case 'help':
      await reply(HELP_TEXT);
      break;

    case 'ping':
      await reply('🏓 pong — pipeline is up ✓');
      break;

    default:
      break; // 'ignore'
  }
}

// de-dup guard: Baileys can deliver the same message id more than once
const seen = new Set();
// Self-chat replies can also appear in messages.upsert. Track them separately
// so the bot does not publish its own confirmations as new posts.
const sentMessageIds = new Set();
setInterval(() => {
  seen.clear();
  sentMessageIds.clear();
}, 10 * 60_000).unref(); // reset every 10 min

async function main() {
  // ── Verify the posting provider before touching WhatsApp ──
  if (PROVIDER_IS_BUFFER) {
    console.log('🔎 Verifying Buffer API key…');
    bufferTarget = await resolveBufferTarget();
    console.log(
      `✅ Buffer OK → org "${bufferTarget.org.name}" / channel "${bufferTarget.channel.name}" (facebook)`
    );
  } else {
    console.log('🔎 Verifying Facebook token + page…');
    fbPage = await verifySetup();
    console.log(`✅ Facebook OK → Page: "${fbPage.name}" (${fbPage.fan_count ?? '?'} likes)`);
  }

  console.log('📱 Starting WhatsApp…');
  onReady(async (sock) => {
    const target = PROVIDER_IS_BUFFER ? `"${bufferTarget.channel.name}"` : `"${fbPage.name}"`;
    console.log(`\nReady. Drop a message in your self-chat → it lands on ${target}.`);

    // Auto-resolve WHATSAPP_GROUP_NAME if groupJid is not explicitly set
    if (config.groupName && !config.groupJid) {
      try {
        const matches = await searchGroups(sock, config.groupName);
        const exact =
          matches.find((g) => g.subject.toLowerCase() === config.groupName.toLowerCase()) ||
          matches[0];
        if (exact) {
          config.groupJid = exact.id;
          console.log(`👥 Resolved WHATSAPP_GROUP_NAME "${config.groupName}" → "${exact.subject}" (${exact.id})`);
        } else {
          console.warn(`⚠️ Could not find group matching "${config.groupName}". Send "#group ${config.groupName}" in WhatsApp.`);
        }
      } catch (err) {
        console.error('✖ Failed to auto-resolve group name:', err.message);
      }
    }

    if (config.groupJid) {
      console.log(`👥 Group chat listening on: ${config.groupJid} (Allow all senders: ${config.groupAllowAll})`);
    } else {
      console.log('💡 Tip: Set WHATSAPP_GROUP_NAME / WHATSAPP_GROUP_JID in .env, or send "#group <name>" in WhatsApp to get an ID.');
    }

    console.log(`Send "${COMMANDS.help}" for commands.\n`);
  });

  await startWhatsApp(handleMessage);

  // Optional health endpoint for hosting platforms. Unlike the old unconditional
  // "ok" response, this reports whether WhatsApp is actually open and identified
  // as the configured account.
  if (config.port) {
    createServer((req, res) => {
      if (req.url !== '/' && req.url !== '/health') {
        res.statusCode = 404;
        return res.end('not found');
      }

      const whatsapp = getWhatsAppStatus();
      const healthy =
        whatsapp.connection === 'open' &&
        whatsapp.selfJidMatches &&
        (!PROVIDER_IS_BUFFER || Boolean(bufferTarget));
      const body = {
        status: healthy ? 'ok' : 'not_ready',
        provider: config.postingProvider,
        whatsapp: {
          ...whatsapp,
          groupJid: config.groupJid,
          groupAllowAll: config.groupAllowAll,
        },
        buffer: PROVIDER_IS_BUFFER
          ? {
              ready: Boolean(bufferTarget),
              channel: bufferTarget?.channel.name ?? null,
            }
          : undefined,
      };

      res.statusCode = healthy ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    }).listen(config.port, () =>
      console.log(`❤️  Health endpoint on :${config.port} (GET /health)`)
    );
  }
}

main().catch((err) => {
  console.error('✖ Fatal:', err.message || err);
  process.exit(1);
});