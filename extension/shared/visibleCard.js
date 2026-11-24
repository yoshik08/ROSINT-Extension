// Restored rows, drawn to match Reddit's own profile feed: the same spacing,
// type scale, theme tokens, community avatar, relative time and action bar,
// in light and dark. Everything lives in an open shadow root so Reddit's page
// CSS and custom-element registry can neither hide nor restyle a row. Archive
// text is rendered by markdown.js as DOM nodes, never as HTML.

import { compactNumber, decodeEntities, fullDate, hueFor, relativeTime } from './format.js';
import { renderMarkdown, safeHref } from './markdown.js';

// Values in the var() fallbacks are Reddit's light theme; on reddit.com the
// variables resolve to the active theme, dark included.
export const CARD_CSS = `
:host{display:block!important;box-sizing:border-box;width:100%;margin:0!important;padding:0!important;text-align:left;color:var(--color-neutral-content,#333d42);font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif);font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased}
:host([hidden]){display:none!important}
*,*::before,*::after{box-sizing:border-box}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;margin:0;border:0;background:none;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
:focus-visible{outline:2px solid var(--color-primary,#115bca);outline-offset:2px;border-radius:6px}
svg{display:block;flex:none}
[hidden]{display:none!important}
.card{position:relative;margin:4px 0;padding:4px 16px;border-radius:16px;background:var(--color-neutral-background,#fff);transition:background-color .12s ease}
.card:hover,.card:focus-within{background:var(--color-neutral-background-hover,#f6f8f9)}
.card.comment{padding:8px 16px}
.overlay{position:absolute;inset:0;border-radius:16px;z-index:0}
.overlay:focus-visible{outline-offset:-2px}
.lift{position:relative;z-index:1}
.rule{border:0;border-bottom:1px solid var(--color-neutral-border-weak,#00000019);margin:0}
.credit{display:flex;align-items:center;flex-wrap:nowrap;gap:4px;min-height:32px;margin:-2px 0 2px;font-size:12px;line-height:16px;color:var(--color-neutral-content-weak,#5c6c74);min-width:0}
.credit a,.byline a,.saved,time{position:relative;z-index:1}
.comment .credit{min-height:24px;margin:0}
.community{display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--color-neutral-content-strong,#181c1f);white-space:nowrap}
.community:hover .name,.who:hover,.ptitle:hover{text-decoration:underline}
.avatar{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;font-weight:700;line-height:1;color:#fff;background:hsl(var(--h) 62% 46%);flex:none;text-transform:uppercase;letter-spacing:0}
.sep{color:var(--color-neutral-content-weak,#5c6c74)}
.ptitle{color:var(--color-neutral-content-strong,#181c1f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;flex:1 1 0}
time{white-space:nowrap}
.saved{display:inline-flex;align-items:center;gap:3px;color:var(--color-neutral-content-weak,#5c6c74)}
.saved svg{width:14px;height:14px;opacity:.85}
.indent{padding-left:32px}
.byline{display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:12px;line-height:16px;margin:0 0 4px;color:var(--color-neutral-content-weak,#5c6c74)}
.who{font-weight:600;color:var(--color-neutral-content-strong,#181c1f)}
.head{display:flex;gap:16px;align-items:flex-start}
.head-text{flex:1 1 auto;min-width:0}
.title{display:block;margin:0 0 4px;font-size:18px;line-height:24px;font-weight:600;color:var(--color-neutral-content-strong,#181c1f);overflow-wrap:anywhere}
.thumb{flex:none;width:112px;height:84px;border-radius:12px;overflow:hidden;background:var(--color-neutral-background-weak,#f6f8f9);border:1px solid var(--color-neutral-border-weak,#00000019);position:relative}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 6px}
.tag{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;font-size:12px;line-height:16px;font-weight:500;background:var(--color-secondary-background,#e5ebee);color:var(--color-secondary,#21272a);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag.nsfw{background:transparent;color:#d6006b;padding:0;font-weight:600}
.tag.spoiler{background:transparent;color:var(--color-neutral-content-strong,#181c1f);padding:0;font-weight:600}
.tag svg{width:14px;height:14px}
.domain{display:inline-flex;align-items:center;gap:4px;margin:2px 0 4px;font-size:12px;line-height:16px;color:var(--color-primary,#115bca);max-width:100%}
.domain span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.domain:hover{text-decoration:underline}
.domain svg{width:12px;height:12px}
.body{position:relative;font-size:14px;line-height:21px;color:var(--color-neutral-content,#333d42);overflow-wrap:anywhere;margin:4px 0 0}
.body.clamped{max-height:var(--clamp);overflow:hidden;-webkit-mask-image:linear-gradient(#000 calc(100% - 42px),transparent);mask-image:linear-gradient(#000 calc(100% - 42px),transparent)}
.more{display:inline-flex;align-items:center;height:24px;margin-top:2px;font-size:12px;font-weight:600;color:var(--color-neutral-content-strong,#181c1f)}
.more:hover{text-decoration:underline}
.md-p{margin:0 0 12px}
.md-p:last-child,.md-list:last-child,.md-quote:last-child,.md-pre:last-child,.md-table-wrap:last-child{margin-bottom:0}
.md-h{margin:0 0 8px;font-weight:600;color:var(--color-neutral-content-strong,#181c1f)}
.md-h1{font-size:20px;line-height:26px}.md-h2{font-size:18px;line-height:24px}.md-h3,.md-h4,.md-h5,.md-h6{font-size:16px;line-height:22px}
.md-link{color:var(--color-primary,#115bca);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px;position:relative;z-index:1}
.md-link:hover{text-decoration-thickness:2px}
.md-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;padding:1px 5px;border-radius:6px;background:var(--color-neutral-background-selected,#e5ebee)}
.md-pre{margin:0 0 12px;padding:12px 14px;border-radius:12px;background:var(--color-neutral-background-weak,#f6f8f9);border:1px solid var(--color-neutral-border-weak,#00000019);overflow:auto;max-height:420px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;position:relative;z-index:1}
.md-quote{margin:0 0 12px;padding:2px 0 2px 12px;border-left:2px solid var(--color-neutral-border,#00000033);color:var(--color-neutral-content-weak,#5c6c74)}
.md-list{margin:0 0 12px;padding-left:22px}
.md-list li{margin:2px 0}
.md-list li::marker{color:var(--color-neutral-content-weak,#5c6c74)}
.md-hr{border:0;border-top:1px solid var(--color-neutral-border-weak,#00000019);margin:12px 0}
.md-table-wrap{overflow-x:auto;margin:0 0 12px;position:relative;z-index:1}
.md-table{border-collapse:collapse;font-size:13px;line-height:18px}
.md-table th,.md-table td{border:1px solid var(--color-neutral-border-weak,#00000019);padding:6px 10px;text-align:left;vertical-align:top}
.md-table th{font-weight:600;background:var(--color-neutral-background-weak,#f6f8f9)}
.md-spoiler{background:var(--color-neutral-content-strong,#181c1f);color:transparent;border-radius:4px;padding:0 2px;cursor:pointer;position:relative;z-index:1;transition:background-color .2s ease,color .2s ease}
.md-spoiler *{color:transparent!important}
.md-spoiler.is-revealed{background:var(--color-neutral-background-selected,#e5ebee);color:inherit;cursor:text}
.md-spoiler.is-revealed *{color:inherit!important}
sup{font-size:.75em;line-height:0}
del{opacity:.8}
.media{position:relative;z-index:1;margin:12px 0 0;border-radius:16px;overflow:hidden;border:1px solid var(--color-neutral-border-weak,#00000019);background:var(--color-neutral-background-weak,#000);isolation:isolate}
.media .fill{position:absolute;inset:-24px;background-size:cover;background-position:center;filter:blur(24px) saturate(1.1);opacity:.55;z-index:-1;transform:translateZ(0)}
.media img.slide,.media video{display:block;width:100%;max-height:540px;object-fit:contain;margin:0 auto}
.media img.slide[hidden]{display:none!important}
.media video{background:#000}
.nav{position:absolute;top:50%;width:32px;height:32px;margin-top:-16px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.55);color:#fff;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:transform .16s cubic-bezier(.23,1,.32,1),opacity .16s ease,background-color .16s ease;opacity:.9}
.nav:hover{background:rgba(0,0,0,.75);opacity:1}
.nav:active{transform:scale(.92)}
.nav svg{width:16px;height:16px}
.nav.prev{left:10px}.nav.next{right:10px}
.count{position:absolute;top:10px;right:10px;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:18px;font-weight:600;font-variant-numeric:tabular-nums;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.dots{position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:5px;pointer-events:none}
.dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.5);transition:background-color .2s ease,transform .2s ease}
.dots i.on{background:#fff;transform:scale(1.15)}
.veil{position:absolute;inset:0;display:grid;place-items:center;z-index:2;background:rgba(0,0,0,.25)}
.veil button{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 16px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font-size:13px;font-weight:600;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:transform .16s cubic-bezier(.23,1,.32,1)}
.veil button:active{transform:scale(.96)}
.veil svg{width:16px;height:16px}
.media.veiled img.slide,.media.veiled video,.media.veiled .thumbimg{filter:blur(48px);transform:scale(1.15)}
.media.veiled .nav,.media.veiled .count,.media.veiled .dots{visibility:hidden}
.media.veiled{min-height:220px}
.actions{position:relative;z-index:1;display:flex;align-items:center;gap:12px;padding:8px 0 4px;flex-wrap:nowrap;overflow:hidden}
.comment .actions{gap:4px;padding:4px 0 0}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:var(--color-secondary-background,#e5ebee);color:var(--color-secondary,#21272a);font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;transition:background-color .12s ease,transform .16s cubic-bezier(.23,1,.32,1)}
.pill:hover{background:var(--color-secondary-background-hover,#dbe4e9)}
.pill:active{transform:scale(.97)}
.comment .pill{background:transparent;padding:0 8px}
.comment .pill:hover{background:var(--color-secondary-background,#e5ebee)}
.votes{padding:0;gap:0}
.votes .score{min-width:14px;text-align:center;font-variant-numeric:tabular-nums}
.vote{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;transition:color .12s ease,background-color .12s ease}
.vote.up:hover{color:#d93900;background:var(--color-secondary-background-hover,#dbe4e9)}
.vote.down:hover{color:#6a5cff;background:var(--color-secondary-background-hover,#dbe4e9)}
.comment .vote:hover{background:var(--color-secondary-background,#e5ebee)}
.pill svg,.vote svg{width:16px;height:16px}
.share .label{display:inline-block;transition:opacity .15s ease}
.share.copied{color:var(--color-neutral-content-strong,#181c1f)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
@media (max-width:420px){.card{padding-left:12px;padding-right:12px}.thumb{width:84px;height:64px}.title{font-size:16px;line-height:22px}}
`;

