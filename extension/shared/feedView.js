// The restored feed's own chrome: one quiet provenance header above the rows,
// skeleton rows while the archive answers, and an end-of-history marker. It is
// the only place the extension speaks in its own voice on reddit.com, so it
// keeps to Reddit's tokens and spends its one brand colour on the Rosint orb.

import { plural, relativeTime, shortDate } from './format.js';

const ROSINT_SEARCH = 'https://rosint.dev/';

const VIEW_CSS = `
:host{display:block!important;box-sizing:border-box;width:100%;margin:0!important;padding:0!important;text-align:left;color:var(--color-neutral-content,#333d42);font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif);font-size:14px;line-height:20px;-webkit-font-smoothing:antialiased}
:host([hidden]){display:none!important}
*,*::before,*::after{box-sizing:border-box}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;border:0;background:none;padding:0;margin:0;cursor:pointer}
:focus-visible{outline:2px solid var(--color-primary,#115bca);outline-offset:2px;border-radius:8px}
svg{display:block;flex:none}
[hidden]{display:none!important}
.banner{position:relative;display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;column-gap:12px;margin:8px 0 4px;padding:12px 12px 12px 14px;border-radius:16px;background:color-mix(in srgb,var(--color-neutral-content-strong,#181c1f) 4%,var(--color-neutral-background,#fff));border:1px solid color-mix(in srgb,var(--color-neutral-content-strong,#181c1f) 10%,transparent);overflow:hidden}
.orb{position:relative;width:22px;height:22px;border-radius:50%;flex:none;background:linear-gradient(180deg,#ff7a45 0%,#fd4602 100%);box-shadow:inset 0 1px 1px rgba(255,255,255,.35),inset 0 -2px 4px rgba(150,30,0,.35),0 1px 2px rgba(253,70,2,.25)}
.orb::after{content:"";position:absolute;inset:3px 5px 10px 5px;border-radius:50%;background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0));filter:blur(.5px)}
.busy .orb{animation:breathe 1.6s cubic-bezier(.45,0,.55,1) infinite}
@keyframes breathe{0%,100%{transform:scale(1);box-shadow:inset 0 1px 1px rgba(255,255,255,.35),inset 0 -2px 4px rgba(150,30,0,.35),0 0 0 0 rgba(253,70,2,.35)}50%{transform:scale(.94);box-shadow:inset 0 1px 1px rgba(255,255,255,.35),inset 0 -2px 4px rgba(150,30,0,.35),0 0 0 6px rgba(253,70,2,0)}}
.text{flex:1 1 auto;min-width:0}
.title{display:block;font-size:14px;line-height:20px;font-weight:600;color:var(--color-neutral-content-strong,#181c1f);text-wrap:balance}
.detail{display:block;font-size:12px;line-height:16px;color:var(--color-neutral-content-weak,#5c6c74);margin-top:1px;text-wrap:pretty}
.actions{display:flex;align-items:center;gap:8px;flex:none}
.btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;background:var(--color-secondary-background,#e5ebee);color:var(--color-secondary,#21272a);transition:background-color .12s ease,transform .16s cubic-bezier(.23,1,.32,1)}
.btn:hover{background:var(--color-secondary-background-hover,#dbe4e9)}
.btn:active{transform:scale(.97)}
.btn.primary{background:#d93900;color:#fff}
.btn.primary:hover{background:#c23300}
.btn svg{width:14px;height:14px}
.progress{position:absolute;left:0;right:0;bottom:0;height:2px;overflow:hidden;opacity:0;transition:opacity .2s ease}
.busy .progress{opacity:1}
.progress::before{content:"";position:absolute;top:0;bottom:0;width:40%;left:-40%;background:linear-gradient(90deg,transparent,#fd4602,transparent);animation:sweep 1.25s cubic-bezier(.65,0,.35,1) infinite}
@keyframes sweep{to{left:100%}}
.skeletons{display:block}
.skeleton{margin:4px 0;padding:12px 16px 16px;border-bottom:1px solid var(--color-neutral-border-weak,#00000019)}
.bone{display:block;height:12px;border-radius:999px;background:var(--color-neutral-background-selected,#e5ebee);position:relative;overflow:hidden}
.bone+.bone{margin-top:10px}
.bone::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--color-neutral-background,#fff) 55%,transparent),transparent);animation:shine 1.4s ease-in-out infinite}
@keyframes shine{to{transform:translateX(100%)}}
.row{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.dot{width:24px;height:24px;border-radius:50%;background:var(--color-neutral-background-selected,#e5ebee);flex:none}
.end{display:flex;flex-direction:column;align-items:center;gap:2px;padding:28px 16px 36px;text-align:center}
.end .title{font-size:13px}
.end .detail{max-width:46ch}
.end .orb{width:16px;height:16px;margin-bottom:8px;opacity:.9}
.end .orb::after{inset:2px 4px 8px 3px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
@media (max-width:560px){.banner{grid-template-columns:22px minmax(0,1fr);align-items:start}.banner .orb{margin-top:-1px}.actions{grid-column:2;margin-top:10px;flex-wrap:wrap}}
`;

