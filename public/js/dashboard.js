function syncMotionPanel(root) {
    const select = root.querySelector('.motion-source-select');
    if (!select) return;
    const mode = select.value;

    root.querySelectorAll('[data-show-for]').forEach(el => {
        const modes = el.dataset.showFor.split(/\s+/);
        el.classList.toggle('hidden', !modes.includes(mode));
    });
}

function initMotionOptions() {
    document.querySelectorAll('[data-motion-root]').forEach(root => {
        const select = root.querySelector('.motion-source-select');
        if (!select) return;
        const sync = () => syncMotionPanel(root);
        select.addEventListener('change', sync);
        sync();
    });
}

function initCameraProviderWizard() {
    const tabs = document.querySelectorAll('.camera-provider-tab');
    const panels = document.querySelectorAll('[data-provider-panel]');
    const statusEl = document.getElementById('provider-discover-status');
    const resultsEl = document.getElementById('provider-discover-results');
    const addSourceInput = document.getElementById('add-source');
    const nameInput = document.getElementById('add-name');
    const rtspInput = document.getElementById('add-rtsp');
    const rtspHint = document.getElementById('add-rtsp-hint');
    const usernameInput = document.getElementById('add-username');
    const passwordInput = document.getElementById('add-password');
    const onvifInput = document.getElementById('add-onvif');
    const motionSelect = document.getElementById('add-motion');
    const motionHint = document.getElementById('add-motion-hint');
    const manufacturerInput = document.getElementById('add-manufacturer');
    const modelInput = document.getElementById('add-model');
    const protectHostInput = document.getElementById('add-protect-host');
    const protectCamInput = document.getElementById('add-protect-cam');
    const reolinkChInput = document.getElementById('add-reolink-ch');
    const form = document.getElementById('add-camera-form');

    if (!tabs.length || !form) return;

    let activeProvider = 'unifi-protect';
    let lastCredentials = {};

    function setActiveProvider(providerId) {
        activeProvider = providerId;
        tabs.forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.provider === providerId);
        });
        panels.forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.providerPanel !== providerId);
        });
        if (addSourceInput) addSourceInput.value = providerId;
        if (statusEl) {
            statusEl.classList.add('hidden');
            statusEl.textContent = '';
        }
        if (resultsEl) {
            resultsEl.classList.add('hidden');
            resultsEl.innerHTML = '';
        }
        if (providerId === 'manual' && rtspHint) {
            rtspHint.textContent = 'Paste the RTSP or RTSPS URL from your camera documentation.';
        } else if (rtspHint) {
            rtspHint.textContent = 'Select a camera above — the stream URL is filled automatically.';
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => setActiveProvider(tab.dataset.provider || 'manual'));
    });

    function getCredentials(providerId) {
        switch (providerId) {
            case 'unifi-protect':
                return {
                    host: document.getElementById('unifi-host')?.value?.trim() || '',
                    username: document.getElementById('unifi-user')?.value?.trim() || '',
                    password: document.getElementById('unifi-pass')?.value || '',
                };
            case 'reolink':
                return {
                    host: document.getElementById('reolink-host')?.value?.trim() || '',
                    username: document.getElementById('reolink-user')?.value?.trim() || '',
                    password: document.getElementById('reolink-pass')?.value || '',
                };
            case 'tapo-sonoff':
                return {
                    host: document.getElementById('tapo-host')?.value?.trim() || '',
                    username: document.getElementById('tapo-user')?.value?.trim() || '',
                    password: document.getElementById('tapo-pass')?.value || '',
                };
            case 'onvif':
                return {
                    username: document.getElementById('onvif-scan-user')?.value?.trim() || '',
                    password: document.getElementById('onvif-scan-pass')?.value || '',
                };
            default:
                return {};
        }
    }

    function applyResolvedDraft(draft, label) {
        if (nameInput) nameInput.value = draft.name || label || '';
        if (rtspInput) rtspInput.value = draft.rtspUrl || '';
        if (usernameInput) usernameInput.value = draft.username || '';
        if (passwordInput) passwordInput.value = draft.password || '';
        if (onvifInput) onvifInput.value = draft.onvifUrl || '';
        if (manufacturerInput) manufacturerInput.value = draft.manufacturer || '';
        if (modelInput) modelInput.value = draft.model || '';
        if (protectHostInput) protectHostInput.value = draft.protectHost || '';
        if (protectCamInput) protectCamInput.value = draft.protectCameraId || '';
        if (reolinkChInput && draft.reolinkChannel !== undefined) {
            reolinkChInput.value = String(draft.reolinkChannel);
        }
        if (motionSelect) {
            motionSelect.value = draft.suggestedMotionSource || 'auto';
            motionSelect.dispatchEvent(new Event('change'));
        }
        if (motionHint && draft.suggestedMotionReason) {
            motionHint.textContent = `Suggested: ${draft.suggestedMotionReason}`;
        }
        if (addSourceInput && draft.addSource) addSourceInput.value = draft.addSource;
        if (statusEl) {
            statusEl.textContent = `Loaded ${draft.name || label}. Review name and click Add Camera.`;
            statusEl.classList.remove('hidden');
        }
    }

    async function resolveDevice(providerId, device, creds) {
        const body = {
            deviceId: device.id,
            payload: device.payload,
            host: creds.host,
            username: creds.username,
            password: creds.password,
        };

        const response = await fetch(`/api/camera-providers/${encodeURIComponent(providerId)}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const draft = await response.json();
        if (!response.ok) {
            throw new Error(draft.error || response.statusText);
        }
        applyResolvedDraft(draft, device.label);
    }

    function renderDeviceList(providerId, devices) {
        if (!resultsEl || !statusEl) return;

        if (!devices.length) {
            statusEl.textContent = 'No new cameras found (all may already be added).';
            statusEl.classList.remove('hidden');
            resultsEl.classList.add('hidden');
            return;
        }

        statusEl.textContent = `Found ${devices.length} camera(s). Click Use to fill the form.`;
        statusEl.classList.remove('hidden');
        resultsEl.classList.remove('hidden');
        resultsEl.innerHTML = '';

        const list = document.createElement('ul');
        list.className = 'provider-device-list';

        for (const device of devices) {
            const item = document.createElement('li');
            item.className = 'provider-device-item';
            item.innerHTML = `
                <div class="provider-device-info">
                    <strong>${escapeHtml(device.label)}</strong>
                    ${device.detail ? `<span class="provider-device-detail">${escapeHtml(device.detail)}</span>` : ''}
                </div>
                <button type="button" class="btn btn-sm btn-use-device">Use</button>
            `;

            item.querySelector('.btn-use-device')?.addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                btn.textContent = 'Loading…';
                statusEl.textContent = `Connecting to ${device.label}…`;

                try {
                    await resolveDevice(providerId, device, lastCredentials);
                } catch (err) {
                    statusEl.textContent = `Failed: ${err.message}`;
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Use';
                }
            });

            list.appendChild(item);
        }

        resultsEl.appendChild(list);
    }

    async function maybeSaveProtectController(creds) {
        const save = document.getElementById('unifi-save-controller')?.checked;
        if (!save || !creds.host || !creds.username) return;
        await fetch('/api/settings/protect-controller', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(creds),
        });
    }

    function unifiRequestBody(creds) {
        return {
            ...creds,
            saveController: document.getElementById('unifi-save-controller')?.checked ?? false,
        };
    }

    async function runUnifiImportAll(btn) {
        const creds = getCredentials('unifi-protect');
        if (!creds.host || !creds.username) {
            if (statusEl) {
                statusEl.textContent = 'Enter controller host and username (or save them in Options).';
                statusEl.classList.remove('hidden');
            }
            return;
        }

        if (!confirm('Import every new Protect camera into this bridge? The bridge may restart once when commissioned.')) {
            return;
        }

        btn.disabled = true;
        if (statusEl) {
            statusEl.textContent = 'Importing cameras from UniFi Protect…';
            statusEl.classList.remove('hidden');
        }

        try {
            const response = await fetch('/api/camera-providers/unifi-protect/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(unifiRequestBody(creds)),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.statusText);

            const errCount = data.errors?.length ?? 0;
            let msg = `Imported ${data.count} camera(s).`;
            if (errCount) msg += ` ${errCount} failed.`;
            if (statusEl) statusEl.textContent = msg;

            if (data.count > 0) {
                setTimeout(() => { window.location.reload(); }, 1500);
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = `Import failed: ${err.message}`;
        } finally {
            btn.disabled = false;
        }
    }

    async function runUnifiSyncExisting(btn) {
        const creds = getCredentials('unifi-protect');
        if (!creds.host || !creds.username) {
            if (statusEl) {
                statusEl.textContent = 'Enter controller host and username (or save them in Options).';
                statusEl.classList.remove('hidden');
            }
            return;
        }

        btn.disabled = true;
        if (statusEl) {
            statusEl.textContent = 'Matching existing cameras to Protect…';
            statusEl.classList.remove('hidden');
        }

        try {
            const response = await fetch('/api/camera-providers/unifi-protect/sync-existing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(unifiRequestBody(creds)),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.statusText);

            const linked = data.updated?.length ?? 0;
            const skipped = data.skipped?.length ?? 0;
            if (statusEl) {
                statusEl.textContent = `Linked ${linked} camera(s) to Protect (${skipped} skipped). Reload to see motion changes.`;
            }
            if (linked > 0) {
                setTimeout(() => { window.location.reload(); }, 1200);
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = `Link failed: ${err.message}`;
        } finally {
            btn.disabled = false;
        }
    }

    document.getElementById('unifi-import-all-btn')?.addEventListener('click', (e) => {
        runUnifiImportAll(e.currentTarget);
    });

    document.getElementById('unifi-sync-existing-btn')?.addEventListener('click', (e) => {
        runUnifiSyncExisting(e.currentTarget);
    });

    document.querySelectorAll('.provider-discover-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const providerId = btn.dataset.provider || activeProvider;
            const creds = getCredentials(providerId);
            lastCredentials = creds;

            if (providerId === 'reolink' || providerId === 'tapo-sonoff') {
                if (!creds.host || !creds.username) {
                    if (statusEl) {
                        statusEl.textContent = 'Enter host and username first.';
                        statusEl.classList.remove('hidden');
                    }
                    return;
                }
            } else if (providerId === 'onvif') {
                if (!creds.username) {
                    if (statusEl) {
                        statusEl.textContent = 'Enter ONVIF username before scanning.';
                        statusEl.classList.remove('hidden');
                    }
                    return;
                }
            }

            btn.disabled = true;
            if (statusEl) {
                statusEl.textContent = providerId === 'onvif'
                    ? 'Scanning LAN for ONVIF cameras (5s)…'
                    : 'Connecting…';
                statusEl.classList.remove('hidden');
            }
            if (resultsEl) {
                resultsEl.classList.add('hidden');
                resultsEl.innerHTML = '';
            }

            try {
                const body = { ...creds, timeoutMs: 5000 };
                const response = await fetch(`/api/camera-providers/${encodeURIComponent(providerId)}/discover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || response.statusText);
                }
                if (providerId === 'unifi-protect') {
                    await maybeSaveProtectController(creds);
                }
                renderDeviceList(providerId, data.devices || []);
            } catch (err) {
                if (statusEl) statusEl.textContent = `Failed: ${err.message}`;
            } finally {
                btn.disabled = false;
            }
        });
    });

    form.addEventListener('submit', () => {
        if (activeProvider === 'manual' && addSourceInput) {
            addSourceInput.value = 'manual';
        }
    });

    setActiveProvider('unifi-protect');
}