const CARD_ICONS = {
    up: 'M12 4.5 4.8 12.2a.6.6 0 0 0 .44 1h3.66v5.6c0 .4.3.7.7.7h4.8c.4 0 .7-.3.7-.7v-5.6h3.66a.6.6 0 0 0 .44-1Z',
    down: 'M12 19.5 4.8 11.8a.6.6 0 0 1 .44-1h3.66V5.2c0-.4.3-.7.7-.7h4.8c.4 0 .7.3.7.7v5.6h3.66a.6.6 0 0 1 .44 1Z',
    comment: 'M12 3.75c4.7 0 8.25 3.3 8.25 7.6 0 4.3-3.55 7.6-8.25 7.6-1.1 0-2.15-.17-3.12-.5L4.5 20.25l1.2-3.6c-1.24-1.37-1.95-3.15-1.95-5.3 0-4.3 3.55-7.6 8.25-7.6Z',
    share: 'M13.5 4.5 20.25 11l-6.75 6.5v-3.75c-4.5 0-7.6 1.3-9.75 4.5.75-5.25 3.75-9 9.75-9.75Z',
    check: 'm5 12.5 4.5 4.5L19 7.5',
    archive: 'M4 7.5h16M5.5 7.5v10.25c0 .7.55 1.25 1.25 1.25h10.5c.7 0 1.25-.55 1.25-1.25V7.5M4.75 4.75h14.5c.4 0 .75.34.75.75v2H4V5.5c0-.41.34-.75.75-.75ZM10 11.5h4',
    external: 'M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5v4.25c0 .7-.55 1.25-1.25 1.25H6.25C5.55 19 5 18.45 5 17.75V8.25C5 7.55 5.55 7 6.25 7h4.25',
    left: 'M14.5 6 8.5 12l6 6',
    right: 'm9.5 6 6 6-6 6',
    eye: 'M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12Z M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z',
    pin: 'M15 4.5 19.5 9l-3 1-3.5 3.5.5 4-1.5 1.5-3-3-4 4M9 12l-3-3L7.5 7.5l4 .5L15 4.5',
};

