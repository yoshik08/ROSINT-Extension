// @vitest-environment happy-dom
// Signed-out fallback: when Reddit refuses an NSFW community or post behind
// its age gate, Arctic Shift's copy is shown in its place. Fixtures are the
// minimal structure of Reddit's two refusals (Nov 2026).
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { archiveTarget, createFallback, findRefusal, parseArchivePath } from '../../shared/fallback.js';
import { MESSAGE } from '../../shared/config.js';
import { NSFW_GATE_ATTR, QUIET_ATTR, SIGNED_OUT_ATTR } from '../../shared/quiet.js';

const communityRefusal = `
  <main id="main-content"><div class="error"><span>Sorry, there aren’t any communities on Reddit with that name.</span>
  <span id="community-content-error-message">This community may have been banned or the community name is incorrect.</span></div></main>`;
const threadRefusal = `
  <reddit-header-large><header>Reddit</header></reddit-header-large>
  <guard-community-modal subredditname="example" subredditid="t5_x"><div slot="title">Community not found</div></guard-community-modal>`;

const ref = (kind, id, ts, extra = {}) => ({
    kind,
    id,
    fullname: `${kind === 'posts' ? 't3' : 't1'}_${id}`,
    createdUtc: ts,
    data: kind === 'posts'
        ? { id, name: `t3_${id}`, author: 'op', title: `title ${id}`, subreddit: 'example', permalink: `/r/example/comments/${id}/x/`, created_utc: ts, over_18: true, url: `https://i.redd.it/${id}.jpg`, images: [{ url: `https://i.redd.it/${id}.jpg` }], ...extra }
        : { id, name: `t1_${id}`, author: 'someone', body: `comment ${id}`, subreddit: 'example', link_id: 't3_p1', parent_id: 't3_p1', permalink: `/r/example/comments/p1/x/${id}/`, created_utc: ts, ...extra },
});

function setQuiet({ on = true, signedOut = true, gate = null } = {}) {
    const root = document.documentElement;
    root.toggleAttribute(QUIET_ATTR, on);
    root.toggleAttribute(SIGNED_OUT_ATTR, signedOut);
    if (gate) root.setAttribute(NSFW_GATE_ATTR, gate);
    else root.removeAttribute(NSFW_GATE_ATTR);
}

const win = (pathname) => ({ location: { pathname }, setTimeout, clearTimeout });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    document.body.replaceChildren();
    document.body.className = '';
    setQuiet();
});

describe('which pages it takes over', () => {
    test('community and post paths', () => {
        expect(parseArchivePath('/r/Example/')).toEqual({ scope: 'community', subreddit: 'Example', key: 'r:example' });
        expect(parseArchivePath('/r/example/top/')).toMatchObject({ scope: 'community' });
        expect(parseArchivePath('/r/example/comments/AbC12/some_title/')).toEqual({ scope: 'thread', subreddit: 'example', post: 'abc12', key: 't:abc12' });
        expect(parseArchivePath('/r/example/comments/abc12/some_title/c9/')).toMatchObject({ post: 'abc12' });
        for (const path of ['/', '/user/x/', '/r/example/wiki/', '/r/example/about/', '/r/a/']) expect(parseArchivePath(path)).toBeNull();
    });

    test('only a refused page behind the NSFW gate, signed out, with Quiet Reddit on', () => {
        document.body.innerHTML = communityRefusal;
        setQuiet({ gate: '/r/example/' });
        expect(archiveTarget(document, win('/r/example/'))).toMatchObject({ scope: 'community', subreddit: 'example' });
        // A mistyped community never showed the NSFW gate: Reddit's own answer stays.
        setQuiet({ gate: null });
        expect(archiveTarget(document, win('/r/example/'))).toBeNull();
        setQuiet({ gate: '/r/other/' });
        expect(archiveTarget(document, win('/r/example/'))).toBeNull();
        setQuiet({ gate: '/r/example/', signedOut: false });
        expect(archiveTarget(document, win('/r/example/'))).toBeNull();
        setQuiet({ gate: '/r/example/', on: false });
        expect(archiveTarget(document, win('/r/example/'))).toBeNull();
    });

    test('a gate still on the page counts (Quiet Reddit has not run yet)', () => {
        document.body.innerHTML = `${communityRefusal}<rpl-dialog dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking"></rpl-dialog>`;
        setQuiet({ gate: null });
        expect(archiveTarget(document, win('/r/example/'))).not.toBeNull();
    });

    test('the over-18 guard is not a refusal; the "not found" guard is', () => {
        document.body.innerHTML = '<guard-community-modal subredditid="t5_x"><div id="nsfw-action-button"><button>Yes</button></div></guard-community-modal>';
        expect(findRefusal(document)).toBeNull();
        document.body.innerHTML = threadRefusal;
        expect(findRefusal(document)).toMatchObject({ kind: 'guard' });
        // No community id: the community really does not exist.
        document.body.innerHTML = '<guard-community-modal><div>Community not found</div></guard-community-modal>';
        expect(findRefusal(document)).toBeNull();
    });
});

