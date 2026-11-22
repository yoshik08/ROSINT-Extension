// Formatting that mirrors what Reddit prints on a profile feed: "24m ago",
// "3d ago", "1.2k". Kept dependency-free and locale-aware where Reddit is.

const UNITS = [
    ['y', 31536000],
    ['mo', 2592000],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
];

// Reddit's short relative form. Anything under a minute reads "just now".
export function relativeTime(seconds, now = Date.now()) {
    const utc = Number(seconds);
    if (!Number.isFinite(utc) || utc <= 0) return '';
    const delta = Math.max(0, Math.floor(now / 1000 - utc));
    for (const [unit, size] of UNITS) {
        if (delta >= size) return `${Math.floor(delta / size)}${unit} ago`;
    }
    return 'just now';
}

export function fullDate(seconds, locale) {
    const utc = Number(seconds);
    if (!Number.isFinite(utc) || utc <= 0) return '';
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(utc * 1000));
    } catch {
        return new Date(utc * 1000).toUTCString();
    }
}

export function shortDate(seconds, locale) {
    const utc = Number(seconds);
    if (!Number.isFinite(utc) || utc <= 0) return '';
    try {
        return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(utc * 1000));
    } catch {
        return new Date(utc * 1000).toDateString();
    }
}

// 999 → "999", 1234 → "1.2k", 15300 → "15k", 2_400_000 → "2.4m".
export function compactNumber(value) {
    const n = Math.trunc(Number(value) || 0);
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs < 1000) return String(n);
    const [size, suffix] = abs >= 1e6 ? [1e6, 'm'] : [1e3, 'k'];
    const scaled = abs / size;
    const text = scaled >= 10 ? String(Math.floor(scaled)) : (Math.floor(scaled * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return `${sign}${text}${suffix}`;
}

export function plural(count, one, many = `${one}s`) {
    return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

// A stable hue per community so its monogram avatar keeps one colour across
// rows and visits, standing in for the icon the archive does not carry.
export function hueFor(text) {
    let hash = 0;
    for (const char of String(text || '').toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash % 360;
}

// Archive text arrives HTML-escaped the way Reddit's JSON stores it.
export function decodeEntities(text) {
    return String(text ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&#x200B;|&#8203;/gi, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}