function cardIcon(doc, name, { fill = false } = {}) {
    const root = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('viewBox', '0 0 24 24');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('fill', fill ? 'currentColor' : 'none');
    root.setAttribute('stroke', fill ? 'none' : 'currentColor');
    root.setAttribute('stroke-width', '1.6');
    root.setAttribute('stroke-linecap', 'round');
    root.setAttribute('stroke-linejoin', 'round');
    for (const d of CARD_ICONS[name].split(/ (?=M)/)) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        root.appendChild(path);
    }
    return root;
}

function cardEl(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function cardLink(doc, href, className, text) {
    const a = cardEl(doc, 'a', className, text);
    if (href) a.href = href;
    return a;
}

export function permalinkOf(data) {
    // Reddit-relative only. A backslash would let "/\host" resolve off Reddit.
    return typeof data.permalink === 'string' && /^\/(?![/\\])[^\\\s]*$/.test(data.permalink) ? data.permalink : null;
}

// The parent post's own permalink when the archive has a safe one, otherwise
// the comment's permalink with its comment id dropped.
function parentHref(parent, commentHref) {
    const own = parent ? permalinkOf(parent) : null;
    if (own) return own;
    return commentHref ? commentHref.replace(/\/[a-z0-9]+\/?$/i, '/') : null;
}

function safeMediaUrl(value) {
    try {
        const url = new URL(decodeEntities(String(value)));
        return url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

function cardAvatar(doc, community) {
    const span = cardEl(doc, 'span', 'avatar', (community.replace(/^u_/, '')[0] || 'r'));
    span.style.setProperty('--h', String(hueFor(community)));
    span.setAttribute('aria-hidden', 'true');
    return span;
}

function timeNode(doc, data, archived, now) {
    const time = cardEl(doc, 'time', '', relativeTime(data.created_utc, now));
    const seconds = Number(data.created_utc);
    if (Number.isFinite(seconds) && seconds > 0) {
        const iso = new Date(seconds * 1000).toISOString();
        time.setAttribute('datetime', iso);
        time.setAttribute('ts', iso);
    }
    const when = fullDate(data.created_utc);
    time.title = archived
        ? `${when}\nArchived copy. Current text, score and availability could not be checked.`
        : when;
    return time;
}

// Body text with a measured clamp: only rows that actually overflow get the
// fade and the "Show more" control.
function cardBody(doc, source, { lines }) {
    const wrap = cardEl(doc, 'div', 'body');
    const content = cardEl(doc, 'div', 'md');
    content.appendChild(renderMarkdown(doc, source));
    wrap.appendChild(content);
    const limit = lines * 21;
    wrap.style.setProperty('--clamp', `${limit}px`);
    wrap.classList.add('clamped');
    const more = cardEl(doc, 'button', 'more lift', 'Show more');
    more.type = 'button';
    more.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = wrap.classList.toggle('clamped') === false;
        more.textContent = open ? 'Show less' : 'Show more';
        more.setAttribute('aria-expanded', String(open));
    });
    const measure = () => {
        const overflowing = content.scrollHeight > limit + 21;
        if (!overflowing) wrap.classList.remove('clamped');
        more.hidden = !overflowing;
    };
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
        const observer = new Observer(() => {
            if (!content.scrollHeight) return;
            measure();
            observer.disconnect();
        });
        observer.observe(content);
    }
    return [wrap, more];
}

