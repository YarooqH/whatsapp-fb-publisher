/**
 * Message filtering + command parsing.
 *
 * Design: the WhatsApp self-chat ("Message Yourself") is the trigger surface.
 * Every *text* message you drop there is intended for publishing unless it
 * starts with a command prefix (#...).
 */

export const COMMANDS = {
  help: '#help',
  draft: '#draft', // save without publishing
  del: '#delete', // #delete <postId> → remove a published post (Graph mode)
  profiles: '#profiles', // list connected Facebook pages
  groups: '#groups', // list participating WhatsApp groups & IDs
  groupid: '#groupid', // show the current group's ID
  at: '#at', // #at HH:MM <text> → schedule (Buffer mode)
  ping: '#ping',
};

/**
 * Unwrap containers Baileys uses for messages sent by another linked device
 * and for ephemeral/view-once messages. Self-chat messages commonly arrive
 * inside `deviceSentMessage` when sent from WhatsApp Web or the phone.
 */
function unwrapMessageContent(message) {
  let current = message;
  for (let i = 0; i < 5; i += 1) {
    const nested =
      current?.deviceSentMessage?.message ||
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.viewOnceMessageV2Extension?.message ||
      current?.documentWithCaptionMessage?.message ||
      current?.editedMessage?.message;
    if (!nested) return current;
    current = nested;
  }
  return current;
}

/** Extract content (text or image) from a Baileys message. */
export function extractMessageContent(msg) {
  if (!msg?.message) return null;
  const m = unwrapMessageContent(msg.message);

  // Ignore pure control messages early
  if (m.protocolMessage || m.reactionMessage || m.pollUpdateMessage) return null;

  const isImage = Boolean(m.imageMessage);
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    '';

  if (!text && !isImage) return null;

  return {
    text: text.trim(),
    isImage,
    rawImage: m.imageMessage || null,
  };
}

/** Extract plain text from a Baileys message. */
export function extractText(msg) {
  const content = extractMessageContent(msg);
  return content?.text || null;
}

/**
 * Parse a self-chat message into an action.
 * @param {string} rawText
 * @param {boolean} [isImage=false]
 * @returns {{action:'post'|'draft'|'delete'|'profiles'|'help'|'ping'|'ignore', payload?:string, at?:string}}
 */
export function parseCommand(rawText = '', isImage = false) {
  const text = (rawText || '').trim();
  if (!text) {
    return isImage ? { action: 'post', payload: '' } : { action: 'ignore' };
  }

  const lower = text.toLowerCase();

  // Exact commands
  if (lower === COMMANDS.help) return { action: 'help' };
  if (lower === COMMANDS.ping) return { action: 'ping' };
  if (lower === COMMANDS.profiles) return { action: 'profiles' };
  if (lower === COMMANDS.groupid || lower === '#group-id') return { action: 'groupid' };

  // #groups or #group [search-query]
  const groupMatch = text.match(/^#(?:groups?|findgroup)(?:\s+(.+))?$/i);
  if (groupMatch) {
    const query = groupMatch[1]?.trim() || '';
    return { action: 'groups', payload: query };
  }

  // #draft rest-of-text → store only
  if (lower.startsWith(COMMANDS.draft + ' ')) {
    const payload = text.slice(COMMANDS.draft.length).trim();
    return payload ? { action: 'draft', payload } : { action: 'ignore' };
  }

  // #delete <postId>
  if (lower.startsWith(COMMANDS.del + ' ')) {
    const postId = text.slice(COMMANDS.del.length).trim();
    return postId ? { action: 'delete', payload: postId } : { action: 'ignore' };
  }

  // #at HH:MM <text> → publish at a specific local time (Buffer mode)
  const atMatch = text.match(/^#at\s+(\d{1,2}:\d{2})\s+([\s\S]+)$/i);
  if (atMatch) {
    const [hh, mm] = atMatch[1].split(':').map(Number);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return { action: 'post', payload: atMatch[2].trim(), at: atMatch[1] };
    }
    return { action: 'ignore' }; // malformed time — don't publish by accident
  }

  // Starts with #at but no valid time → never publish silently
  if (lower.startsWith('#at')) return { action: 'ignore' };

  // Plain message → publish
  return { action: 'post', payload: text };
}