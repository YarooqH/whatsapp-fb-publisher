import { createServer } from 'node:http';
import { parse } from 'node:url';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

import { config, updateConfig, setAuthDir } from './config.js';
import { loadSettings, saveSettings, setStorageDir, getStorageDir } from './store.js';
import {
  startPublisher,
  stopPublisher,
  getPublisherStatus,
  setPublisherPaused,
  isPublisherPaused,
  testBufferKey,
  fetchGroups,
  refreshBufferTarget,
  unlinkWhatsApp,
  resolveGroupByName,
  refreshGroupTarget,
} from './worker.js';

// If storage dir argument is provided (e.g. by Tauri via app_data_dir)
const customDir = process.env.PUBLISHER_DATA_DIR;
if (customDir) {
  setStorageDir(customDir);
  setAuthDir(join(customDir, 'auth_info_baileys'));
  const loaded = loadSettings();
  updateConfig({
    postingProvider: loaded.postingProvider,
    whatsappSelfJid: loaded.whatsappSelfJid,
    whatsappSelfLid: loaded.whatsappSelfLid,
    whatsappGroupName: loaded.whatsappGroupName,
    whatsappGroupJid: loaded.whatsappGroupJid,
    whatsappGroupAllowAll: loaded.whatsappGroupAllowAll,
    bufferApiKey: loaded.bufferApiKey,
    bufferOrgId: loaded.bufferOrgId,
    bufferChannelId: loaded.bufferChannelId,
    catboxUserhash: loaded.catboxUserhash,
  });
}

const PORT = Number(process.env.PUBLISHER_PORT || 41738);
const sseClients = new Set();

function broadcastEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.end();
  }

  try {
    // Real-time Event Stream (SSE)
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('\n');
      sseClients.add(res);

      // Send initial status
      res.write(`event: status\ndata: ${JSON.stringify(getPublisherStatus())}\n\n`);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // Status & Configuration
    if (pathname === '/api/status' && req.method === 'GET') {
      const status = getPublisherStatus();
      const settings = loadSettings();
      return sendJson(res, 200, { success: true, status, settings });
    }

    // Save Settings
    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await parseJsonBody(req);

      // Auto-resolve group JID if group name was provided without a JID
      if (body.whatsappGroupName && !body.whatsappGroupJid) {
        const resolved = await resolveGroupByName(body.whatsappGroupName);
        if (resolved) {
          body.whatsappGroupJid = resolved.id;
          body.whatsappGroupName = resolved.subject;
        }
      } else if (!body.whatsappGroupName) {
        body.whatsappGroupJid = null;
      }

      const saved = saveSettings(body);
      updateConfig({
        postingProvider: saved.postingProvider,
        whatsappSelfJid: saved.whatsappSelfJid || config.selfJid,
        whatsappSelfLid: saved.whatsappSelfLid || config.selfLid,
        whatsappGroupName: saved.whatsappGroupName,
        whatsappGroupJid: saved.whatsappGroupJid,
        whatsappGroupAllowAll: saved.whatsappGroupAllowAll,
        bufferApiKey: saved.bufferApiKey,
        bufferOrgId: saved.bufferOrgId,
        bufferChannelId: saved.bufferChannelId,
        catboxUserhash: saved.catboxUserhash,
      });

      await refreshGroupTarget();
      await refreshBufferTarget();

      broadcastEvent('status', getPublisherStatus());
      return sendJson(res, 200, { success: true, settings: saved });
    }

    // Test Buffer Key
    if (pathname === '/api/test-buffer' && req.method === 'POST') {
      const { apiKey } = await parseJsonBody(req);
      if (!apiKey) return sendJson(res, 400, { success: false, error: 'API key is required' });
      const result = await testBufferKey(apiKey);
      return sendJson(res, 200, { success: true, ...result });
    }

    // Search WhatsApp Groups
    if (pathname === '/api/groups' && req.method === 'GET') {
      const q = String(query.q || '');
      const groups = await fetchGroups(q);
      return sendJson(res, 200, { success: true, groups });
    }

    // Pause / Resume Toggle
    if (pathname === '/api/pause' && req.method === 'POST') {
      const current = isPublisherPaused();
      setPublisherPaused(!current);
      broadcastEvent('status', getPublisherStatus());
      return sendJson(res, 200, { success: true, isPaused: !current });
    }

    // Relink / Unlink WhatsApp (logout companion device, purge session, and show new QR)
    if (pathname === '/api/relink' && req.method === 'POST') {
      try {
        await unlinkWhatsApp();
        await startPublisher({
          onQr: (_qr, dataUrl) => broadcastEvent('qr', { dataUrl }),
          onStatus: (status) => broadcastEvent('status', status),
          onLog: (log) => broadcastEvent('log', log),
        });
        broadcastEvent('status', getPublisherStatus());
        return sendJson(res, 200, { success: true });
      } catch (err) {
        console.error('Relink error:', err);
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    // Health check
    if (pathname === '/health' || pathname === '/') {
      return sendJson(res, 200, { ok: true, port: PORT });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(`API Error [${pathname}]:`, err.message);
    return sendJson(res, 500, { success: false, error: err.message });
  }
});

// Start the server and worker
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`🌐 Publisher Service running on http://127.0.0.1:${PORT}`);

  try {
    await startPublisher({
      onQr: (_qr, dataUrl) => broadcastEvent('qr', { dataUrl }),
      onStatus: (status) => broadcastEvent('status', status),
      onLog: (log) => broadcastEvent('log', log),
    });
  } catch (err) {
    console.error('Failed to start publisher worker:', err.message);
  }
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Publisher service…');
  await stopPublisher();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  await stopPublisher();
  server.close(() => process.exit(0));
});
