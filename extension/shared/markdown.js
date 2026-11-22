// Reddit-flavoured markdown to DOM, built node by node. Nothing is ever parsed
// as HTML: every piece of archive text ends up in a text node, and links keep
// only http(s) and Reddit-relative targets. Covers what profile feeds actually
// contain: paragraphs, emphasis, strikethrough, superscript, spoilers, inline
// and fenced code, quotes, lists, headings, rules, tables, links and r/ u/
// mentions.

import { decodeEntities } from './format.js';

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

// Inline nesting deeper than this renders as plain text. Real comments never
// come close; it stops crafted input like "^^^^…" recursing once per character.
const MAX_INLINE_DEPTH = 8;
// A link label or target longer than this is not treated as a link, which
// bounds the bracket scan for text full of unmatched "[".
const MAX_LINK_SCAN = 2000;

export function safeHref(raw) {
    const value = String(raw || '').trim().replace(/^<|>$/g, '');
    if (!value) return null;
    // Browsers read "\" as "/" in URLs, so "/\evil.com" would leave Reddit while
    // looking like a Reddit-relative link. Control characters are stripped by
    // the URL parser and can hide a scheme. Neither belongs in a real link.
    for (const char of value) {
        const code = char.charCodeAt(0);
        if (char === '\\' || code < 0x20 || code === 0x7f) return null;
    }
    if (/^\/(?!\/)/.test(value)) return value; // Reddit-relative
    if (/^(?:r|u|user)\//i.test(value)) return `/${value}`;
    try {
        const url = new URL(value);
        return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function mdEl(doc, tag, className) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
}

function mdAnchor(doc, href, external = !href.startsWith('/')) {
    const a = mdEl(doc, 'a', 'md-link');
    a.href = href;
    if (external) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow ugc';
    }
    return a;
}

// indexOf with memory: once a needle is known to be absent after position p,
// every later search from >= p answers -1 without rescanning, and a found
// position answers every search that starts before it. This keeps text full
// of unmatched openers linear instead of quadratic.
function seek(ctx, s, needle, from) {
    const key = `seek:${needle}`;
    const memo = ctx.memo.get(key);
    if (memo && from >= memo.from && (memo.at < 0 || from <= memo.at)) return memo.at;
    const at = s.indexOf(needle, from);
    ctx.memo.set(key, { from, at });
    return at;
}

// First valid closing emphasis mark at or after `from`. Validity depends only
// on the candidate's own position, so results are memoised like seek().
function closeEmphasis(ctx, s, mark, from) {
    const key = `em:${mark}`;
    const memo = ctx.memo.get(key);
    if (memo && from >= memo.from && (memo.at < 0 || from <= memo.at)) return memo.at;
    let at = from - 1;
    for (;;) {
        at = s.indexOf(mark, at + 1);
        if (at < 0) break;
        if (s[at - 1] === '\\' || /\s/.test(s[at - 1] || ' ')) continue;
        if (mark[0] === '_' && /\w/.test(s[at + mark.length] || '')) continue;
        // A single * or _ next to another one is part of a longer run.
        if (mark.length === 1 && (s[at + 1] === mark || s[at - 1] === mark)) continue;
        break;
    }
    ctx.memo.set(key, { from, at });
    return at;
}

// Inline grammar, tried in order at each position. Each rule returns
// [node(s), consumedLength] or null.
const INLINE = [
    // Backslash escape.
    (doc, s, i) => (s[i] === '\\' && /[\\`*_{}[\]()#+\-.!>~^|]/.test(s[i + 1] || '') ? [doc.createTextNode(s[i + 1]), 2] : null),
    // Inline code.
    (doc, s, i, ctx) => {
        if (s[i] !== '`') return null;
        let run = 1;
        while (s[i + run] === '`') run += 1;
        const ticks = '`'.repeat(run);
        const end = seek(ctx, s, ticks, i + run);
        if (end < 0) return null;
        const code = mdEl(doc, 'code', 'md-code');
        code.textContent = s.slice(i + ticks.length, end).replace(/^ (.*) $/, '$1');
        return [code, end + ticks.length - i];
    },
    // Spoiler >!text!<
    (doc, s, i, ctx) => {
        if (!s.startsWith('>!', i)) return null;
        const end = seek(ctx, s, '!<', i + 2);
        if (end < 0) return null;
        const spoiler = mdEl(doc, 'span', 'md-spoiler');
        spoiler.tabIndex = 0;
        spoiler.setAttribute('role', 'button');
        spoiler.setAttribute('aria-label', 'Reveal spoiler');
        spoiler.append(...mdInline(doc, s.slice(i + 2, end), ctx));
        const reveal = (event) => {
            if (spoiler.classList.contains('is-revealed')) return;
            event.preventDefault();
            event.stopPropagation();
            spoiler.classList.add('is-revealed');
            spoiler.removeAttribute('role');
            spoiler.removeAttribute('aria-label');
        };
        spoiler.addEventListener('click', reveal);
        spoiler.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') reveal(event); });
        return [spoiler, end + 2 - i];
    },
    // [text](url "title")
    (doc, s, i, ctx) => {
        if (s[i] !== '[' || ctx.inLink) return null;
        let depth = 0;
        let close = -1;
        const labelLimit = Math.min(s.length, i + MAX_LINK_SCAN);
        for (let j = i; j < labelLimit; j += 1) {
            if (s[j] === '\\') { j += 1; continue; }
            if (s[j] === '[') depth += 1;
            else if (s[j] === ']' && --depth === 0) { close = j; break; }
        }
        if (close < 0 || s[close + 1] !== '(') return null;
        let paren = 0;
        let end = -1;
        const targetLimit = Math.min(s.length, close + 1 + MAX_LINK_SCAN);
        for (let j = close + 1; j < targetLimit; j += 1) {
            if (s[j] === '(') paren += 1;
            else if (s[j] === ')' && --paren === 0) { end = j; break; }
        }
        if (end < 0) return null;
        const target = s.slice(close + 2, end).trim().replace(/\s+"[^"]*"$/, '');
        const href = safeHref(target);
        const label = mdInline(doc, s.slice(i + 1, close), { ...ctx, inLink: true });
        if (!href) return [label, end + 1 - i];
        const a = mdAnchor(doc, href);
        a.append(...label);
        return [a, end + 1 - i];
    },
    // Bare URL.
    (doc, s, i, ctx) => {
        if (ctx.inLink || !/^https?:\/\//i.test(s.slice(i, i + 8))) return null;
        if (i > 0 && /[\w/]/.test(s[i - 1])) return null;
        let url = /^https?:\/\/[^\s<>"]+/i.exec(s.slice(i))[0];
        // Trailing punctuation belongs to the sentence, not the link.
        while (/[.,;:!?'"]$/.test(url) || (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length)) url = url.slice(0, -1);
        const href = safeHref(url);
        if (!href) return null;
        const a = mdAnchor(doc, href);
        a.textContent = url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
        return [a, url.length];
    },
    // r/community and u/user mentions.
    (doc, s, i, ctx) => {
        if (ctx.inLink) return null;
        if (i > 0 && /[\w/.]/.test(s[i - 1])) return null;
        const match = /^\/?(r|u)\/([A-Za-z0-9_-]{2,32})/.exec(s.slice(i));
        if (!match) return null;
        const a = mdAnchor(doc, match[1] === 'r' ? `/r/${match[2]}/` : `/user/${match[2]}/`, false);
        a.textContent = match[0];
        return [a, match[0].length];
    },
    // Emphasis family.
    ...[['***', 'strong', 'em'], ['___', 'strong', 'em'], ['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']].map(([mark, tag, inner]) => (doc, s, i, ctx) => {
        if (!s.startsWith(mark, i)) return null;
        if (mark[0] === '_' && i > 0 && /\w/.test(s[i - 1])) return null;
        const open = s[i + mark.length];
        if (!open || /\s/.test(open)) return null;
        const end = closeEmphasis(ctx, s, mark, i + mark.length + 1);
        if (end < 0) return null;
        const node = mdEl(doc, tag);
        const children = mdInline(doc, s.slice(i + mark.length, end), ctx);
        if (inner) {
            const nested = mdEl(doc, inner);
            nested.append(...children);
            node.append(nested);
        } else node.append(...children);
        return [node, end + mark.length - i];
    }),
    // Superscript: ^(several words) or ^word
    (doc, s, i, ctx) => {
        if (s[i] !== '^') return null;
        const sup = mdEl(doc, 'sup');
        if (s[i + 1] === '(') {
            const end = seek(ctx, s, ')', i + 2);
            if (end < 0) return null;
            sup.append(...mdInline(doc, s.slice(i + 2, end), ctx));
            return [sup, end + 1 - i];
        }
        const word = /^\^(\S+)/.exec(s.slice(i));
        if (!word) return null;
        sup.append(...mdInline(doc, word[1], ctx));
        return [sup, word[0].length];
    },
];

const TRIGGER = /[\\`>[hHrRuU/*_~^]/;

export function mdInline(doc, text, parentCtx = {}) {
    const depth = (parentCtx.depth || 0) + 1;
    if (depth > MAX_INLINE_DEPTH) return text ? [doc.createTextNode(text)] : [];
    // Memo entries describe positions in this exact string, so every nested
    // call gets its own.
    const ctx = { ...parentCtx, depth, memo: new Map() };
    const out = [];
    let buffer = '';
    const flush = () => {
        if (buffer) out.push(doc.createTextNode(buffer));
        buffer = '';
    };
    for (let i = 0; i < text.length;) {
        const char = text[i];
        if (char === '\n') {
            // Two trailing spaces (or a backslash) force a line break; a lone
            // newline is a space, as on Reddit.
            if (/ {2,}$/.test(buffer) || buffer.endsWith('\\')) {
                buffer = buffer.replace(/(?: {2,}|\\)$/, '');
                flush();
                out.push(mdEl(doc, 'br'));
            } else buffer += ' ';
            i += 1;
            continue;
        }
        let matched = null;
        if (TRIGGER.test(char)) {
            for (const rule of INLINE) {
                matched = rule(doc, text, i, ctx);
                if (matched) break;
            }
        }
        if (!matched) {
            buffer += char;
            i += 1;
            continue;
        }
        flush();
        const [nodes, length] = matched;
        if (Array.isArray(nodes)) out.push(...nodes);
        else out.push(nodes);
        i += Math.max(1, length);
    }
    flush();
    return out;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function mdCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function mdBlocks(doc, lines, depth = 0) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }

        // Fenced code.
        const fence = /^\s*(```+|~~~+)/.exec(line);
        if (fence) {
            const body = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
            i += 1;
            const pre = mdEl(doc, 'pre', 'md-pre');
            const code = mdEl(doc, 'code');
            code.textContent = body.join('\n');
            pre.append(code);
            out.push(pre);
            continue;
        }

        // Indented code.
        if (/^( {4}|\t)/.test(line) && !LIST_ITEM.test(line)) {
            const body = [];
            while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ''));
            while (body.length && !body[body.length - 1].trim()) body.pop();
            const pre = mdEl(doc, 'pre', 'md-pre');
            const code = mdEl(doc, 'code');
            code.textContent = body.join('\n');
            pre.append(code);
            out.push(pre);
            continue;
        }

        // Heading.
        const heading = /^\s*(#{1,6})\s*(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
            const h = mdEl(doc, 'p', `md-h md-h${heading[1].length}`);
            h.append(...mdInline(doc, heading[2]));
            out.push(h);
            i += 1;
            continue;
        }

        // Horizontal rule.
        if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
            out.push(mdEl(doc, 'hr', 'md-hr'));
            i += 1;
            continue;
        }

        // Quote (a block >! is a spoiler paragraph, not a quote).
        if (/^\s*>(?!!)/.test(line)) {
            const body = [];
            while (i < lines.length && /^\s*>(?!!)/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ''));
            const quote = mdEl(doc, 'blockquote', 'md-quote');
            quote.append(...(depth < 6 ? mdBlocks(doc, body, depth + 1) : [doc.createTextNode(body.join(' '))]));
            out.push(quote);
            continue;
        }

        // List.
        const first = LIST_ITEM.exec(line);
        if (first) {
            const ordered = /\d/.test(first[2]);
            const list = mdEl(doc, ordered ? 'ol' : 'ul', 'md-list');
            if (ordered && parseInt(first[2], 10) !== 1) list.start = parseInt(first[2], 10);
            const indent = first[1].length;
            let current = null;
            while (i < lines.length) {
                const item = LIST_ITEM.exec(lines[i]);
                if (item && item[1].length <= indent + 1 && /\d/.test(item[2]) === ordered) {
                    current = [item[3]];
                    const li = mdEl(doc, 'li');
                    list.append(li);
                    li.__lines = current;
                    i += 1;
                } else if (current && lines[i].trim() && (/^\s+/.test(lines[i]) || !LIST_ITEM.test(lines[i])) && !/^\s*>/.test(lines[i]) && lines[i - 1]?.trim()) {
                    current.push(lines[i].replace(/^\s{0,4}/, ''));
                    i += 1;
                } else if (current && !lines[i].trim() && /^\s{2,}\S/.test(lines[i + 1] || '')) {
                    current.push('');
                    i += 1;
                } else break;
            }
            for (const li of list.children) {
                const content = li.__lines;
                delete li.__lines;
                if (content.length === 1 || depth >= 6) li.append(...mdInline(doc, content.join('\n')));
                else li.append(...mdBlocks(doc, content, depth + 1));
            }
            out.push(list);
            continue;
        }

        // Table: header row, alignment rule, body rows.
        if (line.includes('|') && TABLE_RULE.test(lines[i + 1] || '')) {
            const table = mdEl(doc, 'table', 'md-table');
            const head = mdEl(doc, 'thead');
            const headRow = mdEl(doc, 'tr');
            for (const cell of mdCells(line)) {
                const th = mdEl(doc, 'th');
                th.append(...mdInline(doc, cell));
                headRow.append(th);
            }
            head.append(headRow);
            table.append(head);
            const body = mdEl(doc, 'tbody');
            i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                const row = mdEl(doc, 'tr');
                for (const cell of mdCells(lines[i])) {
                    const td = mdEl(doc, 'td');
                    td.append(...mdInline(doc, cell));
                    row.append(td);
                }
                body.append(row);
                i += 1;
            }
            table.append(body);
            const wrap = mdEl(doc, 'div', 'md-table-wrap');
            wrap.append(table);
            out.push(wrap);
            continue;
        }

        // Paragraph: until a blank line or the start of another block.
        const para = [];
        while (i < lines.length && lines[i].trim()
            && !(para.length && (/^\s*(```|~~~|#{1,6}\s|>(?!!))/.test(lines[i]) || LIST_ITEM.test(lines[i])))) {
            para.push(lines[i++]);
        }
        const p = mdEl(doc, 'p', 'md-p');
        p.append(...mdInline(doc, para.join('\n')));
        out.push(p);
    }
    return out;
}

// Returns a DocumentFragment. `limit` caps the source length so a pathological
// archive row cannot stall the page.
export function renderMarkdown(doc, source, { limit = 40000 } = {}) {
    const fragment = doc.createDocumentFragment();
    const text = decodeEntities(String(source ?? '').slice(0, limit)).replace(/\r\n?/g, '\n');
    fragment.append(...mdBlocks(doc, text.split('\n')));
    return fragment;
}