const VIEW_ICONS = {
    external: 'M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5v4.25c0 .7-.55 1.25-1.25 1.25H6.25C5.55 19 5 18.45 5 17.75V8.25C5 7.55 5.55 7 6.25 7h4.25',
    retry: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
};

function viewIcon(doc, name) {
    const root = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('viewBox', '0 0 24 24');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('fill', 'none');
    root.setAttribute('stroke', 'currentColor');
    root.setAttribute('stroke-width', '1.8');
    root.setAttribute('stroke-linecap', 'round');
    root.setAttribute('stroke-linejoin', 'round');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', VIEW_ICONS[name]);
    root.appendChild(path);
    return root;
}

function viewEl(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function viewSkeleton(doc, kind) {
    const row = viewEl(doc, 'div', 'skeleton');
    row.setAttribute('aria-hidden', 'true');
    const head = viewEl(doc, 'div', 'row');
    const meta = viewEl(doc, 'span', 'bone');
    meta.style.width = '140px';
    meta.style.height = '10px';
    head.append(viewEl(doc, 'span', 'dot'), meta);
    row.appendChild(head);
    const widths = kind === 'comments' ? ['86%', '64%'] : ['72%', '94%', '58%'];
    widths.forEach((width, index) => {
        const bone = viewEl(doc, 'span', 'bone');
        bone.style.width = width;
        if (index === 0 && kind !== 'comments') bone.style.height = '16px';
        row.appendChild(bone);
    });
    return row;
}

function viewSummary({ posts, comments }, tab) {
    if (tab === 'posts') return plural(posts, 'post');
    if (tab === 'comments') return plural(comments, 'comment');
    if (posts && comments) return `${plural(posts, 'post')} and ${plural(comments, 'comment')}`;
    if (posts) return plural(posts, 'post');
    return plural(comments, 'comment');
}

// The view is a single host with three light-DOM regions: the header (in the
// host's shadow root), the list of rows, and the footer/sentinel area.
export function createFeedView({ doc, username, tab, onRetry }) {
    const root = doc.createElement('div');
    root.setAttribute('data-rosint-feed', '');
    root.style.cssText = 'display:block!important;width:100%;box-sizing:border-box;text-align:left;margin:0;padding:0;min-height:0;';

    const header = doc.createElement('div');
    header.setAttribute('data-rosint-header', '');
    const headerShadow = header.attachShadow({ mode: 'open' });
    const headerStyle = viewEl(doc, 'style');
    headerStyle.textContent = VIEW_CSS;
    const banner = viewEl(doc, 'div', 'banner busy');
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    const orb = viewEl(doc, 'span', 'orb');
    orb.setAttribute('aria-hidden', 'true');
    const text = viewEl(doc, 'div', 'text');
    const title = viewEl(doc, 'span', 'title', `Searching public archives for u/${username}`);
    const detail = viewEl(doc, 'span', 'detail', 'Reddit hides this history. Rosint is checking Arctic Shift and PullPush.');
    text.append(title, detail);
    const actions = viewEl(doc, 'div', 'actions');
    const open = viewEl(doc, 'a', 'btn');
    open.href = `${ROSINT_SEARCH}?u=${encodeURIComponent(username)}`;
    open.target = '_blank';
    open.rel = 'noopener';
    open.append(doc.createTextNode('Open in Rosint'), viewIcon(doc, 'external'));
    const retry = viewEl(doc, 'button', 'btn primary');
    retry.type = 'button';
    retry.append(viewIcon(doc, 'retry'), doc.createTextNode('Try again'));
    retry.hidden = true;
    retry.addEventListener('click', (event) => {
        event.preventDefault();
        onRetry?.();
    });
    actions.append(retry, open);
    const progress = viewEl(doc, 'span', 'progress');
    banner.append(orb, text, actions, progress);
    const topSkeletons = viewEl(doc, 'div', 'skeletons');
    const kinds = tab === 'comments' ? ['comments', 'comments', 'comments'] : tab === 'posts' ? ['posts', 'posts'] : ['posts', 'comments', 'comments'];
    for (const kind of kinds) topSkeletons.appendChild(viewSkeleton(doc, kind));
    headerShadow.append(headerStyle, banner, topSkeletons);

    const list = doc.createElement('div');
    list.setAttribute('data-rosint-list', '');
    list.style.cssText = 'display:block;margin:0;padding:0;';

    const footer = doc.createElement('div');
    footer.setAttribute('data-rosint-footer', '');
    const footerShadow = footer.attachShadow({ mode: 'open' });
    const footerStyle = viewEl(doc, 'style');
    footerStyle.textContent = VIEW_CSS;
    const bottomSkeletons = viewEl(doc, 'div', 'skeletons');
    bottomSkeletons.appendChild(viewSkeleton(doc, tab === 'comments' ? 'comments' : 'posts'));
    bottomSkeletons.hidden = true;
    const end = viewEl(doc, 'div', 'end');
    end.hidden = true;
    footerShadow.append(footerStyle, bottomSkeletons, end);

    const sentinel = doc.createElement('div');
    sentinel.setAttribute('data-rosint-sentinel', '');
    sentinel.style.cssText = 'height:1px;margin:0;padding:0;';

    root.append(header, list, footer, sentinel);

    function setHeader(nextTitle, nextDetail, { busy = false, canRetry = false } = {}) {
        title.textContent = nextTitle;
        detail.textContent = nextDetail;
        banner.classList.toggle('busy', busy);
        retry.hidden = !canRetry;
    }

    return {
        root,
        list,
        sentinel,
        header,
        // First page in flight: header plus skeleton rows.
        loading() {
            setHeader(`Searching public archives for u/${username}`, 'Reddit hides this history. Rosint is checking Arctic Shift and PullPush.', { busy: true });
            topSkeletons.hidden = false;
            bottomSkeletons.hidden = true;
            end.hidden = true;
        },
        // A later page in flight: one skeleton row at the bottom.
        loadingMore(on) {
            bottomSkeletons.hidden = !on;
            banner.classList.toggle('busy', on);
        },
        ready({ counts, archived, done, oldest, savedAt = null, refreshing = false, offlineAt = null }) {
            topSkeletons.hidden = true;
            const total = counts.posts + counts.comments;
            const found = viewSummary(counts, tab);
            let note;
            if (offlineAt) {
                note = `The archives aren’t answering, so this is what your browser saved ${relativeTime(offlineAt / 1000)}.`;
            } else if (refreshing) {
                note = savedAt
                    ? `Saved in your browser ${relativeTime(savedAt / 1000)}. Checking the archives for anything newer…`
                    : 'From public archives. Checking for more…';
            } else {
                note = archived
                    ? 'From public archives. Scores and text are as they were saved and may have changed since.'
                    : 'From public archives, checked against Reddit just now. Deleted and removed items are left out.';
            }
            setHeader(total ? `${found} restored` : 'Nothing to show in this tab', note, { busy: refreshing, canRetry: Boolean(offlineAt) });
            end.replaceChildren();
            end.hidden = !done;
            if (done) {
                const mark = viewEl(doc, 'span', 'orb');
                mark.setAttribute('aria-hidden', 'true');
                end.append(mark, viewEl(doc, 'span', 'title', `That’s everything the archives have for u/${username}`));
                if (oldest) end.append(viewEl(doc, 'span', 'detail', `Earliest saved item: ${shortDate(oldest)}`));
            }
        },
        retrying() {
            bottomSkeletons.hidden = true;
            setHeader(title.textContent, 'Part of the archive didn’t answer. Trying again in a moment…', { busy: true });
        },
        // Terminal messages. The page's own hidden panel stays visible below.
        message(kind) {
            topSkeletons.hidden = true;
            bottomSkeletons.hidden = true;
            end.hidden = true;
            const copy = {
                empty: [`No archived history for u/${username}`, 'Arctic Shift and PullPush have no posts or comments saved for this account yet. New accounts can take a few days to appear.'],
                restricted: [`u/${username} is not available on Rosint`, 'This account’s history is restricted, or the removal check could not be confirmed. Rosint shows nothing when it cannot confirm.'],
                error: ['The archives aren’t answering', 'Arctic Shift and PullPush are overloaded or rate limiting, and this browser has no saved copy of this profile yet. Try again in a minute.'],
                retrying: [`Searching public archives for u/${username}`, 'Arctic Shift is busy. Trying again in a moment…'],
                permission: ['Rosint needs site access', 'Click the Rosint icon in your toolbar, then “Allow access”. Rosint only asks for Reddit, the two archives and its removal check.'],
            }[kind] || ['Something went wrong', 'Try again in a moment.'];
            setHeader(copy[0], copy[1], { canRetry: kind === 'error' || kind === 'permission', busy: kind === 'retrying' });
        },
        partialError() {
            bottomSkeletons.hidden = true;
            banner.classList.remove('busy');
            setHeader(title.textContent, 'Some of the archive did not load. Scroll again or try again in a moment.', { canRetry: true });
        },
        remove() {
            root.remove();
        },
    };
}
