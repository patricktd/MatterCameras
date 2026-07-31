async function initSoftwareUpdates() {
    const statusEl = document.getElementById('software-update-status');
    const actionsEl = document.getElementById('software-update-actions');
    const applyBtn = document.getElementById('options-apply-update-btn');
    const releaseLink = document.getElementById('options-release-link');

    if (!statusEl) return;

    try {
        const response = await fetch('/api/updates', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || response.statusText);

        actionsEl?.removeAttribute('hidden');
        releaseLink?.removeAttribute('hidden');
        if (data.releaseUrl && releaseLink) releaseLink.href = data.releaseUrl;

        if (data.updateInProgress) {
            statusEl.textContent = 'An update is in progress. The bridge will restart shortly.';
            return;
        }

        if (data.updateAvailable && data.latestVersion) {
            statusEl.textContent = data.canAutoUpdate
                ? `v${data.latestVersion} is available (running v${data.currentVersion}).`
                : `v${data.latestVersion} is available (running v${data.currentVersion}). Pull a newer image to update (this install has no one-click self-update).`;
            if (applyBtn && data.canAutoUpdate) {
                applyBtn.hidden = false;
                applyBtn.onclick = async () => {
                    if (!confirm(`Install v${data.latestVersion} now? The bridge will restart.`)) return;
                    applyBtn.disabled = true;
                    try {
                        const applyResponse = await fetch('/api/updates/apply', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ version: data.latestVersion }),
                        });
                        const payload = await applyResponse.json();
                        if (!applyResponse.ok) throw new Error(payload.error || applyResponse.statusText);
                        statusEl.textContent = 'Update started. Waiting for restart…';
                        applyBtn.hidden = true;
                    } catch (err) {
                        statusEl.textContent = `Update failed: ${err.message}`;
                        applyBtn.disabled = false;
                    }
                };
            }
            return;
        }

        statusEl.textContent = `You are on the latest release (v${data.currentVersion}).`;
        if (data.checkError) {
            statusEl.textContent += ` Could not reach GitHub: ${data.checkError}`;
        }
    } catch (err) {
        statusEl.textContent = `Could not check for updates: ${err.message}`;
    }
}

function initProtectControllerOptions() {
    const statusEl = document.getElementById('protect-controller-status');
    const saveBtn = document.getElementById('save-protect-controller-btn');
    const clearBtn = document.getElementById('clear-protect-controller-btn');
    const hostInput = document.getElementById('opt-protect-host');
    const userInput = document.getElementById('opt-protect-user');
    const passInput = document.getElementById('opt-protect-pass');

    if (!saveBtn) return;

    saveBtn.addEventListener('click', async () => {
        const host = hostInput?.value?.trim() || '';
        const username = userInput?.value?.trim() || '';
        const password = passInput?.value || '';

        if (!host || !username) {
            if (statusEl) statusEl.textContent = 'Host and username are required.';
            return;
        }

        saveBtn.disabled = true;
        try {
            const response = await fetch('/api/settings/protect-controller', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ host, username, password }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.statusText);
            if (statusEl) statusEl.textContent = 'Controller login saved on this bridge.';
            if (passInput) passInput.value = '';
        } catch (err) {
            if (statusEl) statusEl.textContent = `Save failed: ${err.message}`;
        } finally {
            saveBtn.disabled = false;
        }
    });

    clearBtn?.addEventListener('click', async () => {
        if (!confirm('Remove saved UniFi Protect controller login from this bridge?')) return;
        clearBtn.disabled = true;
        try {
            const response = await fetch('/api/settings/protect-controller', { method: 'DELETE' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.statusText);
            if (hostInput) hostInput.value = '';
            if (userInput) userInput.value = '';
            if (passInput) passInput.value = '';
            if (statusEl) statusEl.textContent = 'Saved controller login cleared.';
        } catch (err) {
            if (statusEl) statusEl.textContent = `Clear failed: ${err.message}`;
        } finally {
            clearBtn.disabled = false;
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initSoftwareUpdates();
    initProtectControllerOptions();
});
