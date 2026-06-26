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

document.addEventListener('DOMContentLoaded', () => {
    window.MatterCamerasMotionOptions?.initMotionOptions();
    initCameraCards();
    initCameraPreviews();
    initLogs();
    initPairingPanel();
});
