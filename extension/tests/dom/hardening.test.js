// @vitest-environment happy-dom
// Regression tests for the 1.3.0 quality pass: hostile archive text, unsafe
// link targets, request storms while waiting for Reddit's feed, concurrent
// saves, and Reddit's localised hidden-history notice.
import { describe, expect, test } from 'vitest';
import { renderMarkdown, safeHref } from '../../shared/markdown.js';
import { fillVisibleCard, permalinkOf, setParentTitle } from '../../shared/visibleCard.js';
import { createArchiveCache, memoryArea } from '../../shared/cache.js';
import { createInjector } from '../../shared/injector.js';
import { detectHiddenHistory } from '../../shared/reddit.js';
import { findEmptyState, findFeed, findHiddenPanel, findNoticeBlock } from '../../shared/nativeFeed.js';

const BACKSLASH = '\\';

function html(source) {
    const box = document.createElement('div');
    box.appendChild(renderMarkdown(document, source));
    return box;
}

describe('link targets', () => {
    test('a backslash cannot turn a Reddit-relative link into another host', () => {
        const sneaky = `/${BACKSLASH}evil.example/path`;
        // This is what the browser would do with it:
        expect(new URL(sneaky, 'https://www.reddit.com').host).toBe('evil.example');
        expect(safeHref(sneaky)).toBeNull();
        expect(safeHref(`https://ok.example/${BACKSLASH}x`)).toBeNull();
        expect(permalinkOf({ permalink: sneaky })).toBeNull();
        expect(permalinkOf({ permalink: '//evil.example/x' })).toBeNull();
        expect(permalinkOf({ permalink: '/r/pics/comments/abc/slug/' })).toBe('/r/pics/comments/abc/slug/');
    });

    test('control characters that the URL parser strips cannot smuggle a scheme', () => {
        expect(safeHref('java\tscript:alert(1)')).toBeNull();
        expect(safeHref('\u0001javascript:alert(1)')).toBeNull();
        expect(safeHref('javascript:alert(1)')).toBeNull();
        expect(safeHref('data:text/html,hi')).toBeNull();
    });

    test('markdown links with a backslash target render as plain text', () => {
        const box = html(`[looks internal](/${BACKSLASH}evil.example)`);
        expect(box.querySelector('a')).toBeNull();
        expect(box.textContent).toContain('looks internal');
    });

    test('an archive parent permalink is validated before it becomes a link', () => {
        const host = document.createElement('article');
        const data = { id: 'c1', name: 't1_c1', body: 'hi', author: 'a', subreddit: 'pics', created_utc: 1700000000, permalink: '/r/pics/comments/p1/slug/c1/', link_id: 't3_p1', parent_id: 't3_p1' };
        fillVisibleCard(host, 'comments', { kind: 'comments', data }, { doc: document, parent: null, now: 1700000100000 });
        setParentTitle(host, data, { id: 'p1', title: 'Parent', permalink: 'javascript:alert(1)' }, document);
        const link = host.shadowRoot.querySelector('[slot="parent-title"]');
        expect(link.getAttribute('href')).toBe('/r/pics/comments/p1/slug/');
    });
});

describe('hostile markdown', () => {
    const cases = {
        carets: '^'.repeat(40000),
        stars: '*a '.repeat(13000),
        underscores: '_a '.repeat(13000),
        tildes: '~~a '.repeat(10000),
        brackets: '['.repeat(40000),
        spoilers: '>!'.repeat(20000),
        backticks: '`a '.repeat(13000),
        superscripts: '^('.repeat(20000),
        links: '[a](b '.repeat(6000),
    };
    for (const [name, source] of Object.entries(cases)) {
        test(`${name} renders in bounded time`, () => {
            const started = performance.now();
            expect(() => renderMarkdown(document, source)).not.toThrow();
            expect(performance.now() - started).toBeLessThan(2000);
        });
    }

    test('ordinary emphasis still renders after the scan changes', () => {
        const box = html('*one* **two** _three_ ~~four~~ `five` ^six >!seven!<');
        expect(box.querySelector('em').textContent).toBe('one');
        expect(box.querySelector('strong').textContent).toBe('two');
        expect(box.querySelectorAll('em')[1].textContent).toBe('three');
        expect(box.querySelector('del').textContent).toBe('four');
        expect(box.querySelector('code').textContent).toBe('five');
        expect(box.querySelector('sup').textContent).toBe('six');
        expect(box.querySelector('.md-spoiler').textContent).toBe('seven');
    });

    test('runs of marks are not mistaken for single emphasis', () => {
        expect(html('*foo**').querySelector('em')).toBeNull();
        expect(html('2*3*4').querySelector('em').textContent).toBe('3');
        expect(html('snake_case_name').querySelector('em')).toBeNull();
    });

    test('nesting is capped instead of recursing per character', () => {
        const box = html('^'.repeat(50) + 'x');
        expect(box.querySelectorAll('sup').length).toBeLessThanOrEqual(8);
        expect(box.textContent).toContain('x');
    });
});

