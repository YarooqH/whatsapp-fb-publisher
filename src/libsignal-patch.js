import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const libsignal = require('libsignal');
const crypto = require('libsignal/src/crypto');
const errors = require('libsignal/src/errors');

let isPatched = false;

/**
 * Apply runtime patches to libsignal to resolve common Baileys / Signal Protocol desync issues:
 *
 * 1. "Over 2000 messages into the future!":
 *    WhatsApp devices increment message ratchets with every chat message. If the bot is closed
 *    or restarted after being offline for a day or two, the phone's message counter drifts ahead.
 *    Original libsignal recursively derivates keys and hard-throws if drift > 2000.
 *    We replace it with an iterative while-loop supporting up to 100,000 steps without call stack overflow.
 *
 * 2. Self-Healing on Corrupted Sessions ("Bad MAC" / "No matching sessions"):
 *    If a session record becomes permanently desynced or corrupted, Baileys originally kept
 *    the broken session on disk, causing all subsequent messages to fail forever.
 *    We automatically purge the corrupted session record from storage so Baileys sends a retry
 *    receipt and executes a clean PreKey re-exchange handshake with WhatsApp.
 */
export function applyLibsignalPatches() {
  if (isPatched) return;
  isPatched = true;

  // 1. Iterative fillMessageKeys supporting large counter gaps
  libsignal.SessionCipher.prototype.fillMessageKeys = function (chain, counter) {
    if (chain.chainKey.counter >= counter) {
      return;
    }
    if (counter - chain.chainKey.counter > 100_000) {
      throw new errors.SessionError('Over 100000 messages into the future!');
    }
    if (chain.chainKey.key === undefined) {
      throw new errors.SessionError('Chain closed');
    }
    while (chain.chainKey.counter < counter) {
      const key = chain.chainKey.key;
      chain.messageKeys[chain.chainKey.counter + 1] = crypto.calculateMAC(key, Buffer.from([1]));
      chain.chainKey.key = crypto.calculateMAC(key, Buffer.from([2]));
      chain.chainKey.counter += 1;
    }
  };

  // 2. Auto-heal on unrecoverable session corruption (Bad MAC or No matching sessions)
  const originalDecryptWhisperMessage = libsignal.SessionCipher.prototype.decryptWhisperMessage;
  libsignal.SessionCipher.prototype.decryptWhisperMessage = async function (data) {
    try {
      return await originalDecryptWhisperMessage.call(this, data);
    } catch (err) {
      const msg = err?.message || String(err);
      if (
        msg.includes('No matching sessions') ||
        msg.includes('Bad MAC') ||
        msg.includes('Over 100000 messages into the future!')
      ) {
        const addrStr = this.addr?.toString ? this.addr.toString() : String(this.addr);
        try {
          console.warn(`[libsignal auto-heal] Purging desynced session record for ${addrStr}: ${msg}`);
          if (typeof this.storage?.removeSession === 'function') {
            await this.storage.removeSession(addrStr);
          } else if (typeof this.storage?.storeSession === 'function') {
            await this.storage.storeSession(addrStr, null);
          }
        } catch (purgeErr) {
          console.error('[libsignal auto-heal] Failed to purge session record:', purgeErr.message);
        }
      }
      throw err;
    }
  };

  console.log('✓ Libsignal auto-recovery patches applied (iterative ratchet + auto-healing session repair).');
}