describe('a refused community', () => {
    test('shows the archive’s posts in place of the error, unblurred, and pages on scroll', async () => {
        document.body.innerHTML = communityRefusal;
        document.body.className = 'rpl-scroll-lock';
        setQuiet({ gate: '/r/example/' });
        const first = Array.from({ length: 8 }, (_, i) => ref('posts', `a${i}`, 300 - i));
        const pages = [
            { ok: true, items: first, done: false },
            { ok: true, items: [ref('posts', 'c', 100)], done: true },
        ];
        const archive = vi.fn(async () => pages.shift());
        let more = null;
        const fallback = createFallback({ doc: document, win: win('/r/example/'), archive, createObserver: (callback) => { more = callback; return { observe() {}, disconnect() {} }; } });
        fallback.sync();
        await flush();
        expect(archive).toHaveBeenCalledWith({ type: MESSAGE.communityPage, subreddit: 'example', before: null });
        const feed = document.querySelector('main > [data-rosint-feed]');
        expect(feed).not.toBeNull();
        expect(document.querySelector('main > .error').style.display).toBe('none');
        expect(document.body.classList.contains('rpl-scroll-lock')).toBe(false);
        const rows = [...document.querySelectorAll('[data-rosint-item]')];
        expect(rows.map((row) => row.getAttribute('data-rosint-fullname'))).toEqual(first.map((item) => item.fullname));
        expect(rows.every((row) => row.hasAttribute('data-rosint-archived'))).toBe(true);
        // NSFW media is shown as is: no veil.
        expect(rows[0].shadowRoot.querySelector('.media')).not.toBeNull();
        expect(rows[0].shadowRoot.querySelector('.veil')).toBeNull();
        const header = document.querySelector('[data-rosint-header]').shadowRoot.textContent;
        expect(header).toContain('8 posts from r/example');
        expect(header).not.toContain('Open in Rosint');

        more();
        await flush();
        expect(archive).toHaveBeenLastCalledWith({ type: MESSAGE.communityPage, subreddit: 'example', before: 294 });
        expect(document.querySelectorAll('[data-rosint-item]')).toHaveLength(9);
        expect(fallback.status()).toMatchObject({ scope: 'community', subreddit: 'example', counts: { posts: 9, comments: 0 } });

        fallback.stop();
        expect(document.querySelector('[data-rosint-feed]')).toBeNull();
        expect(document.querySelector('main > .error').hasAttribute('style')).toBe(false);
    });

    test('pages where moderators removed nearly everything keep reading until the screen fills', async () => {
        document.body.innerHTML = communityRefusal;
        setQuiet({ gate: '/r/example/' });
        let ts = 10000;
        const page = () => ({ ok: true, done: false, items: Array.from({ length: 10 }, (_, i) => ref('posts', `p${ts}_${i}`, ts--, i < 7 ? { removed_by_category: 'moderator', selftext: '[removed]' } : {})) });
        const archive = vi.fn(async () => page());
        const fallback = createFallback({ doc: document, win: win('/r/example/'), archive, createObserver: () => ({ observe() {}, disconnect() {} }) });
        fallback.sync();
        await flush();
        // Three visible rows per page: three pages make the eight a scroll needs.
        expect(archive).toHaveBeenCalledTimes(3);
        expect(document.querySelectorAll('[data-rosint-item]')).toHaveLength(9);
        fallback.stop();
    });

    test('a removed post with no comments says it was removed, not that it is missing', async () => {
        document.body.innerHTML = threadRefusal;
        setQuiet({ gate: '/r/example/comments/p1/x/' });
        const archive = async (message) => (message.kind === 'posts'
            ? { ok: true, items: [ref('posts', 'p1', 100, { removed_by_category: 'content_takedown', selftext: '[removed]' })], done: true }
            : { ok: true, items: [], done: true });
        const fallback = createFallback({ doc: document, win: win('/r/example/comments/p1/x/'), archive, createObserver: () => ({ observe() {}, disconnect() {} }) });
        fallback.sync();
        await flush();
        expect(document.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain('This post was removed');
        fallback.stop();
    });

    test('nothing archived, removal check unconfirmed, and archive down each say so', async () => {
        for (const [response, text] of [
            [{ ok: true, items: [], done: true }, 'Nothing archived for r/example'],
            [{ ok: true, restricted: true, items: [], done: true }, 'r/example can’t be shown right now'],
            [{ ok: false, items: [] }, 'The archive isn’t answering'],
        ]) {
            document.body.innerHTML = communityRefusal;
            setQuiet({ gate: '/r/example/' });
            const fallback = createFallback({ doc: document, win: win('/r/example/'), archive: async () => response, autoRetryMs: null, createObserver: () => ({ observe() {}, disconnect() {} }) });
            fallback.sync();
            await flush();
            expect(document.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain(text);
            fallback.stop();
        }
    });
});

describe('a refused post', () => {
    test('gets its own column below the header, the post first and then its comments', async () => {
        document.body.innerHTML = threadRefusal;
        setQuiet({ gate: '/r/example/comments/p1/x/' });
        const archive = vi.fn(async (message) => (message.kind === 'posts'
            ? { ok: true, items: [ref('posts', 'p1', 100)], done: true }
            : { ok: true, items: [ref('comments', 'c1', 200), ref('comments', 'c2', 300)], done: true }));
        const fallback = createFallback({ doc: document, win: win('/r/example/comments/p1/x/'), archive, createObserver: () => ({ observe() {}, disconnect() {} }) });
        fallback.sync();
        await flush();
        expect(archive).toHaveBeenCalledWith({ type: MESSAGE.threadPage, post: 'p1', kind: 'posts', before: null });
        expect(archive).toHaveBeenCalledWith({ type: MESSAGE.threadPage, post: 'p1', kind: 'comments', before: null });
        const page = document.querySelector('reddit-header-large + [data-rosint-page]');
        expect(page).not.toBeNull();
        expect(document.querySelector('guard-community-modal').style.display).toBe('none');
        expect([...page.querySelectorAll('[data-rosint-item]')].map((row) => row.getAttribute('data-rosint-fullname'))).toEqual(['t3_p1', 't1_c2', 't1_c1']);
        expect(page.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain('Post and 2 comments from the archive');
        fallback.stop();
        expect(document.querySelector('[data-rosint-page]')).toBeNull();
        expect(document.querySelector('guard-community-modal').hasAttribute('style')).toBe(false);
    });

    test('leaving the page removes the fallback; Reddit re-rendering around it does not', async () => {
        document.body.innerHTML = threadRefusal;
        setQuiet({ gate: '/r/example/comments/p1/x/' });
        const location = { pathname: '/r/example/comments/p1/x/' };
        const archive = vi.fn(async () => ({ ok: true, items: [], done: true }));
        const fallback = createFallback({ doc: document, win: { location, setTimeout, clearTimeout }, archive, autoRetryMs: null, createObserver: () => ({ observe() {}, disconnect() {} }) });
        fallback.sync();
        await flush();
        const calls = archive.mock.calls.length;
        // Same page, the guard re-rendered without its id: keep what is there.
        document.querySelector('guard-community-modal').removeAttribute('subredditid');
        fallback.sync();
        expect(document.querySelector('[data-rosint-page]')).not.toBeNull();
        expect(archive.mock.calls.length).toBe(calls);
        location.pathname = '/r/popular/';
        fallback.sync();
        expect(document.querySelector('[data-rosint-page]')).toBeNull();
    });
});