describe('saved copies under concurrency', () => {
    test('posts and comments saved at the same moment both stay indexed', async () => {
        const area = memoryArea();
        const cache = createArchiveCache({ area });
        const ref = (id) => ({ kind: 'posts', id, fullname: `t3_${id}`, createdUtc: 1, data: { id } });
        await Promise.all([
            cache.add('someone', 'posts', [ref('a')]),
            cache.add('someone', 'comments', [ref('b')]),
            cache.add('other', 'posts', [ref('c')]),
        ]);
        expect(await cache.size()).toBe(3);
    });

    test('Forget also removes lists an older version lost from the index', async () => {
        const area = memoryArea();
        await area.set({ 'rosint:v1:stray:posts': { at: 1, items: [] }, unrelated: 1 });
        const cache = createArchiveCache({ area });
        await cache.clear();
        expect(await area.get(null)).toEqual({ unrelated: 1 });
    });
});

describe('waiting for the feed', () => {
    test('retries on DOM changes reuse the detection instead of re-asking Reddit', async () => {
        document.body.innerHTML = '<main></main>';
        let detections = 0;
        const injector = createInjector({
            doc: document,
            win: window,
            detect: async () => { detections += 1; return { hidden: true, reason: 'ok' }; },
            archive: async () => ({ ok: true, items: [], done: true }),
            info: async () => [],
            autoRetryMs: null,
            createObserver: () => ({ observe() {}, disconnect() {} }),
        });
        for (let i = 0; i < 5; i += 1) await injector.start({ username: 'someone', tab: 'posts' });
        expect(injector.status().phase).toBe('waiting-for-feed');
        expect(detections).toBe(1);
        injector.stop();
    });

    test('status() is cheap: no layout reads', async () => {
        document.body.innerHTML = '<main><shreddit-feed><div id="empty-state">Nothing here</div></shreddit-feed></main>';
        const injector = createInjector({
            doc: document,
            win: window,
            detect: async () => ({ hidden: false, reason: 'ok' }),
            archive: async () => ({ ok: true, items: [], done: true }),
            info: async () => [],
        });
        await injector.start({ username: 'someone', tab: 'posts' });
        const original = Element.prototype.getBoundingClientRect;
        let reads = 0;
        Element.prototype.getBoundingClientRect = function read() { reads += 1; return original.call(this); };
        try {
            expect(injector.status()).toMatchObject({ key: 'someone:posts', phase: 'not-hidden' });
        } finally {
            Element.prototype.getBoundingClientRect = original;
        }
        expect(reads).toBe(0);
        injector.stop();
    });
});

describe("Reddit's hidden-history notice", () => {
    const notice = (text) => `<main id="main-content"><nav>Overview Posts Comments</nav><shreddit-feed><div id="empty-feed-content"><div><div data-testid="empty-state-creative"><img src="https://www.redditstatic.com/shreddit/assets/snoo_wave.png" alt=""></div><div><div role="heading">Welcome!</div><div>${text}</div></div></div></div></shreddit-feed></main>`;

    test('a logged-out JSON refusal is reported as refused, not as a missing account', async () => {
        const fetchImpl = async () => new Response('Forbidden', { status: 403 });
        expect(await detectHiddenHistory('someone', { fetchImpl })).toMatchObject({ hidden: false, reason: 'refused' });
        const missing = async () => new Response('Not found', { status: 404 });
        expect(await detectHiddenHistory('someone', { fetchImpl: missing })).toMatchObject({ hidden: false, reason: 'no-account' });
    });

    test('the English notice is found by its text', () => {
        document.body.innerHTML = notice('u/someone likes to keep their posts hidden, but check out their stats.');
        expect(findHiddenPanel(document)).not.toBeNull();
    });

    test('a localised notice is recognised by its block, and hidden as a whole', () => {
        document.body.innerHTML = notice('u/someone blendet seine*ihre Beiträge gern aus.');
        expect(findHiddenPanel(document)).toBeNull();
        const block = findNoticeBlock(document);
        expect(block?.id).toBe('empty-feed-content');
        const feed = findFeed(document);
        expect(feed.tagName.toLowerCase()).toBe('shreddit-feed');
        expect(findEmptyState(feed)).toBe(block);
    });

    test('a feed with real items is never mistaken for the notice', () => {
        document.body.innerHTML = notice('x').replace('<div id="empty-feed-content">', '<shreddit-post id="t3_a"></shreddit-post><div id="empty-feed-content">');
        expect(findNoticeBlock(document)).toBeNull();
    });
});
