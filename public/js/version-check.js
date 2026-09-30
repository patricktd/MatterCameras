(function initVersionCheck() {
    const bannerId = 'update-banner';
    const infoBar = document.querySelector('.info-bar');
    if (!infoBar) return;

    function renderBanner(data) {
        let banner = document.getElementById(bannerId);
        if (!data.updateAvailable) {
            banner?.remove();
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = bannerId;
            banner.className = 'update-banner';
            infoBar.parentNode?.insertBefore(banner, infoBar.nextSibling);
        }

        const versionLabel = data.latestVersion ? `v${data.latestVersion}` : 'a new version';
        const notesLink = data.releaseUrl
            ? `<a href="${data.releaseUrl}" target="_blank" rel="noopener noreferrer">Release notes</a>`
            : '';

        let action = '';
        if (data.updateInProgress) {
            action = '<span class="update-banner__status">Updating…</span>';
        } else if (data.canAutoUpdate) {
            action = `<button type="button" class="btn btn-sm" id="apply-update-btn">Update now</button>`;
        }

        banner.innerHTML = `
            <div class="update-banner__text">
                <strong>Update available:</strong> ${versionLabel}
                (you are on v${data.currentVersion}).
                ${notesLink}
            </div>
            <div class="update-banner__actions">${action}</div>
        `;

        const applyBtn = document.getElementById('apply-update-btn');
        applyBtn?.addEventListener('click', () => applyUpdate(data.latestVersion, banner));
    }

    async function applyUpdate(targetVersion, banner) {
        if (!targetVersion) return;
        if (!confirm(`Install v${targetVersion} now? The bridge will restart and cameras may be offline for a minute.`)) {
            return;
        }

        const applyBtn = document.getElementById('apply-update-btn');
        if (applyBtn) applyBtn.disabled = true;

        try {
            const response = await fetch('/api/updates/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: targetVersion }),
            });
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || response.statusText);
            }

            if (banner) {
                banner.querySelector('.update-banner__actions').innerHTML =
                    '<span class="update-banner__status">Updating… waiting for restart</span>';
            }

            pollForNewVersion(targetVersion);
        } catch (error) {
            alert(`Update failed: ${error.message}`);
            if (applyBtn) applyBtn.disabled = false;
        }
    }

    function pollForNewVersion(targetVersion) {
        let attempts = 0;
        const maxAttempts = 90; // 3 minutes
        const poll = setInterval(async () => {
            attempts += 1;
            try {
                const response = await fetch('/api/version', { cache: 'no-store' });
                if (!response.ok) return;
                const payload = await response.json();
                if (payload.version === targetVersion) {
                    clearInterval(poll);
                    location.reload();
                }
            } catch (_) {
                // Bridge restarting — keep polling.
            }
            if (attempts >= maxAttempts) {
                clearInterval(poll);
                void reportStalledUpdate();
            }
        }, 2000);
    }

    function escapeText(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function reportStalledUpdate() {
        const banner = document.getElementById(bannerId);
        const actions = banner?.querySelector('.update-banner__actions');
        if (!actions) return;

        let detail = '';
        try {
            const response = await fetch('/api/updates', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                if (data.updateLogTail) {
                    detail = `<details><summary>Update log (tail)</summary><pre>${escapeText(data.updateLogTail)}</pre></details>`;
                }
            }
        } catch (_) {
            // Ignore — the guidance below still applies.
        }

        actions.innerHTML = `
            <span class="update-banner__status">Update did not finish within 3 minutes.</span>
            <span class="update-banner__hint">The bridge may need a manual restart with
            <code>docker compose up -d</code> on the host.</span>
            ${detail}
        `;
    }

    async function checkUpdates() {
        try {
            const response = await fetch('/api/updates', { cache: 'no-store' });
            if (!response.ok) return;
            const data = await response.json();
            renderBanner(data);
        } catch (_) {
            // Offline or GitHub unreachable — hide banner.
        }
    }

    checkUpdates();
    setInterval(checkUpdates, 60 * 60 * 1000);
})();