function initCameraPreviews() {
    const REFRESH_MS = 30_000;
    const SNAPSHOT_TIMEOUT_MS = 25_000;
    const STAGGER_MS = 400;
    const cards = [...document.querySelectorAll('.camera-card')];

    async function refreshCard(card) {
        const id = card.dataset.cameraId;
        const img = card.querySelector('.camera-preview-img');
        const placeholder = card.querySelector('.camera-preview-placeholder');
        const badge = card.querySelector('.camera-status-badge');
        if (!id || !img || !badge) return;

        badge.textContent = 'Checking…';
        badge.className = 'camera-status-badge camera-status-badge--checking';
        img.classList.remove('is-loaded');
        placeholder?.classList.remove('hidden');

        const url = `/api/cameras/${encodeURIComponent(id)}/snapshot?w=320&t=${Date.now()}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);

        try {
            const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
            if (!res.ok) throw new Error('offline');
            const blob = await res.blob();
            if (!blob.type.startsWith('image/')) throw new Error('invalid');
            const objectUrl = URL.createObjectURL(blob);
            if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
            img.dataset.objectUrl = objectUrl;
            img.src = objectUrl;
            img.classList.add('is-loaded');
            placeholder?.classList.add('hidden');
            badge.textContent = 'Online';
            badge.className = 'camera-status-badge camera-status-badge--online';
        } catch {
            img.classList.remove('is-loaded');
            img.removeAttribute('src');
            placeholder?.classList.remove('hidden');
            badge.textContent = 'Offline';
            badge.className = 'camera-status-badge camera-status-badge--offline';
        } finally {
            clearTimeout(timer);
        }
    }

    async function refreshAll() {
        for (const card of cards) {
            void refreshCard(card);
            await new Promise(resolve => setTimeout(resolve, STAGGER_MS));
        }
    }

    void refreshAll();
    setInterval(() => void refreshAll(), REFRESH_MS);
}

function initCameraCards() {
    document.querySelectorAll('.camera-card').forEach(card => {
        const view = card.querySelector('.camera-view');
        const edit = card.querySelector('.camera-edit');

        card.querySelector('.btn-edit')?.addEventListener('click', () => {
            view.classList.add('hidden');
            edit.classList.remove('hidden');
            const motionRoot = edit.querySelector('[data-motion-root]');
            if (motionRoot) syncMotionPanel(motionRoot);
        });

        card.querySelector('.btn-cancel')?.addEventListener('click', () => {
            edit.classList.add('hidden');
            view.classList.remove('hidden');
        });

        card.querySelector('.btn-duplicate')?.addEventListener('click', (e) => {
            const sourceName = e.currentTarget.dataset.sourceName || 'camera';
            const name = prompt(`Name for the duplicate of "${sourceName}":`, `${sourceName} (copy)`);
            if (!name?.trim()) return;

            const form = document.createElement('form');
            form.method = 'POST';
            form.action = `/api/cameras/${encodeURIComponent(card.dataset.cameraId)}/duplicate`;

            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'name';
            input.value = name.trim();
            form.appendChild(input);

            document.body.appendChild(form);
            form.submit();
        });
    });
}

function initAddCameraToggle() {
    const toggle = document.getElementById('toggle-add-camera');
    const panel = document.getElementById('add-camera-panel');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !isHidden);
        toggle.textContent = isHidden ? '− Cancel' : '+ Add Camera';
    });
}

function initLogs() {
    const logContainer = document.getElementById('log-container');
    const troubleshooting = document.getElementById('troubleshooting-section');
    const scrollToggle = document.getElementById('log-scroll-toggle');
    if (!logContainer) return;

    let autoScroll = true;
    let pollTimer = null;

    function isNearBottom() {
        return Math.abs(
            logContainer.scrollHeight - logContainer.clientHeight - logContainer.scrollTop,
        ) < 24;
    }

    function scrollToBottom() {
        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function updateScrollToggle() {
        if (!scrollToggle) return;
        const paused = !autoScroll;
        scrollToggle.textContent = paused ? 'Resume scroll' : 'Pause scroll';
        scrollToggle.setAttribute('aria-pressed', String(paused));
    }

    scrollToggle?.addEventListener('click', () => {
        autoScroll = !autoScroll;
        updateScrollToggle();
        if (autoScroll) {
            scrollToBottom();
        }
    });

    logContainer.addEventListener('scroll', () => {
        if (!isNearBottom()) {
            autoScroll = false;
            updateScrollToggle();
        }
    });

    async function fetchLogs() {
        try {
            const response = await fetch('/api/logs');
            const logs = await response.json();

            if (logs.length > 0) {
                const ordered = [...logs].reverse();
                logContainer.innerHTML = ordered.map(log =>
                    `<div class="log-line">${escapeHtml(log)}</div>`,
                ).join('');

                if (autoScroll) {
                    scrollToBottom();
                }
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        }
    }

    function startPolling() {
        if (pollTimer) return;
        fetchLogs();
        pollTimer = setInterval(fetchLogs, 2000);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    updateScrollToggle();

    if (troubleshooting) {
        troubleshooting.addEventListener('toggle', () => {
            if (troubleshooting.open) {
                startPolling();
            } else {
                stopPolling();
            }
        });

        if (troubleshooting.open) {
            startPolling();
        }
    } else {
        startPolling();
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
    initMotionOptions();
    initCameraCards();
    initCameraPreviews();
    initAddCameraToggle();
    initCameraProviderWizard();
    initLogs();
});
