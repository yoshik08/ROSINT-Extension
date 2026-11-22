// Toolbar popup: what Rosint is doing on the current tab, service health
// observed from real requests, and a quick way to open another profile.

import { MESSAGE } from './config.js';
import { REQUIRED_ORIGINS } from './connection.js';
import { plural, relativeTime } from './format.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const app = $('app');
const hero = $('hero');
const PROFILE = /^https:\/\/(?:www\.)?reddit\.com\/(?:user|u)\/([A-Za-z0-9_-]{2,32})(?:\/(?:overview|submitted|posts|comments)?)?\/?(?:[?#].*)?$/i;
const USERNAME = /^[A-Za-z0-9_-]{2,32}$/;

const ICONS = {
    external: 'M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5v4.25c0 .7-.55 1.25-1.25 1.25H6.25C5.55 19 5 18.45 5 17.75V8.25C5 7.55 5.55 7 6.25 7h4.25',
    retry: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
    key: 'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M6.5 10.5h11c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Z',
    open: 'M5 12h14M13 6l6 6-6 6',
};

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
}

// "Nov 11" this year, "Nov 2024" otherwise: always fits the stat column.
function compactDate(seconds) {
    const date = new Date(seconds * 1000);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' }).format(date);
}

let tab = null;
let profile = null;
let connection = null;
let lastKey = '';
let pollTimer = null;
let bootedAt = Date.now();

$('version').textContent = `v${api.runtime.getManifest().version}`;
// Firefox for Android shows the popup as a full-width sheet.
if (/Android/i.test(navigator.userAgent)) document.body.classList.add('sheet');

// Writes text only when it changes, so the 1s status poll never re-triggers
// screen readers or restarts text selection.
function setText(id, value) {
    const element = $(id);
    if (element.textContent !== value) element.textContent = value;
}

function button(label, { primary = false, iconName, onClick, href } = {}) {
    const element = document.createElement(href ? 'a' : 'button');
    element.className = primary ? 'btn primary' : 'btn';
    if (href) {
        element.href = href;
        element.target = '_blank';
        element.rel = 'noopener';
    } else element.type = 'button';
    // External links end with their arrow; actions lead with their symbol.
    const glyph = iconName ? icon(iconName) : null;
    if (glyph && iconName !== 'external') element.append(glyph);
    element.append(document.createTextNode(label));
    if (glyph && iconName === 'external') element.append(glyph);
    if (onClick) element.addEventListener('click', onClick);
    return element;
}

// One render per distinct state; polling updates numbers in place without
// replaying the transition.
function render({ key, who = '', title, lede = '', busy = false, stats = null, actions = [] }) {
    const changed = key !== lastKey;
    lastKey = key;
    app.classList.toggle('busy', busy);
    setText('who', who);
    setText('title', title);
    setText('lede', lede);
    $('progress').hidden = !busy;
    $('stats').hidden = !stats;
    if (stats) {
        setText('stat-posts', stats.posts.toLocaleString('en-US'));
        setText('stat-comments', stats.comments.toLocaleString('en-US'));
        setText('stat-since', stats.oldest ? compactDate(stats.oldest) : '–');
    }
    if (changed) {
        // One announcement per state change, never per poll.
        setText('announce', title);
        $('actions').replaceChildren(...actions);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
            hero.animate?.([
                { opacity: 0, filter: 'blur(3px)', transform: 'translateY(3px)' },
                { opacity: 1, filter: 'blur(0)', transform: 'none' },
            ], { duration: 240, easing: 'cubic-bezier(.23,1,.32,1)' });
        }
    }
}

function setService(name, tone, text) {
    const row = document.querySelector(`[data-service="${name}"]`);
    row.querySelector('.dot').className = `dot ${tone}`;
    row.querySelector('.svc-state').textContent = text;
}