function imagesOf(data) {
    let images = Array.isArray(data.images) ? data.images : [];
    if (!images.length && data.gallery_data?.items) {
        images = data.gallery_data.items.map(({ media_id: id }) => {
            const source = data.media_metadata?.[id]?.s;
            return { url: source?.u || source?.gif, width: source?.x, height: source?.y };
        });
    }
    if (!images.length && data.preview?.images?.[0]?.source) {
        const source = data.preview.images[0].source;
        images = [{ url: source.url, width: source.width, height: source.height }];
    }
    const direct = data.url_overridden_by_dest || data.url;
    if (!images.length && /\.(?:jpe?g|png|gif|webp|avif)(?:\?|$)/i.test(direct || '')) images = [{ url: direct }];
    return images.map((image) => ({ ...image, url: safeMediaUrl(image.url) })).filter((image) => image.url).slice(0, 20);
}

function veil(doc, media, label) {
    media.classList.add('veiled');
    const cover = cardEl(doc, 'div', 'veil');
    const button = cardEl(doc, 'button');
    button.type = 'button';
    button.append(cardIcon(doc, 'eye'), doc.createTextNode(label));
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        media.classList.remove('veiled');
        cover.remove();
    });
    cover.appendChild(button);
    media.appendChild(cover);
}

function mediaFor(doc, data, { revealNsfw = false } = {}) {
    const media = cardEl(doc, 'div', 'media');
    media.setAttribute('slot', 'post-media-container');
    const video = data.video || data.secure_media?.reddit_video || data.media?.reddit_video;
    const videoUrl = safeMediaUrl(video?.url || video?.fallback_url);
    const images = imagesOf(data);
    if (videoUrl) {
        const player = cardEl(doc, 'video');
        player.controls = true;
        player.preload = 'metadata';
        player.playsInline = true;
        player.src = videoUrl;
        const poster = images[0]?.url || safeMediaUrl(data.thumbnail);
        if (poster) player.poster = poster;
        media.appendChild(player);
    } else if (images.length) {
        let slides = [];
        let drop = () => {};
        const fill = cardEl(doc, 'div', 'fill');
        // The blurred backdrop follows the visible slide, but only once that
        // slide has really loaded, so a dead image never tints the frame.
        const backdrop = (img) => { if (!img.hidden) fill.style.backgroundImage = `url("${img.src.replace(/"/g, '%22')}")`; };
        media.appendChild(fill);
        slides = images.map((image, index) => {
            const img = cardEl(doc, 'img', 'slide');
            img.src = image.url;
            img.alt = data.title ? `${decodeEntities(data.title)}${images.length > 1 ? `, image ${index + 1} of ${images.length}` : ''}` : `Image ${index + 1}`;
            img.loading = 'lazy';
            img.decoding = 'async';
            if (Number(image.width) > 0 && Number(image.height) > 0) {
                img.width = image.width;
                img.height = image.height;
            }
            img.hidden = index !== 0;
            img.addEventListener('error', () => drop(img));
            // Deleted images still "load": i.redd.it serves a 130x60 notice
            // with its 404, Imgur a 161x81 "removed" picture.
            img.addEventListener('load', () => {
                const size = `${img.naturalWidth}x${img.naturalHeight}`;
                if (size === '130x60' || size === '161x81') drop(img);
                else backdrop(img);
            });
            media.appendChild(img);
            return img;
        });
        // A slide that fails to load leaves the gallery; with none left the
        // media block goes too, so a dead link never shows as a broken frame.
        drop = (img) => {
            const index = slides.indexOf(img);
            if (index < 0) return;
            slides.splice(index, 1);
            img.remove();
            if (!slides.length) { media.remove(); return; }
            if (img.hidden === false) slides[0].hidden = false;
            media.dispatchEvent(new CustomEvent('rosint-slides'));
        };
        if (slides.length > 1) {
            let current = 0;
            media.setAttribute('role', 'region');
            media.setAttribute('aria-roledescription', 'carousel');
            media.setAttribute('aria-label', 'Gallery');
            media.tabIndex = 0;
            const count = cardEl(doc, 'span', 'count', `1/${slides.length}`);
            count.setAttribute('aria-live', 'polite');
            const dots = cardEl(doc, 'span', 'dots');
            const marks = slides.slice(0, 12).map((_, index) => {
                const dot = cardEl(doc, 'i', index === 0 ? 'on' : '');
                dots.appendChild(dot);
                return dot;
            });
            const move = (delta) => {
                slides[current].hidden = true;
                marks[current]?.classList.remove('on');
                current = (current + delta + slides.length) % slides.length;
                slides[current].hidden = false;
                marks[current]?.classList.add('on');
                count.textContent = `${current + 1}/${slides.length}`;
                if (slides[current].complete && slides[current].naturalWidth) backdrop(slides[current]);
            };
            for (const [label, delta, side, icon] of [['Previous image', -1, 'prev', 'left'], ['Next image', 1, 'next', 'right']]) {
                const button = cardEl(doc, 'button', `nav ${side}`);
                button.type = 'button';
                button.setAttribute('aria-label', label);
                button.appendChild(cardIcon(doc, icon));
                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    move(delta);
                });
                media.appendChild(button);
            }
            media.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
                if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
            });
            media.addEventListener('rosint-slides', () => {
                current = Math.max(0, slides.findIndex((slide) => !slide.hidden));
                count.textContent = `${current + 1}/${slides.length}`;
                marks.forEach((dot, index) => { dot.hidden = index >= slides.length; dot.classList.toggle('on', index === current); });
                if (slides.length < 2) media.querySelectorAll('.nav, .count, .dots').forEach((node) => node.remove());
            });
            media.append(count, dots);
        }
    } else {
        return null;
    }
    // Quiet Reddit (signed out) shows NSFW media as is; spoilers stay veiled.
    if (data.over_18 && !revealNsfw) veil(doc, media, 'View NSFW content');
    else if (data.spoiler) veil(doc, media, 'View spoiler');
    return media;
}

