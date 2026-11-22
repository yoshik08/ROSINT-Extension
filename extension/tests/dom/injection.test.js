// @vitest-environment happy-dom
// Small hand-written fixtures: only the container structure Reddit's feed
// needs (a feed element, an empty-state block, a native item when relevant).
// No Reddit markup, classes or styles are copied.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createInjector } from '../../shared/injector.js';
import { createInfoClient } from '../../shared/reddit.js';
import { createItem, findFeed, fullnamesIn, parseProfilePath, resolveItemTag } from '../../shared/nativeFeed.js';

if (!customElements.get('shreddit-post')) customElements.define('shreddit-post', class extends HTMLElement {});
if (!customElements.get('shreddit-profile-comment')) customElements.define('shreddit-profile-comment', class extends HTMLElement {});

const postChild = (id, ts, extra = {}) => ({
    kind: 't3',
    data: {
        id,
        name: `t3_${id}`,
        author: 'hidden-user',
        created_utc: ts,
        subreddit: 'pics',
        subreddit_id: 't5_pics',
        permalink: `/r/pics/comments/${id}/slug/`,
        url: `https://example.test/${id}.jpg`,
        domain: 'i.redd.it',
        title: `title ${id}`,
        selftext: '',
        selftext_html: null,
        score: 10,
        num_comments: 2,
        ...extra,
    },
});

const commentChild = (id, ts, postId, extra = {}) => ({
    kind: 't1',
    data: {
        id,
        name: `t1_${id}`,
        author: 'hidden-user',
        created_utc: ts,
        subreddit: 'pics',
        link_id: `t3_${postId}`,
        parent_id: `t3_${postId}`,
        body: `body ${id}`,
        body_html: `<div>body ${id}</div>`,
        score: 3,
        permalink: `/r/pics/comments/${postId}/slug/${id}/`,
        ...extra,
    },
});

const ref = (kind, item, createdUtc) => ({
    kind,
    id: item.data.id,
    fullname: item.data.name,
    createdUtc,
});

function archiveWith(pages) {
    const index = { posts: 0, comments: 0 };
    return vi.fn(async ({ kind, before, cacheOnly }) => {
        if (cacheOnly) return { ok: true, restricted: false, items: [], cached: false };
        // A run without a cursor starts from the newest page, like the archive.
        if (before == null) index[kind] = 0;
        const list = pages[kind] ?? [];
        const at = index[kind] ?? 0;
        index[kind] = at + 1;
        const items = list[at] ?? [];
        return { ok: true, restricted: false, items, done: at + 1 >= list.length };
    });
}

function feedMarkup(extra = '') {
    return `<main><shreddit-feed id="main-feed"><div id="empty-state">Nothing here yet</div>${extra}</shreddit-feed></main>`;
}

function setup({ pages, children, search = '', html = feedMarkup(), parentTitle = 'Parent title' } = {}) {
    const byId = new Map(children.map((child) => [child.data.name, child]));
    const win = { location: { search, pathname: '/' }, addEventListener() {}, removeEventListener() {} };
    let wake = null;
    const injector = createInjector({
        doc: document,
        win,
        archive: archiveWith(pages),
        info: vi.fn(async (ids) => ids.map((id) => byId.get(id)).filter(Boolean)),
        postInfo: async () => [{ id: 'p1', title: parentTitle, permalink: '/r/pics/comments/p1/slug/', subreddit: 'pics' }],
        detect: vi.fn(async () => ({ hidden: true })),
        now: () => 10_000_000,
        createObserver: (callback) => {
            wake = callback;
            return { observe() {}, disconnect() {} };
        },
    });
    document.body.innerHTML = html;
    return { injector, win, scroll: () => wake?.() };
}

const injected = () => [...document.querySelectorAll('[data-rosint-item]')];

beforeEach(() => {
    document.body.innerHTML = '';
});


describe('profile path parsing', () => {
    test.each([
        ['/user/someone', { username: 'someone', tab: 'overview' }],
        ['/u/someone/', { username: 'someone', tab: 'overview' }],
        ['/user/someone/submitted', { username: 'someone', tab: 'posts' }],
        ['/user/someone/comments', { username: 'someone', tab: 'comments' }],
        ['/user/someone/overview', { username: 'someone', tab: 'overview' }],
    ])('%s is a profile feed', (path, expected) => {
        expect(parseProfilePath(path)).toEqual(expected);
    });

    test.each(['/', '/r/pics', '/user/someone/comments/abc123/slug/', '/user/someone/saved', '/user/'])(
        '%s is not a profile feed',
        (path) => expect(parseProfilePath(path)).toBeNull(),
    );
});

