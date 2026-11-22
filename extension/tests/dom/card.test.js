// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import { createItem } from '../../shared/nativeFeed.js';
import { toRef } from '../../shared/pagination.js';
import { renderMarkdown } from '../../shared/markdown.js';
import { compactNumber, relativeTime } from '../../shared/format.js';

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const item = { kind: 'posts', id: 'abc', fullname: 't3_abc', data: { id: 'abc', name: 't3_abc', author: 'somebody', title: 'Gallery title', subreddit: 'pics', permalink: '/r/pics/comments/abc/title/', created_utc: NOW / 1000 - 1440 } };
const md = (source) => {
    const div = document.createElement('div');
    div.appendChild(renderMarkdown(document, source));
    return div;
};

beforeEach(() => { document.body.replaceChildren(); });

describe('post cards', () => {
    test('archive galleries survive the worker boundary and their controls switch images', () => {
        const data = { ...item.data, is_gallery: true,
            gallery_data: { items: [{ media_id: 'one' }, { media_id: 'two' }] },
            media_metadata: { one: { e: 'Image', s: { u: 'https://i.redd.it/one.jpg', x: 640, y: 480 } }, two: { e: 'Image', s: { u: 'https://i.redd.it/two.jpg', x: 640, y: 480 } } },
        };
        const snapshot = toRef('posts', data).data;
        const card = createItem('posts', { ...item, data: snapshot, archived: true }, { now: NOW });
        const images = [...card.shadowRoot.querySelectorAll('[slot="post-media-container"] img')];
        expect(images).toHaveLength(2);
        expect(images.map((image) => image.hidden)).toEqual([false, true]);
        card.shadowRoot.querySelector('[aria-label="Next image"]').click();
        expect(images.map((image) => image.hidden)).toEqual([true, false]);
        expect(card.shadowRoot.querySelector('.count').textContent).toBe('2/2');
        expect(card.shadowRoot.querySelector('[slot="title"]').textContent).toBe('Gallery title');
        expect(card.shadowRoot.querySelector('time').title).toContain('Archived copy');
    });

    test('times read like Reddit and keep the full date on hover', () => {
        const card = createItem('posts', item, { now: NOW });
        const time = card.shadowRoot.querySelector('time');
        expect(time.textContent).toBe('24m ago');
        expect(time.getAttribute('datetime')).toBe(new Date((NOW / 1000 - 1440) * 1000).toISOString());
        expect(time.title).not.toContain('Archived');
    });

    test('NSFW media is veiled until the viewer reveals it', () => {
        const card = createItem('posts', { ...item, data: { ...item.data, over_18: true, images: [{ url: 'https://i.redd.it/one.jpg' }] } }, { now: NOW });
        const media = card.shadowRoot.querySelector('[slot="post-media-container"]');
        expect(media.classList.contains('veiled')).toBe(true);
        const button = media.querySelector('.veil button');
        expect(button.textContent).toContain('NSFW');
        button.click();
        expect(media.classList.contains('veiled')).toBe(false);
        expect(media.querySelector('.veil')).toBeNull();
        expect(card.shadowRoot.querySelector('.tag.nsfw').textContent).toBe('NSFW');
    });

    test('self text renders as markdown, not literal syntax', () => {
        const card = createItem('posts', { ...item, data: { ...item.data, is_self: true, selftext: '[repo](https://github.com/x/y) and **bold**' } }, { now: NOW });
        const body = card.shadowRoot.querySelector('[slot="text-body"]');
        expect(body.textContent).toBe('repo and bold');
        const anchor = body.querySelector('a');
        expect(anchor.href).toBe('https://github.com/x/y');
        expect(anchor.rel).toContain('noopener');
    });

    test('link posts show their destination domain', () => {
        const card = createItem('posts', { ...item, data: { ...item.data, is_self: false, url: 'https://www.example.com/article', domain: 'example.com' } }, { now: NOW });
        expect(card.shadowRoot.querySelector('.domain').textContent).toBe('example.com');
    });

    test('archive URLs with unsafe schemes never become media or links', () => {
        const card = createItem('posts', { ...item, data: { ...item.data, url: 'javascript:alert(1)', images: [{ url: 'data:image/png;base64,AAAA' }], thumbnail: 'javascript:1' } }, { now: NOW });
        expect(card.shadowRoot.querySelector('[slot="post-media-container"]')).toBeNull();
        expect(card.shadowRoot.querySelector('.domain')).toBeNull();
        for (const a of card.shadowRoot.querySelectorAll('a[href]')) expect(a.getAttribute('href')).not.toMatch(/^javascript:/i);
    });
});

