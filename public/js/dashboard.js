function initCameraCards() {
    document.querySelectorAll('.camera-card').forEach(card => {
        const view = card.querySelector('.camera-view');
        const edit = card.querySelector('.camera-edit');

        card.querySelector('.btn-edit')?.addEventListener('click', () => {
            view.classList.add('hidden');
            edit.classList.remove('hidden');
        });

        card.querySelector('.btn-cancel')?.addEventListener('click', () => {
            edit.classList.add('hidden');
            view.classList.remove('hidden');
        });

        card.querySelector('.btn-copy-url')?.addEventListener('click', async (e) => {
            const url = e.currentTarget.dataset.url;
            const feedback = card.querySelector('.copy-feedback');
            try {
                await navigator.clipboard.writeText(url);
                if (feedback) {
                    feedback.textContent = 'Copied!';
                    setTimeout(() => { feedback.textContent = ''; }, 2000);
                }
            } catch {
                if (feedback) feedback.textContent = 'Copy failed';
            }
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
    initCameraCards();
    initAddCameraToggle();
    initLogs();
});