function externalLink(data) {
    if (data.is_self) return null;
    const destination = safeHref(decodeEntities(data.url_overridden_by_dest || data.url || ''));
    if (!destination || destination.startsWith('/')) return null;
    try {
        const host = new URL(destination).hostname.replace(/^www\./, '');
        if (/(^|\.)(redd\.it|reddit\.com|redditmedia\.com)$/i.test(host)) return null;
        return { href: destination, host };
    } catch {
        return null;
    }
}

function shareButton(doc, href, { compact }) {
    const share = cardEl(doc, 'button', 'pill share');
    share.type = 'button';
    share.setAttribute('aria-label', 'Copy link');
    const label = cardEl(doc, 'span', 'label', 'Share');
    share.append(cardIcon(doc, 'share'), label);
    let timer = null;
    share.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const url = new URL(href, 'https://www.reddit.com').href;
        if (await copyText(doc, url)) {
            share.replaceChildren(cardIcon(doc, 'check'), label);
            label.textContent = 'Copied';
            share.classList.add('copied');
            share.setAttribute('aria-label', 'Link copied');
            doc.defaultView.clearTimeout(timer);
            timer = doc.defaultView.setTimeout(() => {
                share.replaceChildren(cardIcon(doc, 'share'), label);
                label.textContent = 'Share';
                share.classList.remove('copied');
                share.setAttribute('aria-label', 'Copy link');
            }, 1800);
        } else {
            // Clipboard blocked (no focus, permissions policy): open the item
            // so the viewer can copy its address from there.
            doc.defaultView.open(url, '_blank', 'noopener');
        }
    });
    if (compact) share.classList.add('compact');
    return share;
}

