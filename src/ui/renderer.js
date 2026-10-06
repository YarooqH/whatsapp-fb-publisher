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
  groupSearchFeedback: document.getElementById('group-search-feedback'),
  groupSelectContainer: document.getElementById('group-select-container'),
  selectMatchedGroup: document.getElementById('select-matched-group'),
  groupAllowAll: document.getElementById('group-allow-all'),

  // Step 4: Preferences
  checkAutostart: document.getElementById('check-autostart'),
  btnSaveAll: document.getElementById('btn-save-all'),

  // Settings Tab
  settingsSelfJid: document.getElementById('settings-self-jid'),
  btnSettingsUnlinkWa: document.getElementById('btn-settings-unlink-wa'),
  settingsBufferKey: document.getElementById('settings-buffer-key'),
  settingsBufferStatus: document.getElementById('settings-buffer-status'),
  settingsGroupName: document.getElementById('settings-group-name'),
  settingsGroupStatus: document.getElementById('settings-group-status'),
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

  if (buf.isReady && el.settingsBufferStatus) {
    el.settingsBufferStatus.textContent = `✓ Active channel: "${buf.channelName}"${buf.orgName ? ` (${buf.orgName})` : ''}`;
    el.settingsBufferStatus.className = 'helper-text success-text';
  }

  const dest = status.destination || {};
  if (dest.type === 'group' && dest.groupName && el.settingsGroupStatus) {
    el.settingsGroupStatus.textContent = dest.groupJid
      ? `✓ Active group: "${dest.groupName}"`
      : `Searching for group "${dest.groupName}"…`;
    el.settingsGroupStatus.className = dest.groupJid ? 'helper-text success-text' : 'helper-text';
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
    verifyAndConnectBuffer(settings.bufferApiKey, false, settings.bufferChannelId);
  }
  if (settings.whatsappGroupName) {
    el.groupNameInput.value = settings.whatsappGroupName;
    el.settingsGroupName.value = settings.whatsappGroupName;
    appState.selectedGroupName = settings.whatsappGroupName;
    appState.selectedGroupJid = settings.whatsappGroupJid || null;
    const groupRadio = document.querySelector('input[name="dest-type"][value="group"]');
    if (groupRadio) {
      groupRadio.checked = true;
      groupRadio.dispatchEvent(new Event('change'));
    }
    searchAndDisplayGroups(settings.whatsappGroupName);
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

/** Verify Buffer key, populate channels, update UI and optionally auto-save */
async function verifyAndConnectBuffer(key, autoSave = false, preferredChannelId = null) {
  if (!key) return false;
  if (autoSave) {
    el.btnTestBuffer.disabled = true;
    el.btnTestBuffer.textContent = 'Verifying…';
  }

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
      if (autoSave) {
        alert('Connected to Buffer, but no Facebook Page was found! Connect a Facebook Page in your Buffer dashboard first.');
      }
      return false;
    }

    fb.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.service})`;
      el.selectBufferChannel.appendChild(opt);
    });

    const targetChannelId = preferredChannelId && fb.some((c) => c.id === preferredChannelId)
      ? preferredChannelId
      : fb[0].id;

    el.selectBufferChannel.value = targetChannelId;
    el.bufferChannelsContainer.classList.remove('hidden');

    const activeChannel = fb.find((c) => c.id === targetChannelId) || fb[0];
    el.bufferChannelInfo.textContent = `✓ Connected to "${data.organization.name}" → ${activeChannel.name}`;

    if (el.settingsBufferStatus) {
      el.settingsBufferStatus.textContent = `✓ Connected to "${data.organization.name}" (${activeChannel.name})`;
      el.settingsBufferStatus.className = 'helper-text success-text';
    }

    appState.selectedChannelId = targetChannelId;
    appState.selectedOrgId = data.organization.id;

    document.getElementById('step-card-2')?.classList.add('done');
    const waDone = appState.status?.whatsapp?.connection === 'open';
    const bar = document.getElementById('setup-progress-bar');
    if (bar) bar.style.width = `${(Number(waDone) + 1) * 50}%`;

    if (autoSave) {
      // Auto-persist immediately so user never loses their credentials
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postingProvider: 'buffer',
          bufferApiKey: key,
          bufferOrgId: data.organization.id,
          bufferChannelId: targetChannelId,
        }),
      });
      el.settingsBufferKey.value = key;
    }

    return true;
  } catch (err) {
    if (autoSave) {
      alert(`Buffer connection failed:\n${err.message}`);
    }
    return false;
  } finally {
    if (autoSave) {
      el.btnTestBuffer.disabled = false;
      el.btnTestBuffer.textContent = 'Test & Connect';
    }
  }
}

// Test Buffer Key button
el.btnTestBuffer.addEventListener('click', async () => {
  const key = el.bufferApiKey.value.trim();
  if (!key) {
    alert('Please enter a Buffer API key first.');
    return;
  }
  await verifyAndConnectBuffer(key, true);
});

// Auto-save when user chooses a different Facebook Page
el.selectBufferChannel.addEventListener('change', async () => {
  const newChannelId = el.selectBufferChannel.value;
  appState.selectedChannelId = newChannelId;
  const key = el.bufferApiKey.value.trim();
  if (key && appState.selectedOrgId) {
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bufferApiKey: key,
          bufferOrgId: appState.selectedOrgId,
          bufferChannelId: newChannelId,
        }),
      });
    } catch {}
  }
});

// Search and display WhatsApp groups
async function searchAndDisplayGroups(query = '') {
  const q = String(query || el.groupNameInput.value || '').trim();
  if (el.btnSearchGroups) {
    el.btnSearchGroups.disabled = true;
    el.btnSearchGroups.textContent = 'Searching…';
  }
  if (el.groupSearchFeedback) {
    el.groupSearchFeedback.className = 'helper-text';
    el.groupSearchFeedback.textContent = 'Searching participating WhatsApp groups…';
  }

  try {
    const res = await fetch(`${API_BASE}/api/groups?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const groups = data.groups || [];

    if (groups.length > 0) {
      if (el.selectMatchedGroup) {
        el.selectMatchedGroup.innerHTML = '';
        groups.forEach((g) => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `${g.subject} (${g.participantsCount} members)`;
          el.selectMatchedGroup.appendChild(opt);
        });
      }

      // Exact match or first match
      const matched = groups.find((g) => g.subject.toLowerCase() === q.toLowerCase()) || groups[0];
      if (el.selectMatchedGroup) el.selectMatchedGroup.value = matched.id;
      appState.selectedGroupJid = matched.id;
      appState.selectedGroupName = matched.subject;
      el.groupNameInput.value = matched.subject;
      el.settingsGroupName.value = matched.subject;

      if (el.groupSelectContainer) el.groupSelectContainer.classList.remove('hidden');
      if (el.groupSearchFeedback) {
        el.groupSearchFeedback.className = 'helper-text success-text';
        el.groupSearchFeedback.textContent = `✓ Linked to group "${matched.subject}" (${matched.participantsCount} members)`;
      }
      if (el.settingsGroupStatus) {
        el.settingsGroupStatus.className = 'helper-text success-text';
        el.settingsGroupStatus.textContent = `✓ Linked to group "${matched.subject}"`;
      }
    } else {
      if (el.groupSelectContainer) el.groupSelectContainer.classList.add('hidden');
      if (el.groupSearchFeedback) {
        el.groupSearchFeedback.className = 'helper-text';
        el.groupSearchFeedback.textContent = q
          ? `No groups found matching "${q}". Check spelling or send a message in that group on your phone first.`
          : 'No participating groups found.';
      }
    }
  } catch (err) {
    if (el.groupSearchFeedback) {
      el.groupSearchFeedback.className = 'helper-text';
      el.groupSearchFeedback.textContent = `Failed to search groups: ${err.message}`;
    }
  } finally {
    if (el.btnSearchGroups) {
      el.btnSearchGroups.disabled = false;
      el.btnSearchGroups.textContent = 'Search';
    }
  }
}

