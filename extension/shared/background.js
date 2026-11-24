// MV3 background: a service worker in Chrome, an event page in Firefox. It is
// the only place that talks to Arctic Shift, PullPush and removal.rosint.dev;
// the content script only ever reads Reddit same-origin.

import { createMessageHandler, defaultArchive } from './messageHandler.js';
import { createArchiveCache } from './cache.js';
import { connectionStatus, missingOrigins } from './connection.js';
import { ARCHIVE_MESSAGES, MESSAGE } from './config.js';

const api = globalThis.browser ?? globalThis.chrome;
const handle = createMessageHandler();

// Service health as observed from real archive requests only. Nothing here
// sends a probe: an idle extension makes no archive traffic. Held in memory,
// so a restarted worker simply reports "not used yet".
const health = { arctic: null, pullpush: null };

function record(response) {
    if (!response?.health) return;
    const at = Date.now();
    for (const name of ['arctic', 'pullpush']) {
        const value = response.health[name];
        if (typeof value === 'boolean') health[name] = { ok: value, at };
        // PullPush skipped by the circuit breaker: keep its last result.
        else if (value === 'paused') health[name] = { ...(health[name] || { ok: false, at }), paused: true };
    }
}

function fromPopup(sender) {
    return sender.id === api.runtime.id && Boolean(sender.url?.startsWith(api.runtime.getURL('')));
}

async function receive(message, sender) {
    if (message?.type === MESSAGE.connectionStatus) {
        // Only the extension's own popup may run a connection check.
        if (!fromPopup(sender)) return { ok: false };
        return { ...(await connectionStatus({ api })), health, saved: await createArchiveCache().size().catch(() => 0) };
    }
    if (message?.type === MESSAGE.health) {
        // Cheap poll for the popup: in-memory health only, no network.
        if (!fromPopup(sender)) return { ok: false };
        return { ok: true, health, saved: await createArchiveCache().size().catch(() => 0) };
    }
    if (message?.type === MESSAGE.clearSaved) {
        if (!fromPopup(sender)) return { ok: false };
        await defaultArchive.clear();
        return { ok: true };
    }
    if (ARCHIVE_MESSAGES.has(message?.type)) {
        const missing = await missingOrigins(api);
        if (missing.length) {
            await api.action?.setBadgeText({ text: '!' });
            await api.action?.setBadgeBackgroundColor?.({ color: '#fe5301' });
            await api.action?.setTitle({ title: 'Rosint needs site access. Click to allow.' });
            return { ok: false, error: 'host-permission-required', missing, items: [] };
        }
        await api.action?.setBadgeText({ text: '' });
        await api.action?.setTitle({ title: 'Rosint Hidden History' });
        const response = await handle(message, sender);
        record(response);
        return response;
    }
    return handle(message, sender);
}

if (api?.runtime?.onMessage) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
        receive(message, sender).then(
            (response) => sendResponse(response ?? { ok: false, items: [] }),
            () => sendResponse({ ok: false, items: [] }),
        );
        return true; // keep the channel open for the async response
    });
}