function renderServices() {
    if (!connection) return;
    if (connection.missing?.length) setService('removal', 'warn', 'Needs access');
    else if (connection.ok) setService('removal', 'ok', 'Online');
    else setService('removal', 'bad', 'Unreachable');
    for (const name of ['arctic', 'pullpush']) {
        const seen = connection.health?.[name];
        if (!seen) setService(name, '', 'Not used yet');
        else if (seen.paused) setService(name, 'warn', 'Paused after an error');
        else setService(name, seen.ok ? 'ok' : 'bad', `${seen.ok ? 'Answered' : 'Failed'} ${relativeTime(seen.at / 1000)}`);
    }
    const saved = Number(connection.saved) || 0;
    $('saved').hidden = saved === 0;
    $('saved-count').textContent = saved === 1 ? '1 saved list' : `${saved} saved lists`;
}

async function retryProfile() {
    if (!tab?.id) return;
    try {
        await api.tabs.sendMessage(tab.id, { type: MESSAGE.retry });
    } catch {
        await api.tabs.reload(tab.id);
    }
    lastKey = '';
    schedule(400);
}

async function allowAccess() {
    try {
        // Must run straight from the click to keep the user gesture.
        const granted = await api.permissions.request({ origins: REQUIRED_ORIGINS });
        if (!granted) {
            render({ key: 'access-denied', title: 'Access was not granted', lede: 'Rosint can’t restore anything without it. Allow access to try again.', actions: [button('Allow access', { primary: true, iconName: 'key', onClick: allowAccess })] });
            return;
        }
        await api.action?.setBadgeText({ text: '' });
        connection = await check();
        if (profile) await retryProfile();
        refresh();
    } catch (error) {
        render({ key: 'access-error', title: 'Could not request access', lede: error.message });
    }
}

function rosintSearch(name) {
    return `https://rosint.dev/?u=${encodeURIComponent(name)}`;
}

function describe(state) {
    const name = profile;
    const who = `u/${name}`;
    const search = button('Open in Rosint', { iconName: 'external', href: rosintSearch(name) });
    if (!state) {
        if (Date.now() - bootedAt > 2500) {
            return { key: 'reload', who, title: 'Reload to start', lede: 'Rosint was installed or updated after this tab opened. Reload it so Rosint can read the profile.', actions: [button('Reload tab', { primary: true, iconName: 'retry', onClick: () => api.tabs.reload(tab.id).then(() => { bootedAt = Date.now(); schedule(800); }) })] };
        }
        return { key: 'starting', who, title: 'Starting…', busy: true };
    }
    const counts = state.counts || { posts: 0, comments: 0 };
    switch (state.phase) {
    case 'detecting':
    case 'waiting-for-feed':
        return { key: 'detecting', who, title: 'Checking this profile…', lede: 'Looking for Reddit’s hidden-history notice.', busy: true };
    case 'not-hidden':
        return { key: 'public', who, title: 'History is public', lede: 'Reddit already shows this profile’s posts and comments, so there’s nothing to restore. Rosint’s full search also finds deleted items.', actions: [search] };
    case 'empty':
        return { key: 'empty', who, title: 'No archived history yet', lede: 'Arctic Shift and PullPush have nothing saved for this account. New activity usually appears within a day or two.', actions: [button('Check again', { iconName: 'retry', onClick: retryProfile })] };
    case 'restricted':
        return { key: 'restricted', who, title: 'Not available on Rosint', lede: 'This account’s history is restricted, or Rosint couldn’t confirm it isn’t. Rosint shows nothing in either case.' };
    case 'error':
        if (state.failure === 'permission') {
            return { key: 'access', who, title: 'Allow Rosint on Reddit', lede: 'Rosint needs Reddit, the two archives and its removal check. Nothing else.', actions: [button('Allow access', { primary: true, iconName: 'key', onClick: allowAccess })] };
        }
        return { key: 'error', who, title: 'The archives didn’t answer', lede: 'Arctic Shift and PullPush may be busy or rate limiting. Give it a moment.', actions: [button('Try again', { primary: true, iconName: 'retry', onClick: retryProfile })] };
    default:
        break;
    }
    if (!state.count) {
        return { key: 'loading', who, title: 'Searching public archives…', lede: 'Asking Arctic Shift and PullPush for this account’s posts and comments.', busy: true };
    }
    const total = counts.posts + counts.comments;
    const stats = { posts: counts.posts, comments: counts.comments, oldest: state.oldest };
    if (state.offlineAt) {
        return {
            key: 'offline', who, title: 'Showing your saved copy',
            lede: `The archives aren’t answering, so this is what your browser saved ${relativeTime(state.offlineAt / 1000)}. ${plural(total, 'item')} on the page.`,
            stats, actions: [button('Try again', { primary: true, iconName: 'retry', onClick: retryProfile }), search],
        };
    }
    const lede = state.archived
        ? `${plural(total, 'item')} on the page. Saved copies, so scores and text may have changed since.`
        : `${plural(total, 'item')} on the page, checked against Reddit just now.`;
    return {
        key: 'ready',
        who,
        title: state.done ? 'History restored' : 'Restoring history',
        lede: state.done ? lede : `${lede} Scroll the profile to load more.`,
        busy: state.loading,
        stats,
        actions: [button('Reload', { iconName: 'retry', onClick: retryProfile }), search],
    };
}

