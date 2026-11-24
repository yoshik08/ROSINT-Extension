// Quiet Reddit. For a signed-out viewer Reddit stacks prompts over its own
// pages: Google One Tap, a sign-up rail, sign-up modals on every vote or after
// a timer, "open the app" sheets, and mature-content gates that blur posts it
// has already sent. This removes those layers, accepts the over-18 guard the
// way the viewer would, and unblurs NSFW posts that are already on the page.
//
// It never fetches anything and never fakes a session: it only takes away what
// Reddit draws on top. Clicking Log In or Sign Up still opens Reddit's own
// sign-in, and pages under /login and /register are left alone.
//
// Runs at document_start, before Reddit's markup arrives. The two attributes
// it sets on <html> are also how the main content script learns the result.

export const QUIET_ATTR = 'data-rosint-quiet';
export const SIGNED_OUT_ATTR = 'data-rosint-signed-out';
// Path of the page Reddit put behind its "log in to confirm your age" gate.
export const NSFW_GATE_ATTR = 'data-rosint-nsfw-gate';
const ASKED_ATTR = 'data-rosint-asked';
const STYLE_ID = 'rosint-quiet-style';

// Markup Reddit only renders for viewers without a session.
export const SIGNED_OUT_SIGNALS = [
    '#login-button',
    '#signup-button',
    'auth-flow-google-one-tap-prompt',
    '#credential_picker_container',
    '#credential_picker_iframe',
    'faceplate-tracker[noun="static_left_rail_banner"]',
    'faceplate-tracker[noun="top_nav_signup"]',
    'xpromo-nsfw-blocking-container',
    'rpl-dialog[dialog-id*="nsfw_blocking"]',
    '[id^="configured-xpromo-blocking"]',
].join(',');

const XPROMO_DIALOGS = 'rpl-dialog[dialog-classname*="configured-xpromo"], rpl-dialog[dialog-id*="xpromo"], configured-xpromo-modal, [id^="configured-xpromo"]';
const NSFW_BLUR = 'shreddit-blurred-container[reason="nsfw"][blurred]';
const NSFW_PROMPT = 'xpromo-nsfw-blocking-container';
const OVER_18 = 'guard-community-modal #nsfw-action-button button';
const ONE_TAP = 'auth-flow-google-one-tap-prompt';
const AUTH_OPEN = 'auth-flow-manager[step-name]';
const AUTH_STALE = `auth-flow-manager[${ASKED_ATTR}]:not([step-name])`;
// Firefox for Android gets a sign-up bottom sheet instead of the modal.
const SHEET_OPEN = 'auth-flow-signup-bottom-sheet rpl-bottom-sheet[open], rpl-bottom-sheet[open][dialog-id*="signup"], rpl-bottom-sheet[open][dialog-id*="login"]';
const SHEET_STALE = `rpl-bottom-sheet[${ASKED_ATTR}]:not([open])`;
const SCROLL_LOCKS = ['rpl-scroll-lock', 'scroll-is-blocked'];

// One cheap query decides whether a DOM change needs any work at all.
const WORK = [XPROMO_DIALOGS, NSFW_BLUR, NSFW_PROMPT, OVER_18, ONE_TAP, AUTH_OPEN, AUTH_STALE, SHEET_OPEN, SHEET_STALE].join(',');

// Hidden before the script gets to them, so nothing flashes. Everything here is
// an element Reddit draws only for signed-out viewers, except the over-18
// guard, which signed-in viewers can also get and is therefore scoped.
export const QUIET_CSS = `
html[${QUIET_ATTR}] auth-flow-google-one-tap-prompt,
html[${QUIET_ATTR}] #credential_picker_container,
html[${QUIET_ATTR}] #credential_picker_iframe,
html[${QUIET_ATTR}] faceplate-tracker[noun="static_left_rail_banner"],
html[${QUIET_ATTR}] faceplate-tracker[noun="top_nav_signup"],
html[${QUIET_ATTR}] rpl-dialog[dialog-classname*="configured-xpromo"],
html[${QUIET_ATTR}] configured-xpromo-modal,
html[${QUIET_ATTR}] [id^="configured-xpromo"],
html[${QUIET_ATTR}] .configured-xpromo,
html[${QUIET_ATTR}] a[href^="https://reddit.onelink.me/"],
html[${QUIET_ATTR}] auth-flow-manager[step-name]:not([${ASKED_ATTR}]),
html[${QUIET_ATTR}][${SIGNED_OUT_ATTR}] guard-community-modal:has(#nsfw-action-button) {
  display: none !important;
}`;

