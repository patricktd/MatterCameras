function initAddCameraPage() {
    const form = document.getElementById('add-camera-form');
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
    const reolinkHostInput = document.getElementById('add-reolink-host');
    const reolinkHttpPortInput = document.getElementById('add-reolink-http-port');
    const reolinkUseHttpsInput = document.getElementById('add-reolink-use-https');
    const reolinkRtspPortInput = document.getElementById('add-reolink-rtsp-port');
    const reolinkProtocolInput = document.getElementById('add-reolink-protocol');
    const reolinkStreamInput = document.getElementById('add-reolink-stream');
    const reolinkUidInput = document.getElementById('add-reolink-uid');
    const reolinkIsNvrInput = document.getElementById('add-reolink-is-nvr');
    const providerId = form?.dataset.providerId || 'manual';

    if (!form) return;

    let lastCredentials = {};

    function getCredentials() {
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

    function setStatus(message) {
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.classList.remove('hidden');
    }

    function clearResults() {
        if (statusEl) {
            statusEl.classList.add('hidden');
            statusEl.textContent = '';
        }
        if (resultsEl) {
            resultsEl.classList.add('hidden');
            resultsEl.innerHTML = '';
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
        if (reolinkHostInput) reolinkHostInput.value = draft.reolinkHost || '';
        if (reolinkHttpPortInput) reolinkHttpPortInput.value = draft.reolinkHttpPort ?? '';
        if (reolinkUseHttpsInput) reolinkUseHttpsInput.value = draft.reolinkUseHttps === undefined ? '' : String(draft.reolinkUseHttps);
        if (reolinkRtspPortInput) reolinkRtspPortInput.value = draft.reolinkRtspPort ?? '';
        if (reolinkProtocolInput) reolinkProtocolInput.value = draft.reolinkProtocol || '';
        if (reolinkStreamInput) reolinkStreamInput.value = draft.reolinkStream || '';
        if (reolinkUidInput) reolinkUidInput.value = draft.reolinkDeviceUid || '';
        if (reolinkIsNvrInput) reolinkIsNvrInput.value = draft.reolinkIsNvr === undefined ? '' : String(draft.reolinkIsNvr);
        if (motionSelect) {
            motionSelect.value = draft.suggestedMotionSource || 'auto';
            motionSelect.dispatchEvent(new Event('change'));
        }
        if (motionHint && draft.suggestedMotionReason) {
            motionHint.textContent = `Suggested: ${draft.suggestedMotionReason}`;
        }
        if (addSourceInput && draft.addSource) addSourceInput.value = draft.addSource;
        setStatus(`Loaded ${draft.name || label}. Review the details and click Add Camera.`);
        nameInput?.focus();
    }

    async function resolveDevice(device, creds) {
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

    function renderDeviceList(devices) {
        if (!resultsEl) return;

        if (!devices.length) {
            setStatus('No new cameras found (all may already be added).');
            resultsEl.classList.add('hidden');
            return;
        }

        setStatus(`Found ${devices.length} camera(s). Click Use to fill the form.`);
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

            item.querySelector('.btn-use-device')?.addEventListener('click', async event => {
                const button = event.currentTarget;
                button.disabled = true;
                button.textContent = 'Loading…';
                setStatus(`Connecting to ${device.label}…`);

                try {
                    await resolveDevice(device, lastCredentials);
                } catch (error) {
                    setStatus(`Failed: ${error.message}`);
                } finally {
                    button.disabled = false;
                    button.textContent = 'Use';
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

    async function runUnifiImportAll(button) {
        const creds = getCredentials();
        if (!creds.host || !creds.username) {
            setStatus('Enter controller host and username first.');
            return;
        }

        if (!confirm('Import every new Protect camera into this bridge? The bridge may restart once when commissioned.')) {
            return;
        }

        button.disabled = true;
        setStatus('Importing cameras from UniFi Protect…');

        try {
            const response = await fetch('/api/camera-providers/unifi-protect/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(unifiRequestBody(creds)),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || response.statusText);

            const errCount = data.errors?.length ?? 0;
            let message = `Imported ${data.count} camera(s).`;
            if (errCount) message += ` ${errCount} failed.`;
            setStatus(message);

            if (data.count > 0) {
                setTimeout(() => { window.location.href = '/'; }, 1500);
            }
        } catch (error) {
            setStatus(`Import failed: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    async function runUnifiSyncExisting(button) {
        const creds = getCredentials();
        if (!creds.host || !creds.username) {
            setStatus('Enter controller host and username first.');
            return;
        }

        button.disabled = true;
        setStatus('Matching existing cameras to Protect…');

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
            setStatus(`Linked ${linked} camera(s) to Protect (${skipped} skipped).`);
        } catch (error) {
            setStatus(`Link failed: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    }

    document.getElementById('unifi-import-all-btn')?.addEventListener('click', event => {
        runUnifiImportAll(event.currentTarget);
    });

    document.getElementById('unifi-sync-existing-btn')?.addEventListener('click', event => {
        runUnifiSyncExisting(event.currentTarget);
    });

    document.querySelectorAll('.provider-discover-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const creds = getCredentials();
            lastCredentials = creds;

            if ((providerId === 'reolink' || providerId === 'tapo-sonoff') && (!creds.host || !creds.username)) {
                setStatus('Enter host and username first.');
                return;
            }

            if (providerId === 'onvif' && !creds.username) {
                setStatus('Enter ONVIF username before scanning.');
                return;
            }

            button.disabled = true;
            setStatus(providerId === 'onvif' ? 'Scanning LAN for ONVIF cameras (5s)…' : 'Connecting…');
            if (resultsEl) {
                resultsEl.classList.add('hidden');
                resultsEl.innerHTML = '';
            }

            try {
                const response = await fetch(`/api/camera-providers/${encodeURIComponent(providerId)}/discover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...creds, timeoutMs: 5000 }),
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || response.statusText);
                }
                if (providerId === 'unifi-protect') {
                    await maybeSaveProtectController(creds);
                }
                renderDeviceList(data.devices || []);
            } catch (error) {
                setStatus(`Failed: ${error.message}`);
            } finally {
                button.disabled = false;
            }
        });
    });

    let isSubmitting = false;
    form.addEventListener('submit', (e) => {
        if (isSubmitting) {
            e.preventDefault();
            return;
        }
        isSubmitting = true;
        if (addSourceInput) {
            addSourceInput.value = providerId;
        }
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding…';
        }
    });

    if (providerId === 'manual' && rtspHint) {
        rtspHint.textContent = 'Paste the RTSP or RTSPS URL from your camera or NVR documentation.';
    }

    clearResults();
    window.MatterCamerasMotionOptions?.initMotionOptions();
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', initAddCameraPage);