async function check() {
    try {
        return await api.runtime.sendMessage({ type: MESSAGE.connectionStatus });
    } catch {
        return { ok: false, error: 'no-worker', missing: [] };
    }
}

function schedule(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, ms);
}

async function refresh() {
    renderServices();
    if (connection?.missing?.length) {
        render({ key: 'access', who: profile ? `u/${profile}` : '', title: 'Allow Rosint on Reddit', lede: 'Your browser is holding back site access. Rosint needs Reddit, Arctic Shift, PullPush and its removal check. Nothing else.', actions: [button('Allow access', { primary: true, iconName: 'key', onClick: allowAccess })] });
        return;
    }
    if (!profile) {
        const onReddit = /^https:\/\/(?:www\.)?reddit\.com\//.test(tab?.url || '');
        render({
            key: onReddit ? 'idle-reddit' : 'idle',
            title: 'Open a profile that hides its history',
            lede: 'Rosint fills it in with the posts and comments public archives saved, right on the profile.',
            actions: onReddit ? [] : [button('Go to Reddit', { iconName: 'external', href: 'https://www.reddit.com/' })],
        });
        return;
    }
    let state = null;
    try {
        state = (await api.tabs.sendMessage(tab.id, { type: MESSAGE.profileStatus }))?.state ?? null;
    } catch {
        state = null;
    }
    render(describe(state));
    try {
        const latest = await api.runtime.sendMessage({ type: MESSAGE.health });
        if (latest?.ok) connection = { ...connection, health: latest.health, saved: latest.saved };
    } catch { /* worker restarting; keep the last values */ }
    renderServices();
    const busy = !state || state.loading || ['detecting', 'loading-archive', 'checking-live', 'rendering'].includes(state.phase);
    schedule(busy ? 900 : 2500);
}

function normalizeInput(value) {
    const text = String(value || '').trim();
    const fromUrl = /reddit\.com\/(?:user|u)\/([A-Za-z0-9_-]+)/i.exec(text);
    const name = (fromUrl ? fromUrl[1] : text).replace(/^\/?(?:u|user)\//i, '').replace(/\/+$/, '');
    return USERNAME.test(name) ? name : null;
}

$('lookup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const hint = $('lookup-hint');
    const name = normalizeInput($('username').value);
    if (!name) {
        hint.textContent = 'Usernames are 2–32 letters, numbers, dashes or underscores.';
        hint.hidden = false;
        return;
    }
    hint.hidden = true;
    const url = `https://www.reddit.com/user/${name}/`;
    if (tab?.id && /^https:\/\/(?:www\.)?reddit\.com\//.test(tab.url || '')) await api.tabs.update(tab.id, { url });
    else await api.tabs.create({ url });
    window.close();
});
$('username').addEventListener('input', () => { $('lookup-hint').hidden = true; });

$('forget').addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: MESSAGE.clearSaved }).catch(() => null);
    connection = { ...connection, saved: 0 };
    renderServices();
});

(async () => {
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
    profile = PROFILE.exec(tab?.url || '')?.[1] ?? null;
    connection = await check();
    await refresh();
})().catch((error) => {
    render({ key: 'fatal', title: 'Something went wrong', lede: error?.message || 'Close and reopen this panel.' });
});
