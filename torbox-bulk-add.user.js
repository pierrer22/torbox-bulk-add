// ==UserScript==
// @name         TorBox Bulk Magnet Sender
// @namespace    https://torbox.app/
// @version      1.1.1
// @description  Scan the current page for magnet links and send them to TorBox
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.torbox.app
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TORBOX_CREATE_URL = 'https://api.torbox.app/v1/api/torrents/createtorrent';
    const API_KEY_STORAGE = 'torbox_api_key';
    const CONCURRENCY = 5;
    const RATE_LIMIT_RETRY_MS = 1500;
    const WIDGET_ID = 'torbox-bulk-sender-widget';

    /**
     * Extract unique magnet links from the current document.
     * Deduplicates by BTIH infohash (case-insensitive) when present.
     */
    function scanMagnetLinks(root = document) {
        const anchors = root.querySelectorAll('a[href^="magnet:" i]');
        const seen = new Set();
        const results = [];

        for (const a of anchors) {
            const href = (a.getAttribute('href') || '').trim();
            if (!href) continue;

            const hashMatch = href.match(/urn:btih:([a-zA-Z0-9]{32,40})/i);
            const dedupeKey = hashMatch ? hashMatch[1].toLowerCase() : href;

            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            results.push({
                magnet: href,
                name: extractName(href, a),
                hash: hashMatch ? hashMatch[1].toLowerCase() : null,
            });
        }

        return results;
    }

    function extractName(magnet, anchor) {
        try {
            const query = magnet.split('?')[1] || '';
            const params = new URLSearchParams(query);
            const dn = params.get('dn');
            if (dn) return dn;
        } catch (_) {
            // Fallback to anchor text if magnet query parsing fails.
        }
        const text = (anchor?.textContent || '').trim();
        return text || magnet.slice(0, 48) + '...';
    }

    function getApiKey() {
        return (GM_getValue(API_KEY_STORAGE, '') || '').trim();
    }

    function promptForApiKey(force = false) {
        const existing = getApiKey();
        if (existing && !force) return existing;

        const input = window.prompt(
            'Enter your TorBox API Key (from https://torbox.app/settings):',
            existing
        );
        if (input === null) return '';

        const trimmed = input.trim();
        GM_setValue(API_KEY_STORAGE, trimmed);
        return trimmed;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Send a single magnet link to TorBox via GM_xmlhttpRequest.
     */
    function sendMagnetToTorbox(magnet, apiKey) {
        return new Promise((resolve) => {
            const body = new URLSearchParams({
                magnet,
                seed: '1',
            }).toString();

            GM_xmlhttpRequest({
                method: 'POST',
                url: TORBOX_CREATE_URL,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                data: body,
                onload: (res) => {
                    let parsed = null;
                    try {
                        parsed = JSON.parse(res.responseText || '{}');
                    } catch (_) {
                        parsed = null;
                    }

                    if (res.status >= 200 && res.status < 300 && parsed?.success) {
                        resolve({ ok: true, detail: parsed.detail || 'Added' });
                        return;
                    }

                    const detail =
                        parsed?.detail ||
                        parsed?.error ||
                        `HTTP ${res.status}: ${(res.responseText || '').slice(0, 120)}`;
                    resolve({ ok: false, status: res.status, detail });
                },
                onerror: () => {
                    resolve({ ok: false, status: 0, detail: 'Network error' });
                },
                ontimeout: () => {
                    resolve({ ok: false, status: 0, detail: 'Request timed out' });
                },
            });
        });
    }

    function createWidget(magnets) {
        if (document.getElementById(WIDGET_ID)) return null;

        const container = document.createElement('div');
        container.id = WIDGET_ID;
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            zIndex: '2147483647',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '13px',
            color: '#f8fafc',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            width: '360px',
            maxWidth: 'calc(100vw - 32px)',
        });

        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
        });

        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        Object.assign(sendBtn.style, {
            flex: '1',
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '6px 10px',
            fontWeight: '600',
            cursor: 'pointer',
        });

        const toggleListBtn = document.createElement('button');
        toggleListBtn.type = 'button';
        toggleListBtn.textContent = 'Hide';
        Object.assign(toggleListBtn.style, {
            background: '#1e293b',
            color: '#cbd5e1',
            border: '1px solid #475569',
            borderRadius: '6px',
            padding: '6px 8px',
            cursor: 'pointer',
        });

        const keyBtn = document.createElement('button');
        keyBtn.type = 'button';
        keyBtn.textContent = 'API Key';
        keyBtn.title = 'Set or update TorBox API key';
        Object.assign(keyBtn.style, {
            background: '#1e293b',
            color: '#cbd5e1',
            border: '1px solid #475569',
            borderRadius: '6px',
            padding: '6px 8px',
            cursor: 'pointer',
        });

        const listHeader = document.createElement('div');
        Object.assign(listHeader.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#94a3b8',
            borderTop: '1px solid #1e293b',
            paddingTop: '6px',
        });

        const countLabel = document.createElement('span');
        const toggleAllBtn = document.createElement('button');
        toggleAllBtn.type = 'button';
        toggleAllBtn.textContent = 'Deselect all';
        Object.assign(toggleAllBtn.style, {
            background: 'transparent',
            color: '#38bdf8',
            border: 'none',
            padding: '0',
            fontSize: '12px',
            cursor: 'pointer',
        });

        listHeader.appendChild(countLabel);
        listHeader.appendChild(toggleAllBtn);

        const listEl = document.createElement('div');
        Object.assign(listEl.style, {
            maxHeight: '240px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            paddingRight: '4px',
        });

        const checkboxes = [];

        function updateSelectionState() {
            const selected = checkboxes.filter((cb) => cb.checked).length;
            const total = checkboxes.length;
            sendBtn.textContent = `Send ${selected}/${total} to TorBox`;
            sendBtn.disabled = selected === 0;
            sendBtn.style.opacity = selected === 0 ? '0.5' : '1';
            countLabel.textContent = `${selected} of ${total} selected`;
            toggleAllBtn.textContent = selected === total ? 'Deselect all' : 'Select all';
        }

        magnets.forEach((item, index) => {
            const label = document.createElement('label');
            Object.assign(label.style, {
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
                padding: '4px 6px',
                borderRadius: '5px',
                background: '#1e293b',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: '1.35',
            });

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = true;
            cb.dataset.index = String(index);
            cb.style.marginTop = '2px';
            cb.style.cursor = 'pointer';
            cb.addEventListener('change', updateSelectionState);

            const nameSpan = document.createElement('span');
            nameSpan.textContent = item.name;
            nameSpan.title = item.name;
            Object.assign(nameSpan.style, {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
            });

            label.appendChild(cb);
            label.appendChild(nameSpan);
            listEl.appendChild(label);
            checkboxes.push(cb);
        });

        toggleAllBtn.addEventListener('click', () => {
            const allSelected = checkboxes.every((cb) => cb.checked);
            checkboxes.forEach((cb) => {
                cb.checked = !allSelected;
            });
            updateSelectionState();
        });

        let listVisible = true;
        toggleListBtn.addEventListener('click', () => {
            listVisible = !listVisible;
            listHeader.style.display = listVisible ? 'flex' : 'none';
            listEl.style.display = listVisible ? 'flex' : 'none';
            toggleListBtn.textContent = listVisible ? 'Hide' : 'List';
        });

        const statusEl = document.createElement('div');
        Object.assign(statusEl.style, {
            fontSize: '12px',
            color: '#cbd5e1',
            display: 'none',
            wordBreak: 'break-word',
        });

        updateSelectionState();

        row.appendChild(sendBtn);
        row.appendChild(toggleListBtn);
        row.appendChild(keyBtn);
        container.appendChild(row);
        container.appendChild(listHeader);
        container.appendChild(listEl);
        container.appendChild(statusEl);
        document.body.appendChild(container);

        return {
            container,
            sendBtn,
            keyBtn,
            statusEl,
            getSelectedMagnets: () =>
                magnets.filter((_, idx) => checkboxes[idx]?.checked),
        };
    }

    async function handleBulkSend(ui) {
        const magnets = ui ? ui.getSelectedMagnets() : scanMagnetLinks();
        if (magnets.length === 0) {
            window.alert('No magnet links selected.');
            return;
        }

        let apiKey = getApiKey();
        if (!apiKey) {
            apiKey = promptForApiKey(true);
            if (!apiKey) return;
        }

        if (ui) {
            ui.sendBtn.disabled = true;
            ui.sendBtn.style.opacity = '0.7';
            ui.statusEl.style.display = 'block';
        }

        let added = 0;
        let failed = 0;
        let completed = 0;
        let nextIndex = 0;
        let authAborted = false;
        const errors = [];

        async function worker() {
            while (!authAborted) {
                const idx = nextIndex++;
                if (idx >= magnets.length) return;

                const item = magnets[idx];
                let res = await sendMagnetToTorbox(item.magnet, apiKey);
                if (!res.ok && res.status === 429) {
                    await sleep(RATE_LIMIT_RETRY_MS);
                    res = await sendMagnetToTorbox(item.magnet, apiKey);
                }

                completed++;
                if (res.ok) {
                    added++;
                } else {
                    failed++;
                    errors.push(`${item.name}: ${res.detail}`);
                    if (res.status === 401 || res.status === 403) {
                        authAborted = true;
                        if (ui) {
                            ui.statusEl.textContent = `Auth failed (${res.status}). Check your TorBox API key.`;
                        }
                        return;
                    }
                }

                if (ui && !authAborted) {
                    ui.statusEl.textContent = `Sent ${completed}/${magnets.length} (${added} ok, ${failed} failed)`;
                }
            }
        }

        if (ui) {
            ui.statusEl.textContent = `Sending 0/${magnets.length} (${Math.min(CONCURRENCY, magnets.length)} parallel)...`;
        }

        const workerCount = Math.min(CONCURRENCY, magnets.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        const summary = `Done: ${added} sent, ${failed} failed (of ${magnets.length}).`;
        if (ui) {
            ui.statusEl.textContent = errors.length
                ? `${summary} First error: ${errors[0]}`
                : summary;
            ui.sendBtn.disabled = false;
            ui.sendBtn.style.opacity = '1';
        } else {
            window.alert(summary);
        }
    }

    function showToast(message) {
        const render = () => {
            if (!document.body) return;
            const toast = document.createElement('div');
            toast.textContent = message;
            Object.assign(toast.style, {
                position: 'fixed',
                bottom: '16px',
                right: '16px',
                zIndex: '2147483647',
                background: '#0f172a',
                color: '#4ade80',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '8px 12px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '13px',
                fontWeight: '600',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            });
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);
        };

        if (document.body) {
            render();
        } else {
            document.addEventListener('DOMContentLoaded', render, { once: true });
        }
    }

    /**
     * When running on torbox.app, intercept Authorization Bearer headers sent to
     * api.torbox.app and persist the token into GM storage for all sites.
     */
    function setupTorboxAutoGrab() {
        const host = location.hostname;
        if (host !== 'torbox.app' && !host.endsWith('.torbox.app')) return false;

        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
        let lastSaved = getApiKey();

        function persistToken(token, label = 'TorBox API key synced to Bulk Sender') {
            if (!token || token === lastSaved) return;
            lastSaved = token;
            GM_setValue(API_KEY_STORAGE, token);
            showToast(label);
        }

        function saveToken(rawHeader) {
            if (typeof rawHeader !== 'string') return;
            const match = rawHeader.match(/^Bearer\s+(.+)$/i);
            if (!match) return;
            persistToken(match[1].trim());
        }

        function scanStorageAndSettingsDom() {
            try {
                // 1. Prefer permanent API key visible on /settings
                if (location.pathname.includes('settings') && document.body) {
                    const candidates = document.querySelectorAll('input, code, pre');
                    for (const el of candidates) {
                        const val = ('value' in el ? el.value : el.textContent) || '';
                        const match = val.trim().match(UUID_RE);
                        if (match) {
                            persistToken(match[0], 'TorBox permanent API key synced');
                            return true;
                        }
                    }
                }

                // 2. Fallback to torbox_session_token in localStorage
                const sessionToken = window.localStorage?.getItem('torbox_session_token');
                if (sessionToken && !lastSaved) {
                    persistToken(sessionToken.trim(), 'TorBox session token synced');
                    return true;
                }
            } catch (_) {
                // Ignore storage/DOM access errors.
            }
            return false;
        }

        // Poll briefly after load so React/Next hydration & settings DOM are caught.
        let attempts = 0;
        const pollTimer = setInterval(() => {
            attempts++;
            if (scanStorageAndSettingsDom() || attempts >= 10) {
                clearInterval(pollTimer);
            }
        }, 500);

        function extractAuthHeader(headers) {
            if (!headers) return null;
            if (typeof Headers !== 'undefined' && headers instanceof Headers) {
                return headers.get('Authorization') || headers.get('authorization');
            }
            if (Array.isArray(headers)) {
                const pair = headers.find(([k]) => String(k).toLowerCase() === 'authorization');
                return pair ? pair[1] : null;
            }
            if (typeof headers === 'object') {
                const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
                return key ? headers[key] : null;
            }
            return null;
        }

        if (typeof pageWin.fetch === 'function') {
            const origFetch = pageWin.fetch;
            pageWin.fetch = function (input, init) {
                try {
                    const url = typeof input === 'string' ? input : input?.url || '';
                    if (url.includes('api.torbox.app')) {
                        const header =
                            extractAuthHeader(init?.headers) ||
                            extractAuthHeader(input?.headers);
                        saveToken(header);
                    }
                } catch (_) {
                    // Never break page fetch calls.
                }
                return origFetch.apply(this, arguments);
            };
        }

        const origOpen = pageWin.XMLHttpRequest?.prototype?.open;
        const origSetHeader = pageWin.XMLHttpRequest?.prototype?.setRequestHeader;
        if (origOpen && origSetHeader) {
            pageWin.XMLHttpRequest.prototype.open = function (_method, url) {
                this._torboxUrl = typeof url === 'string' ? url : '';
                return origOpen.apply(this, arguments);
            };
            pageWin.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
                try {
                    if (
                        this._torboxUrl?.includes('api.torbox.app') &&
                        String(name).toLowerCase() === 'authorization'
                    ) {
                        saveToken(String(value));
                    }
                } catch (_) {
                    // Never break page XHR calls.
                }
                return origSetHeader.apply(this, arguments);
            };
        }

        return true;
    }

    function init() {
        const initial = scanMagnetLinks();
        let ui = null;

        if (initial.length > 0 && document.body) {
            ui = createWidget(initial);
            if (ui) {
                ui.sendBtn.addEventListener('click', () => handleBulkSend(ui));
                ui.keyBtn.addEventListener('click', () => {
                    const key = promptForApiKey(true);
                    if (key && ui) {
                        ui.statusEl.style.display = 'block';
                        ui.statusEl.textContent = 'TorBox API key saved.';
                    }
                });
            }
        }

        GM_registerMenuCommand('Send selected magnets to TorBox', () => handleBulkSend(ui));
        GM_registerMenuCommand('Set TorBox API Key', () => promptForApiKey(true));
        GM_registerMenuCommand('Grab API Key from TorBox', () =>
            window.open('https://torbox.app/settings', '_blank')
        );
    }

    if (!setupTorboxAutoGrab()) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }
    }
})();
