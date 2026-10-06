const API_BASE = 'http://127.0.0.1:41738';

let appState = {
  status: null,
  settings: null,
  selectedChannelId: null,
};

// ── DOM References ───────────────────────────────────────────────────────────
const el = {
  statusPill: document.getElementById('global-status-pill'),
  statusText: document.getElementById('global-status-text'),
  tabs: document.querySelectorAll('.tab-btn'),
  panes: document.querySelectorAll('.tab-pane'),

  // Step 1: WhatsApp
  qrLoadingBox: document.getElementById('qr-loading-box'),
  qrImageBox: document.getElementById('qr-image-box'),
  qrImg: document.getElementById('qr-img'),
  waConnectedBox: document.getElementById('wa-connected-box'),
  waConnectedJid: document.getElementById('wa-connected-jid'),
  btnRelinkWa: document.getElementById('btn-relink-wa'),

  // Step 2: Buffer
  bufferApiKey: document.getElementById('buffer-api-key'),
  btnTestBuffer: document.getElementById('btn-test-buffer'),
  linkGetBuffer: document.getElementById('link-get-buffer'),
  bufferChannelsContainer: document.getElementById('buffer-channels-container'),
  selectBufferChannel: document.getElementById('select-buffer-channel'),
  bufferChannelInfo: document.getElementById('buffer-channel-info'),

  // Step 3: Destination
  destTypeRadios: document.querySelectorAll('input[name="dest-type"]'),
  groupConfigPanel: document.getElementById('group-config-panel'),
  groupNameInput: document.getElementById('group-name-input'),
  btnSearchGroups: document.getElementById('btn-search-groups'),
  groupAllowAll: document.getElementById('group-allow-all'),

  // Step 4: Preferences
  checkAutostart: document.getElementById('check-autostart'),
  btnSaveAll: document.getElementById('btn-save-all'),

  // Settings Tab
  settingsSelfJid: document.getElementById('settings-self-jid'),
  settingsBufferKey: document.getElementById('settings-buffer-key'),
  settingsGroupName: document.getElementById('settings-group-name'),
  settingsCatboxUserhash: document.getElementById('settings-catbox-userhash'),
  settingsAutostart: document.getElementById('settings-autostart'),
  btnSaveSettingsTab: document.getElementById('btn-save-settings-tab'),
  btnPauseToggle: document.getElementById('btn-pause-toggle'),
  btnMinimizeNow: document.getElementById('btn-minimize-now'),

  // Logs Tab
  logFeed: document.getElementById('log-feed'),
  logCount: document.getElementById('log-count'),
};

// ── Tab Navigation ───────────────────────────────────────────────────────────
el.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    el.tabs.forEach((t) => t.classList.remove('active'));
    el.panes.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// ── Destination Radio Switcher ───────────────────────────────────────────────
el.destTypeRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.radio-card').forEach((card) => {
      card.classList.toggle('selected', card.querySelector('input').checked);
    });
    el.groupConfigPanel.classList.toggle('hidden', radio.value !== 'group');
  });
});

// ── Link External Clicker ────────────────────────────────────────────────────
el.linkGetBuffer.addEventListener('click', (e) => {
  e.preventDefault();
  const url = 'https://publish.buffer.com';
  if (window.__TAURI__?.opener?.openUrl) {
    window.__TAURI__.opener.openUrl(url);
  } else {
    window.open(url, '_blank');
  }
});

// ── Status Rendering ─────────────────────────────────────────────────────────
function updateStatusBadge(status) {
  if (!status) return;

  const isPaused = status.isPaused;
  const wa = status.whatsapp || {};
  const buf = status.buffer || {};

  el.statusPill.className = 'status-pill';

  if (isPaused) {
    el.statusPill.classList.add('status-waiting');
    el.statusText.textContent = 'Service Paused';
    el.btnPauseToggle.textContent = 'Resume Publishing';
  } else if (wa.connection === 'open') {
    el.statusPill.classList.add('status-online');
    el.statusText.textContent = buf.channelName
      ? `Posting to "${buf.channelName}"`
      : 'WhatsApp Active';
    el.btnPauseToggle.textContent = 'Pause Publishing';
  } else if (wa.qrDataUrl || wa.connection === 'qr_ready') {
    el.statusPill.classList.add('status-waiting');
    el.statusText.textContent = 'Scan QR Code';
  } else if (wa.connection === 'connecting') {
    el.statusPill.classList.add('status-waiting');
    el.statusText.textContent = 'Connecting WhatsApp…';
  } else {
    el.statusPill.classList.add('status-offline');
    el.statusText.textContent = 'Disconnected';
  }

  // WhatsApp Card UI
  if (wa.connection === 'open') {
    el.qrLoadingBox.classList.add('hidden');
    el.qrImageBox.classList.add('hidden');
    el.waConnectedBox.classList.remove('hidden');
    el.waConnectedJid.textContent = `Linked as ${wa.selfJid || 'Account Verified'}`;
    el.settingsSelfJid.value = wa.selfJid || '';
  } else if (wa.qrDataUrl) {
    el.qrLoadingBox.classList.add('hidden');
    el.qrImageBox.classList.remove('hidden');
    el.waConnectedBox.classList.add('hidden');
    el.qrImg.src = wa.qrDataUrl;
  } else {
    el.qrLoadingBox.classList.remove('hidden');
    el.qrImageBox.classList.add('hidden');
    el.waConnectedBox.classList.add('hidden');
  }

  updateSetupProgress(wa, buf);
}

