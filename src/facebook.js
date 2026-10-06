import { config } from './config.js';

const GRAPH = `https://graph.facebook.com/${config.fbApiVersion}`;

/**
 * Post a text status update to the Page feed.
 * @returns {Promise<{id: string}>} the new post id ({page-id}_{post-id})
 */
export async function postToPage(message) {
  const res = await fetch(`${GRAPH}/${config.fbPageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      access_token: config.fbPageToken,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || JSON.stringify(data);
    throw new Error(`Graph API ${res.status}: ${err}`);
  }
  return data; // { id: "<page>_<post>" }
}

/**
 * Post a photo to the Page.
 * @param {Buffer|Blob} imageBuffer
 * @param {string} [caption='']
 * @returns {Promise<{id: string}>}
 */
export async function postPhotoToPage(imageBuffer, caption = '') {
  const form = new FormData();
  form.append('access_token', config.fbPageToken);
  form.append('caption', caption);
  form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'photo.jpg');

  const res = await fetch(`${GRAPH}/${config.fbPageId}/photos`, {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!res.ok) {
    const err = data?.error?.message || JSON.stringify(data);
    throw new Error(`Graph API ${res.status}: ${err}`);
  }
  return data;
}

/** Delete a post you previously created (for the #delete command). */
export async function deletePost(postId) {
  const url = new URL(`${GRAPH}/${postId}`);
  url.searchParams.set('access_token', config.fbPageToken);
  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Graph API ${res.status}: ${data?.error?.message || 'unknown error'}`);
  }
  return true;
}

/**
 * Validate the token on startup so you fail fast with a clear message
 * instead of silently dying on the first real message.
 */
export async function verifySetup() {
  const url = new URL(`${GRAPH}/${config.fbPageId}`);
  url.searchParams.set('fields', 'name,fan_count');
  url.searchParams.set('access_token', config.fbPageToken);

  let res, data;
  try {
    res = await fetch(url);
    data = await res.json();
  } catch (e) {
    throw new Error(`Cannot reach Graph API: ${e.message}`);
  }

  if (!res.ok || data?.error) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(
      `Facebook token/Page check failed → ${msg}\n` +
        `  • Is FB_PAGE_TOKEN a PAGE token (not a user token)?\n` +
        `  • Is it long-lived? (short-lived ones die in ~1-2h)\n` +
        `  • Does this account still admin the page ${config.fbPageId}?`
    );
  }
  return data; // { name, fan_count }
}
