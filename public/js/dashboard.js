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
            if (motionRoot) {
                window.MatterCamerasMotionOptions?.syncMotionPanel(motionRoot);
            }
        });

        card.querySelector('.btn-cancel')?.addEventListener('click', () => {
            edit.classList.add('hidden');
            view.classList.remove('hidden');
        });

        card.querySelector('.btn-duplicate')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            if (btn.disabled) return;

            const sourceName = btn.dataset.sourceName || 'camera';
            const name = prompt(`Name for the duplicate of "${sourceName}":`, `${sourceName} (copy)`);
            if (!name?.trim()) return;

            btn.disabled = true;

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

function pairingQrImageUrl(qrPayload) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload)}&t=${Date.now()}`;
}

function updatePairingUi(data) {
    const content = document.getElementById('pairing-content');
    const status = document.getElementById('pairing-refresh-status');
    if (!content) return;

    if (data.commissioned || !data.qrCode) {
        return;
    }

    content.innerHTML = `
        <img id="pairing-qr-img" src="${pairingQrImageUrl(data.qrCode)}" alt="Matter Pairing QR">
        <div style="margin-top: 16px;">
            <small style="color: var(--text-secondary);">Manual code (SmartThings → Matter → Enter code)</small>
            <span id="pairing-manual-code" class="pairing-code">${escapeHtml(data.manualPairingCode)}</span>
        </div>
        <details class="technical-details">
            <summary>Show technical details</summary>
            <pre id="pairing-qr-payload">${escapeHtml(data.qrCode)}</pre>
        </details>`;

    if (status) {
        status.hidden = false;
        status.textContent = 'Pairing code updated. Scan the new QR or enter the new manual code.';
    }
}

async function fetchPairingInfo(refresh = false) {
    const url = refresh ? '/api/pairing/refresh' : '/api/pairing';
    const res = await fetch(url, refresh ? { method: 'POST' } : { cache: 'no-store' });
    if (!res.ok && refresh) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
}

function initPairingPanel() {
    const refreshBtn = document.getElementById('refresh-pairing-btn');
    const reloadBtn = document.getElementById('reload-pairing-btn');
    const waiting = document.getElementById('pairing-waiting');
    if (!refreshBtn && !reloadBtn && !waiting) return;

    const load = async (refresh = false) => {
        const status = document.getElementById('pairing-refresh-status');
        if (refreshBtn) refreshBtn.disabled = true;
        if (reloadBtn) reloadBtn.disabled = true;
        try {
            const data = await fetchPairingInfo(refresh);
            updatePairingUi(data);
        } catch (error) {
            if (status) {
                status.hidden = false;
                status.textContent = String(error);
            }
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
            if (reloadBtn) reloadBtn.disabled = false;
        }
    };

    refreshBtn?.addEventListener('click', () => void load(true));
    reloadBtn?.addEventListener('click', () => void load(false));

    if (waiting) {
        const poll = setInterval(async () => {
            try {
                const data = await fetchPairingInfo(false);
                if (data.qrCode) {
                    clearInterval(poll);
                    updatePairingUi(data);
                }
            } catch {
                // keep polling until bridge is up
            }
        }, 2000);
    }
}

function initFabricsPanel() {
    const list = document.getElementById('fabric-list');
    if (!list) return;

    const openBtn = document.getElementById('open-window-btn');
    const closeBtn = document.getElementById('close-window-btn');
    const pairingBox = document.getElementById('additional-pairing');
    const statusLine = document.getElementById('fabric-status');
    let knownFabricCount = null;
    let windowPoll = null;

    const setStatus = (text) => {
        if (!statusLine) return;
        statusLine.hidden = !text;
        statusLine.textContent = text || '';
    };

    const fabricDisplayName = (fabric) => {
        if (fabric.label && fabric.label.trim()) return fabric.label.trim();
        if (fabric.vendorName) return fabric.vendorName;
        return `Fabric ${fabric.fabricIndex}`;
    };

    const renderFabrics = (data) => {
        const fabrics = data.fabrics || [];
        if (!fabrics.length) {
            list.innerHTML = '<li class="fabric-empty">No hubs paired. The bridge is in pairing mode — '
                + 'reload this page to show the pairing QR code.</li>';
            return;
        }

        list.innerHTML = fabrics.map(fabric => `
            <li class="fabric-item" data-fabric-index="${fabric.fabricIndex}">
                <div class="fabric-info">
                    <strong>${escapeHtml(fabricDisplayName(fabric))}</strong>
                    <small>
                        ${fabric.vendorName && fabric.label ? `${escapeHtml(fabric.vendorName)} · ` : ''}
                        vendor 0x${Number(fabric.rootVendorId).toString(16)} · index ${fabric.fabricIndex}
                    </small>
                </div>
                <button type="button" class="btn btn-secondary btn-sm fabric-remove-btn"
                    data-fabric-index="${fabric.fabricIndex}"
                    data-fabric-name="${escapeHtml(fabricDisplayName(fabric))}"
                    data-last="${fabrics.length === 1}">Remove</button>
            </li>`).join('');

        list.querySelectorAll('.fabric-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => void removeFabric(btn));
        });
    };

    const loadFabrics = async () => {
        const res = await fetch('/api/fabrics', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderFabrics(data);
        updateWindowUi(data.window);
        return data;
    };

    const removeFabric = async (btn) => {
        const fabricIndex = btn.dataset.fabricIndex;
        const name = btn.dataset.fabricName;
        const isLast = btn.dataset.last === 'true';
        const warning = isLast
            ? `Remove ${name}? This is the LAST paired hub — the bridge will return to pairing mode.`
            : `Remove ${name}? This hub will lose access to all bridged cameras. Also remove the bridge from that hub's app.`;
        if (!confirm(warning)) return;

        btn.disabled = true;
        try {
            const res = await fetch(`/api/fabrics/${fabricIndex}`, { method: 'DELETE' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            setStatus(`Removed ${name}.` + (body.commissioned ? '' : ' Bridge is back in pairing mode — reload the page to show the pairing QR code.'));
            renderFabrics(body);
        } catch (error) {
            setStatus(`Failed to remove fabric: ${error}`);
            btn.disabled = false;
        }
    };

    const updateWindowUi = (windowInfo) => {
        if (!pairingBox) return;
        const open = Boolean(windowInfo && windowInfo.windowOpen && windowInfo.qrCode);
        if (closeBtn) closeBtn.hidden = !open;
        if (openBtn) openBtn.hidden = open;
        if (!open) {
            pairingBox.hidden = true;
            pairingBox.innerHTML = '';
            stopWindowPoll();
            return;
        }

        const expires = windowInfo.expiresAt ? new Date(windowInfo.expiresAt) : null;
        const expiresText = expires
            ? `Window closes at ${expires.toLocaleTimeString()} (15 minutes).`
            : '';
        pairingBox.hidden = false;
        pairingBox.innerHTML = `
            <p class="field-hint">Scan with the additional hub's app. ${expiresText}</p>
            <img src="${pairingQrImageUrl(windowInfo.qrCode)}" alt="Additional hub pairing QR">
            <div style="margin-top: 12px;">
                <small style="color: var(--text-secondary);">Manual code (hub app → Matter → Enter code)</small>
                <span class="pairing-code">${escapeHtml(windowInfo.manualPairingCode)}</span>
            </div>`;
        startWindowPoll();
    };

    const stopWindowPoll = () => {
        if (windowPoll) {
            clearInterval(windowPoll);
            windowPoll = null;
        }
    };

    const startWindowPoll = () => {
        if (windowPoll) return;
        windowPoll = setInterval(async () => {
            try {
                const data = await loadFabrics();
                const count = (data.fabrics || []).length;
                if (knownFabricCount !== null && count > knownFabricCount) {
                    setStatus('New hub paired successfully.');
                }
                knownFabricCount = count;
                if (!data.window || !data.window.windowOpen) {
                    stopWindowPoll();
                }
            } catch {
                // transient — keep polling while the window is open
            }
        }, 5000);
    };

    openBtn?.addEventListener('click', async () => {
        openBtn.disabled = true;
        setStatus('');
        try {
            const res = await fetch('/api/pairing/open-window', { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            updateWindowUi(body);
        } catch (error) {
            setStatus(`Failed to open pairing window: ${error}`);
        } finally {
            openBtn.disabled = false;
        }
    });

    closeBtn?.addEventListener('click', async () => {
        closeBtn.disabled = true;
        try {
            await fetch('/api/pairing/close-window', { method: 'POST' });
            updateWindowUi(null);
        } catch (error) {
            setStatus(`Failed to close pairing window: ${error}`);
        } finally {
            closeBtn.disabled = false;
        }
    });

    loadFabrics()
        .then(data => { knownFabricCount = (data.fabrics || []).length; })
        .catch(error => {
            list.innerHTML = `<li class="fabric-empty">Failed to load fabrics: ${escapeHtml(String(error))}</li>`;
        });
}

document.addEventListener('DOMContentLoaded', () => {
    window.MatterCamerasMotionOptions?.initMotionOptions();
    initCameraCards();
    initCameraPreviews();
    initLogs();
    initPairingPanel();
    initFabricsPanel();
});
