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
    initProtectControllerOptions();
});