/** Mark finished setup steps and advance the progress bar. */
function updateSetupProgress(wa, buf) {
  const waDone = wa.connection === 'open';
  const bufferDone = Boolean(buf.isReady);

  document.getElementById('step-card-1')?.classList.toggle('done', waDone);
  document.getElementById('step-card-2')?.classList.toggle('done', bufferDone);

  const bar = document.getElementById('setup-progress-bar');
  if (bar) {
    const done = Number(waDone) + Number(bufferDone);
    bar.style.width = `${done * 50}%`;
  }
}

// ── Log Rendering ────────────────────────────────────────────────────────────
const seenLogIds = new Set();

function addLogEntry(item) {
  if (!item) return;
  const logId = item.id || `${item.time}-${item.message}`;
  if (seenLogIds.has(logId)) return;
  seenLogIds.add(logId);

  const empty = el.logFeed.querySelector('.empty-log');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'log-item';
  row.innerHTML = `
    <span class="log-time">[${item.time}]</span>
    <span class="log-badge ${item.type}">${item.type}</span>
    <span class="log-msg">${escapeHtml(item.message)}</span>
  `;

  el.logFeed.insertBefore(row, el.logFeed.firstChild);
  const count = el.logFeed.querySelectorAll('.log-item').length;
  el.logCount.textContent = `${count} event${count === 1 ? '' : 's'}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── API Interactions ─────────────────────────────────────────────────────────

let initialSettingsRendered = false;

async function fetchStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      appState.status = data.status;
      appState.settings = data.settings;
      renderInitialSettings(data.settings);
      updateStatusBadge(data.status);
      if (data.status.activityLogs) {
        // reverse so oldest to newest insertion keeps correct order
        [...data.status.activityLogs].reverse().forEach((log) => addLogEntry(log));
      }
    }
  } catch (err) {
    console.warn('Publisher service not reached yet:', err.message);
    el.statusText.textContent = 'Starting service…';
  } finally {
    const isWaConnected = appState.status?.whatsapp?.connection === 'open';
    const interval = isWaConnected ? 6000 : 1500;
    setTimeout(fetchStatus, interval);
  }
}

function renderInitialSettings(settings) {
  if (!settings || initialSettingsRendered) return;
  initialSettingsRendered = true;
  if (settings.bufferApiKey) {
    el.bufferApiKey.value = settings.bufferApiKey;
    el.settingsBufferKey.value = settings.bufferApiKey;
  }
  if (settings.whatsappGroupName) {
    el.groupNameInput.value = settings.whatsappGroupName;
    el.settingsGroupName.value = settings.whatsappGroupName;
    const groupRadio = document.querySelector('input[name="dest-type"][value="group"]');
    if (groupRadio) {
      groupRadio.checked = true;
      groupRadio.dispatchEvent(new Event('change'));
    }
  }
  if (settings.whatsappGroupAllowAll) {
    el.groupAllowAll.checked = true;
  }
  if (settings.openAtLogin !== undefined) {
    el.checkAutostart.checked = settings.openAtLogin;
    el.settingsAutostart.checked = settings.openAtLogin;
  }
  if (settings.catboxUserhash) {
    el.settingsCatboxUserhash.value = settings.catboxUserhash;
  }
}

// Test Buffer Key button
el.btnTestBuffer.addEventListener('click', async () => {
  const key = el.bufferApiKey.value.trim();
  if (!key) {
    alert('Please enter a Buffer API key first.');
    return;
  }
  el.btnTestBuffer.disabled = true;
  el.btnTestBuffer.textContent = 'Verifying…';

  try {
    const res = await fetch(`${API_BASE}/api/test-buffer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    el.selectBufferChannel.innerHTML = '';
    const fb = data.facebookChannels || [];
    if (!fb.length) {
      alert('Connected to Buffer, but no Facebook Page was found! Connect a Facebook Page in your Buffer dashboard first.');
      return;
    }

    fb.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.service})`;
      el.selectBufferChannel.appendChild(opt);
    });

    el.bufferChannelsContainer.classList.remove('hidden');
    el.bufferChannelInfo.textContent = `✓ Connected to organization "${data.organization.name}".`;
    appState.selectedChannelId = fb[0].id;
    appState.selectedOrgId = data.organization.id;
  } catch (err) {
    alert(`Buffer connection failed:\n${err.message}`);
  } finally {
    el.btnTestBuffer.disabled = false;
    el.btnTestBuffer.textContent = 'Test & Connect';
  }
});

// Search Groups button
el.btnSearchGroups.addEventListener('click', async () => {
  const q = el.groupNameInput.value.trim();
  el.btnSearchGroups.disabled = true;
  el.btnSearchGroups.textContent = 'Searching…';

  try {
    const res = await fetch(`${API_BASE}/api/groups?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (data.groups && data.groups.length) {
      const names = data.groups.map((g) => `• "${g.subject}" (${g.participantsCount} members)`).join('\n');
      alert(`Found matching groups:\n${names}`);
      el.groupNameInput.value = data.groups[0].subject;
    } else {
      alert(`No groups found matching "${q}". Check spelling or create the group on your phone first.`);
    }
  } catch (err) {
    alert(`Failed to search groups: ${err.message}`);
  } finally {
    el.btnSearchGroups.disabled = false;
    el.btnSearchGroups.textContent = 'Search';
  }
});