describe('injection', () => {
    const post = postChild('p1', 300);
    const comment = commentChild('c1', 200, 'p1');

    test('a page that cannot construct Reddit components still gets visible cards', async () => {
        document.body.innerHTML = feedMarkup();
        const doc = new Proxy(document, { get(target, key) {
            if (key === 'createElement') return (tag) => {
                if (/^(?:shreddit|faceplate)-/.test(tag)) throw new Error('Component unavailable');
                return document.createElement(tag);
            };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        const injector = createInjector({
            doc, win: window,
            archive: archiveWith({ posts: [[{ ...ref('posts', post, 300), data: post.data }]] }),
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(1);
        expect(injected()[0].shadowRoot.querySelector('[slot="title"]').textContent).toBe('title p1');
        expect(injector.snapshot().error).toBeNull();
        injector.stop();
    });

    test('JSON denial uses labeled archive text and restores the hidden panel on stop', async () => {
        document.body.innerHTML = '<main><nav>Overview Posts Comments</nav><section style="text-align:center"><h2>Welcome!</h2><p><span>u/hidden-user likes to keep their posts hidden, but check out their stats to learn more about them.</span></p></section></main>';
        const original = document.body.innerHTML;
        const injector = createInjector({
            doc: document, win: window,
            archive: archiveWith({ posts: [[{ ...ref('posts', post, 300), data: post.data }, { ...ref('posts', postChild('gone', 100, { selftext: '[removed]' }), 100), data: postChild('gone', 100, { selftext: '[removed]' }).data }]] }),
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(1);
        expect(injected()[0].hasAttribute('data-rosint-archived')).toBe(true);
        expect(injected()[0].shadowRoot.querySelector('time').title).toContain('Archived copy');
        expect(injected()[0].shadowRoot.textContent).toContain('title p1');
        expect(document.querySelector('nav').style.display).toBe('');
        injector.stop();
        expect(document.body.innerHTML).toBe(original);
    });

    test('real info client hydrates both kinds, including colliding bare IDs', async () => {
        document.body.innerHTML = feedMarkup();
        const children = [postChild('abc', 300), commentChild('abc', 200, 'p1')];
        const requested = [];
        const fetchImpl = vi.fn(async (path) => {
            const ids = new URL(path, 'https://www.reddit.com').searchParams.get('id').split(',');
            requested.push(...ids);
            return new Response(JSON.stringify({ data: { children: children.filter((child) => ids.includes(child.data.name)) } }));
        });
        const injector = createInjector({
            doc: document,
            win: window,
            archive: archiveWith({ posts: [[ref('posts', children[0], 300)]], comments: [[ref('comments', children[1], 200)]] }),
            info: createInfoClient({ fetchImpl }),
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'overview' });
        // Each kind is hydrated as soon as its page arrives, by fullname.
        expect(requested.sort()).toEqual(['t1_abc', 't3_abc']);
        expect(injected()).toHaveLength(2);
        expect(injected()[0].shadowRoot.querySelector('[slot="title"]').textContent).toBe('title abc');
        expect(injected()[1].shadowRoot.querySelector('[slot="comment-body"]').textContent).toBe('body abc');
        injector.stop();
    });

    test('retries when the profile feed mounts after detection', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]] }, children: [post], html: '<main></main>',
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(0);
        document.body.innerHTML = feedMarkup();
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(1);
        injector.stop();
    });

    test('overview replaces the empty state with posts and comments interleaved', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });

        await injector.start({ username: 'hidden-user', tab: 'overview' });

        expect(injected().map((element) => element.getAttribute('data-rosint-fullname'))).toEqual(['t3_p1', 't1_c1']);
        expect(injected().map((element) => element.tagName.toLowerCase())).toEqual(['article', 'article']);
        expect(document.getElementById('empty-state').style.display).toBe('none');
        expect(document.querySelector('[data-rosint-sentinel]')).not.toBeNull();
        expect(injector.snapshot()).toMatchObject({ key: 'hidden-user:overview', emptyHidden: true });
    });

    test('the posts tab asks only for posts and injects only posts', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });

        await injector.start({ username: 'hidden-user', tab: 'posts' });

        expect(injected()).toHaveLength(1);
        expect(injected()[0].tagName.toLowerCase()).toBe('article');
        expect(injector.snapshot().fullnames).toEqual(['t3_p1']);
    });

    test('the comments tab fills the parent post title natively', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });

        await injector.start({ username: 'hidden-user', tab: 'comments' });

        const [element] = injected();
        expect(element.tagName.toLowerCase()).toBe('article');
        // The title arrives after the row is drawn, so a slow lookup never blocks it.
        await vi.waitFor(() => expect(element.shadowRoot.querySelector('[slot="parent-title"]')?.textContent).toBe('Parent title'));
        expect(element.getAttribute('subreddit-prefixed-name')).toBe('r/pics');
        expect(element.getAttribute('permalink')).toBe('/r/pics/comments/p1/slug/c1/');
    });

    test('five SPA re-runs never inject a second copy', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });

        for (let index = 0; index < 5; index += 1) {
            await injector.start({ username: 'hidden-user', tab: 'overview' });
        }

        expect(injected()).toHaveLength(2);
        expect(injector.snapshot().fullnames.sort()).toEqual(['t1_c1', 't3_p1']);
    });

    test('switching tabs replaces only the injected items', async () => {
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });

        await injector.start({ username: 'hidden-user', tab: 'overview' });
        await injector.start({ username: 'hidden-user', tab: 'posts' });

        expect(injected().map((element) => element.getAttribute('data-rosint-fullname'))).toEqual(['t3_p1']);
        expect(document.getElementById('empty-state').style.display).toBe('none');
    });

    test('navigating away mid-fetch aborts without injecting', async () => {
        let release;
        const slow = new Promise((resolve) => { release = resolve; });
        const win = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
        const archive = vi.fn(() => slow);
        const injector = createInjector({
            doc: document,
            win,
            archive,
            info: async () => [post],
            postInfo: async () => [],
            detect: async () => ({ hidden: true }),
            now: () => 10_000_000,
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        document.body.innerHTML = feedMarkup();

        const running = injector.start({ username: 'hidden-user', tab: 'posts' });
        await vi.waitFor(() => expect(archive).toHaveBeenCalled());
        injector.stop();
        release({ ok: true, items: [ref('posts', post, 300)], done: true });
        await running;

        expect(injected()).toHaveLength(0);
        expect(document.getElementById('empty-state').style.display).toBe('');
        expect(injector.snapshot()).toBeNull();
    });

    test('items Reddit already shows are not injected again', async () => {
        const fresh = postChild('fresh', 100);
        const native = postChild('native', 400);
        const { injector } = setup({
            pages: { posts: [[ref('posts', native, 400), ref('posts', fresh, 100)]] },
            children: [native, fresh],
            html: feedMarkup('<shreddit-post id="t3_native" post-id="native"></shreddit-post>'),
        });

        await injector.start({ username: 'hidden-user', tab: 'posts' });

        expect(injected().map((element) => element.getAttribute('data-rosint-fullname'))).toEqual(['t3_fresh']);
        expect(fullnamesIn(findFeed(document), { includeInjected: true }).has('t3_native')).toBe(true);
    });

    test('infinite scroll loads the next archive page', async () => {
        const first = postChild('p1', 300);
        const second = postChild('p2', 200);
        const { injector, scroll } = setup({
            pages: { posts: [[ref('posts', first, 300)], [ref('posts', second, 200)]] },
            children: [first, second],
        });

        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(1);

        scroll();
        await vi.waitFor(() => expect(injected()).toHaveLength(2));
        expect(injected().map((element) => element.getAttribute('data-rosint-fullname'))).toEqual(['t3_p1', 't3_p2']);
    });

    test("an empty archive restores Reddit's empty state and explains why", async () => {
        const { injector } = setup({ pages: { posts: [[]] }, children: [] });

        await injector.start({ username: 'hidden-user', tab: 'posts' });

        expect(injected()).toHaveLength(0);
        expect(document.getElementById('empty-state').style.display).toBe('');
        expect(document.querySelector('[data-rosint-sentinel]')).toBeNull();
        expect(injector.snapshot().phase).toBe('empty');
        const header = document.querySelector('[data-rosint-header]').shadowRoot.textContent;
        expect(header).toContain('No archived history for u/hidden-user');
        injector.stop();
        expect(document.querySelector('[data-rosint-feed]')).toBeNull();
    });

    test('a restricted account shows nothing and says so', async () => {
        document.body.innerHTML = feedMarkup();
        const injector = createInjector({
            doc: document, win: window,
            archive: async () => ({ ok: true, restricted: true, items: [], done: true }),
            info: async () => [],
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'overview' });
        expect(injected()).toHaveLength(0);
        expect(injector.snapshot().phase).toBe('restricted');
        expect(document.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain('not available on Rosint');
        injector.stop();
    });

    test('an archive outage offers a retry that starts a fresh run', async () => {
        document.body.innerHTML = feedMarkup();
        let calls = 0;
        const post = postChild('p1', 300);
        const injector = createInjector({
            doc: document, win: window,
            archive: async ({ cacheOnly }) => (cacheOnly ? { ok: true, items: [] } : ++calls === 1 ? { ok: false, items: [] } : { ok: true, restricted: false, items: [{ ...ref('posts', post, 300), data: post.data }], done: true }),
            autoRetryMs: null,
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injector.snapshot().phase).toBe('error');
        const retry = [...document.querySelector('[data-rosint-header]').shadowRoot.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent));
        expect(retry.hidden).toBe(false);
        retry.click();
        await vi.waitFor(() => expect(injected()).toHaveLength(1));
        expect(injector.snapshot().phase).toBe('ready');
        injector.stop();
    });

    test('ready header counts what was restored and marks the end of history', async () => {
        const post = postChild('p1', 300);
        const comment = commentChild('c1', 200, 'p1');
        const { injector } = setup({
            pages: { posts: [[ref('posts', post, 300)]], comments: [[ref('comments', comment, 200)]] },
            children: [post, comment],
        });
        await injector.start({ username: 'hidden-user', tab: 'overview' });
        const header = document.querySelector('[data-rosint-header]').shadowRoot.textContent;
        expect(header).toContain('1 post and 1 comment restored');
        const footer = document.querySelector('[data-rosint-footer]').shadowRoot.textContent;
        expect(footer).toContain('everything the archives have');
        expect(injector.snapshot()).toMatchObject({ counts: { posts: 1, comments: 1 }, done: true, oldest: 200 });
        injector.stop();
    });

    test('a profile with visible history is never touched', async () => {
        const { injector } = setup({ pages: { posts: [[]] }, children: [] });
        injector.stop();

        const doc = document;
        doc.body.innerHTML = feedMarkup('<shreddit-post id="t3_visible"></shreddit-post>');
        const win = { location: { search: '' }, addEventListener() {}, removeEventListener() {} };
        const visible = createInjector({
            doc,
            win,
            archive: vi.fn(),
            info: vi.fn(),
            detect: async () => ({ hidden: false, reason: 'ok' }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });

        await visible.start({ username: 'visible-user', tab: 'overview' });

        expect(injected()).toHaveLength(0);
        expect(doc.getElementById('empty-state').style.display).toBe('');
        expect(doc.querySelector('shreddit-post#t3_visible')).not.toBeNull();
    });
});

describe('resilience', () => {
    const post = postChild('p1', 300);
    const savedRef = { ...ref('posts', post, 300), data: post.data };

    test('rows saved on an earlier visit paint before the archive answers', async () => {
        document.body.innerHTML = feedMarkup();
        let release;
        const live = new Promise((resolve) => { release = resolve; });
        const injector = createInjector({
            doc: document, win: window,
            archive: async ({ cacheOnly }) => (cacheOnly
                ? { ok: true, items: [savedRef], cached: true, cachedAt: Date.now() - 3_600_000, done: true }
                : live),
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        const run = injector.start({ username: 'hidden-user', tab: 'posts' });
        await vi.waitFor(() => expect(injected()).toHaveLength(1));
        expect(document.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain('Saved in your browser 1h ago');
        release({ ok: true, restricted: false, items: [savedRef, { ...ref('posts', postChild('p2', 400), 400), data: postChild('p2', 400).data }], done: true });
        await run;
        expect(injected()).toHaveLength(2);
        expect(injector.snapshot().phase).toBe('ready');
        injector.stop();
    });

    test('when both archives fail the saved copy is shown and labelled', async () => {
        document.body.innerHTML = feedMarkup();
        const injector = createInjector({
            doc: document, win: window,
            archive: async ({ cacheOnly }) => (cacheOnly
                ? { ok: true, items: [], cached: false }
                : { ok: true, items: [savedRef], cached: true, cachedAt: Date.now() - 7_200_000, done: true }),
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected()).toHaveLength(1);
        const header = document.querySelector('[data-rosint-header]').shadowRoot;
        expect(header.textContent).toContain('this is what your browser saved 2h ago');
        expect([...header.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent)).hidden).toBe(false);
        injector.stop();
    });

    test('an outage retries once by itself before asking the viewer', async () => {
        document.body.innerHTML = feedMarkup();
        let calls = 0;
        const injector = createInjector({
            doc: document, win: window,
            archive: async ({ cacheOnly }) => (cacheOnly ? { ok: true, items: [] } : ++calls === 1 ? { ok: false, items: [] } : { ok: true, restricted: false, items: [savedRef], done: true }),
            info: async () => { throw new Error('403'); },
            detect: async () => ({ hidden: true }),
            createObserver: () => ({ observe() {}, disconnect() {} }),
            autoRetryMs: 10,
        });
        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(document.querySelector('[data-rosint-header]').shadowRoot.textContent).toContain('Trying again in a moment');
        await vi.waitFor(() => expect(injected()).toHaveLength(1));
        expect(calls).toBe(2);
        injector.stop();
    });
});

describe('sort dropdown', () => {
    test('re-orders injected items for top and hides out-of-range rows', async () => {
        const old = postChild('old', 1_000, { score: 500 });
        const recent = postChild('recent', 9_000, { score: 1 });
        const { injector, win } = setup({
            pages: { posts: [[ref('posts', old, 1_000), ref('posts', recent, 9_000)]] },
            children: [old, recent],
            search: '?sort=new',
        });

        await injector.start({ username: 'hidden-user', tab: 'posts' });
        expect(injected().map((element) => element.getAttribute('data-rosint-fullname'))).toEqual(['t3_recent', 't3_old']);

        win.location.search = '?sort=top&t=hour';
        injector.refreshSort();
        expect(injected().filter((element) => !element.hidden).map((element) => element.getAttribute('data-rosint-fullname')))
            .toEqual(['t3_recent']);

        win.location.search = '?sort=top&t=all';
        injector.refreshSort();
        expect(injected().filter((element) => !element.hidden).map((element) => element.getAttribute('data-rosint-fullname')))
            .toEqual(['t3_old', 't3_recent']);
    });
});

describe('component construction', () => {
    test('post items carry live data as attributes and nothing invented', () => {
        const element = createItem('posts', { fullname: 't3_p1', data: postChild('p1', 300, { over_18: true }).data }, { index: 4 });
        expect(element.tagName.toLowerCase()).toBe('article');
        expect(element.getAttribute('post-title')).toBe('title p1');
        expect(element.getAttribute('permalink')).toBe('/r/pics/comments/p1/slug/');
        expect(element.getAttribute('content-href')).toBe('https://www.reddit.com/r/pics/comments/p1/slug/');
        expect(element.getAttribute('score')).toBe('10');
        expect(element.getAttribute('comment-count')).toBe('2');
        expect(element.getAttribute('created-timestamp')).toBe('1970-01-01T00:05:00.000Z');
        expect(element.getAttribute('feedindex')).toBe('4');
        expect(element.hasAttribute('nsfw')).toBe(true);
        expect(element.hasAttribute('spoiler')).toBe(false);
    });

    test('the documented Reddit components are used for each kind', () => {
        expect(resolveItemTag('posts')).toBe('shreddit-post');
        expect(resolveItemTag('comments')).toBe('shreddit-profile-comment');
    });

    // Chrome's content-script world has customElements === null, so registration
    // is not checkable; creation itself is the contract. This keeps the item
    // builder working on a document with no registered components.
    test('items are built even when no component is registered in this world', () => {
        const doc = document.implementation.createHTMLDocument('plain');
        const element = createItem('posts', { fullname: 't3_p1', data: postChild('p1', 300).data }, { doc });
        expect(element).not.toBeNull();
        expect(element.tagName.toLowerCase()).toBe('article');
        expect(element.getAttribute('post-title')).toBe('title p1');
    });
});
