/**
 * Upload an image buffer to public storage so Buffer/Facebook can fetch it.
 * Uses Catbox API. If a userhash is provided, uploads under that account so it can be auto-deleted.
 *
 * @param {Buffer} buffer
 * @param {string} mimetype e.g. 'image/jpeg' | 'image/png'
 * @param {string} [userhash] optional Catbox userhash for account tracking & auto-deletion
 * @returns {Promise<string>} Direct public image URL
 */
export async function uploadImage(buffer, mimetype = 'image/jpeg', userhash = '') {
  const ext = mimetype.includes('png') ? 'png' : 'jpg';
  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  if (userhash) {
    formData.append('userhash', userhash);
  }
  formData.append('fileToUpload', new Blob([buffer], { type: mimetype }), `photo.${ext}`);

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Media host HTTP error ${res.status}`);
  }

  const url = (await res.text()).trim();
  if (!url.startsWith('http')) {
    throw new Error(`Media host upload failed: ${url}`);
  }

  return url;
}

/**
 * Permanently delete a file from Catbox using its userhash.
 *
 * @param {string} url The uploaded image URL (e.g. https://files.catbox.moe/abc123.jpg)
 * @param {string} userhash The Catbox account hash
 * @returns {Promise<boolean>}
 */
export async function deleteCatboxImage(url, userhash) {
  if (!userhash || !url) return false;
  const filename = url.split('/').pop();
  if (!filename) return false;

  const formData = new FormData();
  formData.append('reqtype', 'deletefiles');
  formData.append('userhash', userhash);
  formData.append('files', filename);

  try {
    const res = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: formData,
    });
    return res.ok;
  } catch (err) {
    console.warn(`Failed to delete Catbox file ${filename}:`, err.message);
    return false;
  }
}