// Search Groups button
el.btnSearchGroups.addEventListener('click', () => {
  searchAndDisplayGroups(el.groupNameInput.value.trim());
});

// Dropdown group selection change
el.selectMatchedGroup?.addEventListener('change', () => {
  const selectedId = el.selectMatchedGroup.value;
  const opt = el.selectMatchedGroup.options[el.selectMatchedGroup.selectedIndex];
  const subject = opt ? opt.textContent.replace(/\s\(\d+\smembers\)$/, '') : '';

  appState.selectedGroupJid = selectedId;
  appState.selectedGroupName = subject;
  el.groupNameInput.value = subject;
  el.settingsGroupName.value = subject;

  if (el.groupSearchFeedback) {
    el.groupSearchFeedback.className = 'helper-text success-text';
    el.groupSearchFeedback.textContent = `✓ Linked to group "${subject}"`;
  }
  if (el.settingsGroupStatus) {
    el.settingsGroupStatus.className = 'helper-text success-text';
    el.settingsGroupStatus.textContent = `✓ Linked to group "${subject}"`;
  }
});

// Save all settings & minimize
async function saveAllSettings() {
  const destType = document.querySelector('input[name="dest-type"]:checked')?.value || 'self';
  const groupName = destType === 'group' ? (el.groupNameInput.value.trim() || appState.selectedGroupName || '') : '';
  const groupJid = destType === 'group' ? (appState.selectedGroupJid || appState.settings?.whatsappGroupJid || null) : null;

  const newSettings = {
    postingProvider: 'buffer',
    bufferApiKey: el.bufferApiKey.value.trim(),
    bufferOrgId: appState.selectedOrgId || appState.settings?.bufferOrgId || null,
    bufferChannelId: el.selectBufferChannel.value || appState.selectedChannelId || appState.settings?.bufferChannelId || null,
    whatsappGroupName: groupName,
    whatsappGroupJid: groupJid,
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

// Unlink WhatsApp (from Setup card or Settings tab)
async function handleUnlinkWhatsApp(triggerBtn) {
  const confirmed = confirm(
    'Are you sure you want to unlink this WhatsApp account?\n\n' +
    'This will securely log out the companion session from WhatsApp servers, ' +
    'remove all saved credentials, and generate a new QR code to link a different account.'
  );
  if (!confirmed) return;

  const originalText = triggerBtn ? triggerBtn.textContent : 'Unlink';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = 'Unlinking…';
  }

  try {
    const res = await fetch(`${API_BASE}/api/relink`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Server error');

    // Reset WhatsApp UI state
    el.waConnectedBox.classList.add('hidden');
    el.qrLoadingBox.classList.remove('hidden');
    el.qrImageBox.classList.add('hidden');
    el.settingsSelfJid.value = '';
    el.waConnectedJid.textContent = '';
    document.getElementById('step-card-1')?.classList.remove('done');

    // Switch to Setup tab so user sees the new QR code
    el.tabs.forEach((t) => t.classList.remove('active'));
    el.panes.forEach((p) => p.classList.remove('active'));
    const setupTab = document.querySelector('.tab-btn[data-tab="tab-setup"]');
    const setupPane = document.getElementById('tab-setup');
    if (setupTab) setupTab.classList.add('active');
    if (setupPane) setupPane.classList.add('active');
  } catch (err) {
    alert(`Failed to unlink WhatsApp: ${err.message}`);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
    }
  }
}

el.btnRelinkWa?.addEventListener('click', (e) => handleUnlinkWhatsApp(e.currentTarget));
el.btnSettingsUnlinkWa?.addEventListener('click', (e) => handleUnlinkWhatsApp(e.currentTarget));

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