// Sign-in and account pages are the viewer's own choice to sign in.
const ACCOUNT_PATH = /^\/(?:login|register|signup|account|password|verification|settings)(?:\/|$)/i;
// What a deliberate sign-in click looks like.
const SIGN_IN_TARGET = '#login-button, #signup-button, a[href*="/login"], a[href*="/register"], auth-flow-link';
const SIGN_IN_TEXT = /^\s*(?:log ?in|sign ?up|log ?in \/ sign ?up|sign ?in)\s*$/i;
const ASK_WINDOW_MS = 5000;

const OVER18_COOKIE = 'over18=true; path=/; domain=.reddit.com; max-age=31536000; secure; samesite=lax';

export function createQuiet({ doc = document, win = window, now = Date.now } = {}) {
    let enabled = false;
    let observer = null;
    let askedUntil = 0;
    const accepted = new WeakSet();
    const root = () => doc.documentElement;

    function signedOut() {
        return Boolean(root()?.hasAttribute(SIGNED_OUT_ATTR));
    }

    function markSignedOut() {
        if (signedOut() || !root()) return;
        root().setAttribute(SIGNED_OUT_ATTR, '');
        // Reddit's own answer to "Yes, I'm over 18". With it set, guarded
        // communities open straight away on the next visit.
        try {
            if (!/(?:^|;\s*)over18=(?:true|1)(?:;|$)/.test(doc.cookie || '')) doc.cookie = OVER18_COOKIE;
        } catch { /* cookies blocked: the guard is clicked instead */ }
    }

    function injectStyle() {
        if (doc.getElementById(STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = QUIET_CSS;
        (doc.head || root())?.appendChild(style);
    }

    function unlockScroll() {
        const body = doc.body;
        if (!body) return;
        if (doc.querySelector(`${AUTH_OPEN}[${ASKED_ATTR}], rpl-bottom-sheet[open][${ASKED_ATTR}]`)) return; // a sign-in the viewer asked for
        for (const name of SCROLL_LOCKS) body.classList.remove(name);
    }

    function removeGates() {
        const found = [...doc.querySelectorAll(XPROMO_DIALOGS)];
        if (!found.length) return;
        // Read every match before removing any: the wrapper comes first in
        // document order and takes the named dialog inside it along.
        const nsfw = found.some((element) => /nsfw/i.test([
            element.getAttribute('dialog-id'),
            element.id,
            element.getAttribute('data-xpromo-view-san'),
        ].join(' ')));
        if (nsfw && root()) root().setAttribute(NSFW_GATE_ATTR, win.location?.pathname || '/');
        for (const element of found) element.remove();
        unlockScroll();
    }

    function revealNsfw() {
        for (const container of doc.querySelectorAll(NSFW_BLUR)) container.removeAttribute('blurred');
        // The prompt wraps the post body; keep the body, drop the prompt and
        // its "View in app" button.
        for (const prompt of doc.querySelectorAll(NSFW_PROMPT)) {
            for (const app of prompt.querySelectorAll('[slot="view-in-app-button"], a.viewInApp')) app.remove();
            prompt.replaceWith(...prompt.childNodes);
        }
    }

    function acceptOver18() {
        for (const button of doc.querySelectorAll(OVER_18)) {
            if (accepted.has(button)) continue;
            accepted.add(button);
            button.click();
        }
    }

    // Sign-up sheets close (and drop their scroll lock) when `open` goes.
    function closeSheets() {
        for (const sheet of doc.querySelectorAll(SHEET_STALE)) sheet.removeAttribute(ASKED_ATTR);
        if (ACCOUNT_PATH.test(win.location?.pathname || '')) return;
        for (const sheet of doc.querySelectorAll(SHEET_OPEN)) {
            if (sheet.hasAttribute(ASKED_ATTR)) continue;
            if (now() < askedUntil) sheet.setAttribute(ASKED_ATTR, '');
            else sheet.removeAttribute('open');
        }
    }

    function closeAuth() {
        closeSheets();
        for (const manager of doc.querySelectorAll(AUTH_STALE)) manager.removeAttribute(ASKED_ATTR);
        const open = [...doc.querySelectorAll(AUTH_OPEN)];
        if (!open.length || ACCOUNT_PATH.test(win.location?.pathname || '')) return;
        for (const manager of open) {
            if (manager.hasAttribute(ASKED_ATTR)) continue;
            if (now() < askedUntil) {
                manager.setAttribute(ASKED_ATTR, '');
                continue;
            }
            // Reddit closes its sign-in modal on Escape and cleans up after
            // itself (scroll lock included).
            const escape = () => new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true, cancelable: true });
            doc.dispatchEvent(escape());
            if (manager.hasAttribute('step-name')) manager.dispatchEvent(escape());
            if (!manager.hasAttribute('step-name')) unlockScroll();
        }
    }

    function pass() {
        if (!enabled) return;
        if (!signedOut() && doc.querySelector(SIGNED_OUT_SIGNALS)) markSignedOut();
        if (!doc.querySelector(WORK)) return;
        // An open sign-in modal the viewer did not ask for also means there is
        // no session.
        if (!signedOut() && doc.querySelector(`${AUTH_OPEN}, ${SHEET_OPEN}`) && now() >= askedUntil) markSignedOut();
        for (const tap of doc.querySelectorAll(ONE_TAP)) tap.remove();
        removeGates();
        closeAuth();
        if (signedOut()) {
            revealNsfw();
            acceptOver18();
        }
    }

    // A click on Log In or Sign Up opens Reddit's sign-in normally.
    function noteIntent(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        for (const node of path) {
            if (!node || node.nodeType !== 1) continue;
            if (node.matches?.(SIGN_IN_TARGET) || ((node.localName === 'a' || node.localName === 'button' || node.getAttribute?.('role') === 'menuitem') && SIGN_IN_TEXT.test(node.textContent || ''))) {
                askedUntil = now() + ASK_WINDOW_MS;
                return;
            }
        }
    }

    // Until the saved setting is read, only the stylesheet applies: hiding is
    // undone by stop(), removing and clicking are not.
    function hold() {
        if (enabled || !root()) return;
        root().setAttribute(QUIET_ATTR, '');
        injectStyle();
    }

    function start() {
        if (enabled) return;
        enabled = true;
        if (!root()) return;
        root().setAttribute(QUIET_ATTR, '');
        injectStyle();
        observer = new win.MutationObserver(pass);
        observer.observe(root(), { childList: true, subtree: true, attributes: true, attributeFilter: ['blurred', 'step-name', 'open'] });
        doc.addEventListener('click', noteIntent, true);
        pass();
    }

    // Turning it off stops the work and shows Reddit's prompts again from the
    // next page on (anything already removed stays gone until a reload).
    function stop() {
        enabled = false;
        observer?.disconnect();
        observer = null;
        doc.removeEventListener('click', noteIntent, true);
        root()?.removeAttribute(QUIET_ATTR);
        doc.getElementById(STYLE_ID)?.remove();
    }

    return {
        hold,
        start,
        stop,
        pass,
        get enabled() { return enabled; },
        get signedOut() { return signedOut(); },
    };
}

// Read by the main content script.
export function quietState(doc = document) {
    const root = doc.documentElement;
    return {
        on: Boolean(root?.hasAttribute(QUIET_ATTR)),
        signedOut: Boolean(root?.hasAttribute(SIGNED_OUT_ATTR)),
        nsfwGatePath: root?.getAttribute(NSFW_GATE_ATTR) || null,
    };
}