// The async Clipboard API needs a focused document; Reddit's page can lose
// focus to an iframe. Fall back to a selection copy before giving up.
async function copyText(doc, text) {
    try {
        await doc.defaultView.navigator.clipboard.writeText(text);
        return true;
    } catch {
        const area = doc.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
        doc.body.appendChild(area);
        try {
            area.select();
            return doc.execCommand?.('copy') === true;
        } catch {
            return false;
        } finally {
            area.remove();
        }
    }
}

function votes(doc, href, score) {
    const group = cardEl(doc, 'span', 'pill votes');
    // Rosint never votes on the viewer's behalf: the arrows open the item.
    const up = cardLink(doc, href, 'vote up');
    up.setAttribute('aria-label', 'Upvote on Reddit');
    up.title = 'Open on Reddit to vote';
    up.appendChild(cardIcon(doc, 'up'));
    const count = cardEl(doc, 'span', 'score', compactNumber(score));
    count.title = `${(Number(score) || 0).toLocaleString('en-US')} points`;
    const down = cardLink(doc, href, 'vote down');
    down.setAttribute('aria-label', 'Downvote on Reddit');
    down.title = 'Open on Reddit to vote';
    down.appendChild(cardIcon(doc, 'down'));
    group.append(up, count, down);
    return group;
}