describe('comment cards', () => {
    const comment = { kind: 'comments', id: 'c1', fullname: 't1_c1', data: { id: 'c1', name: 't1_c1', author: 'somebody', subreddit: 'techIndia', link_id: 't3_p1', parent_id: 't1_x', body: 'well &amp; good', score: 1234, permalink: '/r/techIndia/comments/p1/slug/c1/', created_utc: NOW / 1000 - 3 * 86400 } };

    test('header names the community and the parent post, byline says replied', () => {
        const card = createItem('comments', comment, { parent: { id: 'p1', title: 'Parent post', permalink: '/r/techIndia/comments/p1/slug/' }, now: NOW });
        const root = card.shadowRoot;
        expect(root.querySelector('.community').textContent).toContain('r/techIndia');
        expect(root.querySelector('[slot="parent-title"]').textContent).toBe('Parent post');
        expect(root.querySelector('.byline').textContent).toContain('somebody');
        expect(root.querySelector('.byline').textContent).toContain('replied');
        expect(root.querySelector('time').textContent).toBe('3d ago');
        expect(root.querySelector('[slot="comment-body"]').textContent).toBe('well & good');
        expect(root.querySelector('.score').textContent).toBe('1.2k');
    });
});

describe('markdown', () => {
    test('paragraphs, emphasis, code and quotes', () => {
        const div = md('Hello *there* **you** ~~old~~ `code`\n\n> quoted\n\nnext');
        expect(div.querySelectorAll(':scope > p.md-p')).toHaveLength(2);
        expect(div.querySelector('em').textContent).toBe('there');
        expect(div.querySelector('strong').textContent).toBe('you');
        expect(div.querySelector('del').textContent).toBe('old');
        expect(div.querySelector('code').textContent).toBe('code');
        expect(div.querySelector('blockquote').textContent).toBe('quoted');
    });

    test('lists, headings, tables and fenced code', () => {
        const div = md('# Title\n\n- one\n- two\n\n1. a\n2. b\n\n| h1 | h2 |\n|---|---|\n| x | y |\n\n```\nlet a = 1;\n```');
        expect(div.querySelector('.md-h1').textContent).toBe('Title');
        expect(div.querySelectorAll('ul li')).toHaveLength(2);
        expect(div.querySelectorAll('ol li')).toHaveLength(2);
        expect([...div.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['x', 'y']);
        expect(div.querySelector('pre').textContent).toBe('let a = 1;');
    });

    test('mentions, bare links and spoilers', () => {
        const div = md('see r/valorant and u/someone at https://example.com/a. >!secret!<');
        const hrefs = [...div.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(['/r/valorant/', '/user/someone/', 'https://example.com/a']);
        const spoiler = div.querySelector('.md-spoiler');
        expect(spoiler.textContent).toBe('secret');
        spoiler.click();
        expect(spoiler.classList.contains('is-revealed')).toBe(true);
    });

    test('never produces markup from text and drops unsafe link targets', () => {
        const div = md('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [ok](https://ok.test)');
        expect(div.querySelector('img')).toBeNull();
        expect(div.textContent).toContain('<img src=x onerror=alert(1)>');
        const links = [...div.querySelectorAll('a')];
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute('href')).toBe('https://ok.test/');
    });

    test('single newlines join, two trailing spaces break', () => {
        const div = md('one\ntwo  \nthree');
        expect(div.querySelector('p').childNodes[0].textContent).toBe('one two');
        expect(div.querySelectorAll('br')).toHaveLength(1);
    });
});

describe('formatting', () => {
    test.each([[30, 'just now'], [90, '1m ago'], [7200, '2h ago'], [86400 * 40, '1mo ago'], [86400 * 800, '2y ago']])('%ss → %s', (age, text) => {
        expect(relativeTime(NOW / 1000 - age, NOW)).toBe(text);
    });

    test.each([[999, '999'], [1234, '1.2k'], [1000, '1k'], [15300, '15k'], [2_400_000, '2.4m'], [-1500, '-1.5k']])('%s → %s', (value, text) => {
        expect(compactNumber(value)).toBe(text);
    });
});