// Save all settings & minimize
async function saveAllSettings() {
  const destType = document.querySelector('input[name="dest-type"]:checked')?.value || 'self';
  const newSettings = {
    postingProvider: 'buffer',
    bufferApiKey: el.bufferApiKey.value.trim(),
    bufferOrgId: appState.selectedOrgId || appState.settings?.bufferOrgId || null,
    bufferChannelId: el.selectBufferChannel.value || appState.settings?.bufferChannelId || null,
    whatsappGroupName: destType === 'group' ? el.groupNameInput.value.trim() : '',
    whatsappGroupAllowAll: destType === 'group' ? el.groupAllowAll.checked : false,
    catboxUserhash: el.settingsCatboxUserhash ? el.settingsCatboxUserhash.value.trim() : (appState.settings?.catboxUserhash || ''),
    openAtLogin: el.checkAutostart.checked,
  };

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    });
    const data = await res.json();
    if (data.success) {
      appState.settings = data.settings;
      // If running inside Tauri, minimize window to tray
      if (window.__TAURI__?.window) {
        const win = window.__TAURI__.window.getCurrentWindow();
        await win.hide();
      } else {
        alert('Settings saved! WhatsApp Publisher is running in the background.');
      }
    }
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  }
}

el.btnSaveAll.addEventListener('click', saveAllSettings);
el.btnSaveSettingsTab.addEventListener('click', () => {
  el.bufferApiKey.value = el.settingsBufferKey.value;
  el.groupNameInput.value = el.settingsGroupName.value;
  el.checkAutostart.checked = el.settingsAutostart.checked;
  saveAllSettings();
});

// Pause / Resume Toggle
el.btnPauseToggle.addEventListener('click', async () => {
  try {
    const res = await fetch(`${API_BASE}/api/pause`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      if (appState.status) {
        appState.status.isPaused = data.isPaused;
        updateStatusBadge(appState.status);
      }
    }
  } catch (err) {
    console.error('Pause toggle failed:', err);
  }
});

// Minimize to Tray button
el.btnMinimizeNow.addEventListener('click', async () => {
  if (window.__TAURI__?.window) {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.hide();
  } else {
    alert('Minimize to tray is active in desktop app.');
  }
});

// Re-link WhatsApp
el.btnRelinkWa.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to disconnect and link a new WhatsApp number?')) return;
  try {
    await fetch(`${API_BASE}/api/relink`, { method: 'POST' });
    el.waConnectedBox.classList.add('hidden');
    el.qrLoadingBox.classList.remove('hidden');
  } catch (err) {
    alert(`Failed to relink: ${err.message}`);
  }
});

// ── Real-time Server-Sent Events (SSE) ─────────────────────────────────────────
function setupEventStream() {
  const source = new EventSource(`${API_BASE}/api/events`);

  source.addEventListener('qr', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.dataUrl) {
        el.qrLoadingBox.classList.add('hidden');
        el.qrImageBox.classList.remove('hidden');
        el.waConnectedBox.classList.add('hidden');
        el.qrImg.src = data.dataUrl;
        el.statusPill.className = 'status-pill status-waiting';
        el.statusText.textContent = 'Scan QR Code';
      }
    } catch {}
  });

  source.addEventListener('status', (e) => {
    try {
      const status = JSON.parse(e.data);
      appState.status = status;
      updateStatusBadge(status);
    } catch {}
  });

  source.addEventListener('log', (e) => {
    try {
      const log = JSON.parse(e.data);
      addLogEntry(log);
    } catch {}
  });

  source.onerror = () => {
    source.close();
    setTimeout(setupEventStream, 3000);
  };
}

// Initialize
fetchStatus();
setupEventStream();