function postCard(doc, card, data, { archived, now, revealNsfw = false }) {
    const href = permalinkOf(data);
    const community = String(data.subreddit || 'reddit');
    const title = decodeEntities(data.title || '');

    const overlay = cardLink(doc, href, 'overlay');
    overlay.setAttribute('aria-label', title || 'Open post');
    overlay.setAttribute('slot', 'full-post-link');

    const credit = cardEl(doc, 'div', 'credit');
    credit.setAttribute('slot', 'credit-bar');
    const sub = cardLink(doc, `/r/${encodeURIComponent(community)}/`, 'community');
    sub.append(cardAvatar(doc, community), cardEl(doc, 'span', 'name', community.startsWith('u_') ? `u/${community.slice(2)}` : `r/${community}`));
    credit.append(sub, cardEl(doc, 'span', 'sep', '•'), timeNode(doc, data, archived, now));

    const head = cardEl(doc, 'div', 'head');
    const headText = cardEl(doc, 'div', 'head-text');
    const heading = cardLink(doc, href, 'title lift', title);
    heading.setAttribute('slot', 'title');
    heading.id = `post-title-${data.name}`;
    headText.appendChild(heading);

    const tags = cardEl(doc, 'div', 'tags');
    if (data.stickied) {
        const tag = cardEl(doc, 'span', 'tag');
        tag.append(cardIcon(doc, 'pin'), doc.createTextNode('Pinned'));
        tags.appendChild(tag);
    }
    if (data.over_18) tags.appendChild(cardEl(doc, 'span', 'tag nsfw', 'NSFW'));
    if (data.spoiler) tags.appendChild(cardEl(doc, 'span', 'tag spoiler', 'Spoiler'));
    if (data.link_flair_text && decodeEntities(data.link_flair_text).replace(/:[a-z0-9_+-]{2,40}:/gi, '').trim()) {
        // Emoji in flair arrive as :shortcode: text; Reddit draws them as images.
        const flairText = decodeEntities(data.link_flair_text).replace(/:[a-z0-9_+-]{2,40}:/gi, '').replace(/\s{2,}/g, ' ').trim();
        const flair = cardEl(doc, 'span', 'tag flair', flairText);
        flair.setAttribute('slot', 'post-flair');
        flair.title = flair.textContent;
        tags.appendChild(flair);
    }
    if (tags.children.length) headText.appendChild(tags);

    const external = externalLink(data);
    const media = mediaFor(doc, data, { revealNsfw });
    if (external) {
        const domain = cardLink(doc, external.href, 'domain lift');
        domain.target = '_blank';
        domain.rel = 'noopener noreferrer nofollow ugc';
        domain.append(cardEl(doc, 'span', '', external.host), cardIcon(doc, 'external'));
        headText.appendChild(domain);
    }
    head.appendChild(headText);
    const thumbUrl = !media && external ? safeMediaUrl(data.thumbnail) : null;
    if (thumbUrl) {
        const thumb = cardLink(doc, external.href, 'thumb lift');
        thumb.target = '_blank';
        thumb.rel = 'noopener noreferrer nofollow ugc';
        thumb.setAttribute('aria-label', `Open ${external.host}`);
        const img = cardEl(doc, 'img', 'thumbimg');
        img.src = thumbUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => thumb.remove());
        thumb.appendChild(img);
        if (data.over_18 && !revealNsfw) img.style.filter = 'blur(12px)';
        head.appendChild(thumb);
    }

    const parts = [overlay, credit, head];
    const text = typeof data.selftext === 'string' ? data.selftext.trim() : '';
    if (text) {
        const [wrap, more] = cardBody(doc, text, { lines: 6 });
        wrap.setAttribute('slot', 'text-body');
        parts.push(wrap, more);
    }
    if (media) parts.push(media);

    const actions = cardEl(doc, 'div', 'actions');
    const comments = cardLink(doc, href, 'pill');
    const commentCount = Number(data.num_comments) || 0;
    comments.setAttribute('aria-label', `${commentCount} comments`);
    comments.append(cardIcon(doc, 'comment'), doc.createTextNode(compactNumber(commentCount)));
    actions.append(votes(doc, href, data.score), comments, shareButton(doc, href || `/r/${community}/`, { compact: false }));
    parts.push(actions);
    card.append(...parts);
}

function commentCard(doc, card, data, { archived, parent, now }) {
    const href = permalinkOf(data);
    const community = String(data.subreddit || 'reddit');
    const postTitle = decodeEntities(parent?.title || data.link_title || '');

    const overlay = cardLink(doc, href, 'overlay');
    overlay.setAttribute('aria-label', postTitle ? `Comment on ${postTitle}` : 'Open comment');

    const credit = cardEl(doc, 'div', 'credit');
    credit.setAttribute('slot', 'commentMeta');
    const sub = cardLink(doc, `/r/${encodeURIComponent(community)}/`, 'community');
    sub.append(cardAvatar(doc, community), cardEl(doc, 'span', 'name', community.startsWith('u_') ? `u/${community.slice(2)}` : `r/${community}`));
    credit.append(sub);
    if (postTitle) {
        credit.append(cardEl(doc, 'span', 'sep', '•'));
        const titleLink = cardLink(doc, parentHref(parent, href), 'ptitle', postTitle);
        titleLink.setAttribute('slot', 'parent-title');
        titleLink.title = postTitle;
        credit.append(titleLink);
    }

    const byline = cardEl(doc, 'div', 'byline indent');
    const author = String(data.author || '');
    const who = cardLink(doc, `/user/${encodeURIComponent(author)}/`, 'who lift', author || '[deleted]');
    const verb = typeof data.parent_id === 'string' && data.parent_id.startsWith('t1_') ? 'replied' : 'commented';
    byline.append(who, cardEl(doc, 'span', '', verb), timeNode(doc, data, archived, now));

    const [wrap, more] = cardBody(doc, data.body || '', { lines: 12 });
    wrap.classList.add('indent');
    wrap.setAttribute('slot', 'comment-body');
    more.classList.add('indent');

    const actions = cardEl(doc, 'div', 'actions indent');
    const reply = cardLink(doc, href, 'pill');
    reply.setAttribute('aria-label', 'Reply on Reddit');
    reply.append(cardIcon(doc, 'comment'), doc.createTextNode('Reply'));
    actions.append(votes(doc, href, data.score), reply, shareButton(doc, href || `/r/${community}/`, { compact: true }));

    card.append(overlay, credit, byline, wrap, more, actions);
}

// Comment headers get their parent post title once the lookup answers.
export function setParentTitle(host, data, parent, doc = host.ownerDocument) {
    const credit = host.shadowRoot?.querySelector('[slot="commentMeta"]');
    if (!credit || credit.querySelector('[slot="parent-title"]') || !parent?.title) return;
    const title = decodeEntities(parent.title);
    const href = permalinkOf(data);
    const titleLink = cardLink(doc, parentHref(parent, href), 'ptitle', title);
    titleLink.setAttribute('slot', 'parent-title');
    titleLink.title = title;
    credit.append(cardEl(doc, 'span', 'sep', '•'), titleLink);
}

export function fillVisibleCard(host, kind, item, { doc, parent, now = Date.now(), revealNsfw = false }) {
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CARD_CSS;
    const card = cardEl(doc, 'div', kind === 'posts' ? 'card post' : 'card comment');
    card.setAttribute('part', 'card');
    const archived = Boolean(item.archived);
    if (archived) host.setAttribute('data-rosint-archived', '');
    if (kind === 'posts') postCard(doc, card, item.data, { archived, now, revealNsfw });
    else commentCard(doc, card, item.data, { archived, parent, now });
    const rule = cardEl(doc, 'hr', 'rule');
    shadow.append(style, card, rule);
}
