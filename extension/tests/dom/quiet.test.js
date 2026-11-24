// @vitest-environment happy-dom
// Quiet Reddit. Fixtures are the minimal shapes of what Reddit draws for a
// signed-out viewer (Nov 2026): the header's Log In button, the NSFW gate
// dialog and its portal, blurred NSFW posts wrapped in the "use the app"
// prompt, the over-18 guard, the sign-in modal manager and Google One Tap.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
// quietScript.js boots itself on import; these tests boot their own copies.
vi.hoisted(() => { globalThis.__rosintQuietLoaded = true; });
import { createQuiet, NSFW_GATE_ATTR, QUIET_ATTR, QUIET_CSS, quietState, SIGNED_OUT_ATTR } from '../../shared/quiet.js';
import { bootQuiet } from '../../shared/quietScript.js';
import { QUIET_KEY } from '../../shared/settings.js';

function makeWin(pathname = '/r/example/') {
    return {
        location: { pathname },
        MutationObserver: window.MutationObserver,
        KeyboardEvent: window.KeyboardEvent,
    };
}

function cookieDoc() {
    // happy-dom's document.cookie ignores domain-scoped cookies on its test
    // origin, so record what the script writes instead.
    const writes = [];
    Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => writes.join('; '),
        set: (value) => { writes.push(value); },
    });
    return writes;
}

const signedOutHeader = '<header><a id="login-button" href="https://www.reddit.com/login/">Log In</a></header>';

const nsfwGate = `
  <configured-xpromo-modal><rpl-dialog dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking_desktop" dialog-classname="configured-xpromo configured-xpromo-modal" blocking open></rpl-dialog></configured-xpromo-modal>
  <div id="configured-xpromo-blocking_xpromo_nsfw_blocking_desktop" class="rpl-dialog configured-xpromo configured-xpromo-modal"><button>Log In</button></div>`;

const blurredPost = (id) => `
  <shreddit-post id="t3_${id}" nsfw>
    <shreddit-blurred-container reason="nsfw" blurred mode="wrap">
      <div slot="revealed">
        <xpromo-nsfw-blocking-container>
          <div id="t3_${id}-post-rtjson-content"><p>body ${id}</p></div>
          <a class="viewInApp" slot="view-in-app-button" href="https://reddit.onelink.me/x">View in app</a>
        </xpromo-nsfw-blocking-container>
      </div>
    </shreddit-blurred-container>
  </shreddit-post>`;

const over18Guard = `
  <guard-community-modal subredditname="example" subredditid="t5_x">
    <div slot="secondaryButton" id="nsfw-action-button"><button>Yes, I'm Over 18</button></div>
  </guard-community-modal>`;

// Reddit's sign-in manager closes on Escape and clears its scroll lock.
function authManager({ step = null } = {}) {
    const manager = document.createElement('auth-flow-manager');
    if (step) manager.setAttribute('step-name', step);
    document.body.appendChild(manager);
    const onKey = (event) => {
        if (event.key !== 'Escape') return;
        manager.removeAttribute('step-name');
        document.body.classList.remove('scroll-is-blocked');
    };
    document.addEventListener('keydown', onKey);
    return { manager, cleanup: () => document.removeEventListener('keydown', onKey) };
}

let quiet;
beforeEach(() => {
    document.documentElement.removeAttribute(QUIET_ATTR);
    document.documentElement.removeAttribute(SIGNED_OUT_ATTR);
    document.documentElement.removeAttribute(NSFW_GATE_ATTR);
    document.head.replaceChildren();
    document.body.replaceChildren();
    document.body.className = '';
});
afterEach(() => {
    quiet?.stop();
    quiet = null;
    delete document.cookie;
});

describe('signed-out detection', () => {
    test('the header Log In button marks the page signed out and accepts the over-18 cookie', () => {
        const cookies = cookieDoc();
        document.body.innerHTML = signedOutHeader;
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(quiet.signedOut).toBe(true);
        expect(document.documentElement.hasAttribute(SIGNED_OUT_ATTR)).toBe(true);
        expect(cookies.some((cookie) => /^over18=true;.*domain=\.reddit\.com/.test(cookie))).toBe(true);
    });

    test('a page without any signed-out markup is treated as signed in', () => {
        const cookies = cookieDoc();
        document.body.innerHTML = `<header><button id="expand-user-drawer-button">me</button></header>${blurredPost('a').replace(/<xpromo-nsfw-blocking-container>|<\/xpromo-nsfw-blocking-container>/g, '')}${over18Guard}`;
        const click = vi.fn();
        document.querySelector('#nsfw-action-button button').addEventListener('click', click);
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(quiet.signedOut).toBe(false);
        // A signed-in viewer's own blur preference and over-18 answer are theirs.
        expect(document.querySelector('shreddit-blurred-container').hasAttribute('blurred')).toBe(true);
        expect(click).not.toHaveBeenCalled();
        expect(cookies).toEqual([]);
    });

    test('Firefox for Android has no Log In button; One Tap and the NSFW gate still say signed out', () => {
        cookieDoc();
        document.body.innerHTML = `<auth-flow-google-one-tap-prompt></auth-flow-google-one-tap-prompt>`;
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(quiet.signedOut).toBe(true);
        expect(document.querySelector('auth-flow-google-one-tap-prompt')).toBeNull();
    });
});

describe('mature-content gates', () => {
    test('the NSFW gate and its portal are removed, the scroll lock lifted and the page recorded', () => {
        cookieDoc();
        document.body.className = 'rpl-scroll-lock';
        document.body.innerHTML = signedOutHeader + nsfwGate;
        quiet = createQuiet({ doc: document, win: makeWin('/r/example/comments/abc/') });
        quiet.start();
        expect(document.querySelector('rpl-dialog, configured-xpromo-modal, [id^="configured-xpromo"]')).toBeNull();
        expect(document.body.classList.contains('rpl-scroll-lock')).toBe(false);
        expect(quietState(document).nsfwGatePath).toBe('/r/example/comments/abc/');
    });

    test('the page is recorded even when the gate is caught before Reddit draws its portal', () => {
        // Live finding: the wrapper comes first and takes the named dialog
        // with it, so the name has to be read before anything is removed.
        cookieDoc();
        document.body.innerHTML = `${signedOutHeader}<configured-xpromo-modal data-xpromo-view-san="xpromo|view|blocking_xpromo_nsfw_blocking"><rpl-dialog dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking_desktop" dialog-classname="configured-xpromo configured-xpromo-modal" open></rpl-dialog></configured-xpromo-modal>`;
        quiet = createQuiet({ doc: document, win: makeWin('/r/example/') });
        quiet.start();
        expect(document.querySelector('rpl-dialog, configured-xpromo-modal')).toBeNull();
        expect(quietState(document).nsfwGatePath).toBe('/r/example/');
    });

    test('an app upsell that is not an NSFW gate is removed without marking the page', () => {
        cookieDoc();
        document.body.innerHTML = `${signedOutHeader}<rpl-dialog dialog-id="configured-xpromo-bottom_sheet_app" dialog-classname="configured-xpromo configured-xpromo-bottom-sheet" open></rpl-dialog>`;
        quiet = createQuiet({ doc: document, win: makeWin('/r/example/') });
        quiet.start();
        expect(document.querySelector('rpl-dialog')).toBeNull();
        expect(quietState(document).nsfwGatePath).toBeNull();
    });

    test('blurred NSFW posts are revealed and keep their body, without the app prompt', () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader + blurredPost('a') + blurredPost('b');
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(document.querySelectorAll('shreddit-blurred-container[blurred]')).toHaveLength(0);
        expect(document.querySelector('xpromo-nsfw-blocking-container')).toBeNull();
        expect(document.querySelector('.viewInApp')).toBeNull();
        expect(document.querySelector('#t3_a-post-rtjson-content').textContent).toContain('body a');
    });

    test('the over-18 guard is answered once, as the viewer would', () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader + over18Guard;
        const click = vi.fn();
        document.querySelector('#nsfw-action-button button').addEventListener('click', click);
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        quiet.pass();
        expect(click).toHaveBeenCalledTimes(1);
    });

    test('posts Reddit adds later are revealed too', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        document.body.insertAdjacentHTML('beforeend', blurredPost('late'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.querySelector('shreddit-blurred-container').hasAttribute('blurred')).toBe(false);
        // Reddit re-blurring a post is undone as well.
        document.querySelector('shreddit-blurred-container').setAttribute('blurred', '');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.querySelector('shreddit-blurred-container').hasAttribute('blurred')).toBe(false);
    });
});

describe('sign-in prompts', () => {
    test('a sign-in modal the viewer did not ask for is closed', () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        const { manager, cleanup } = authManager({ step: 'register' });
        document.body.classList.add('scroll-is-blocked');
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(manager.hasAttribute('step-name')).toBe(false);
        expect(document.body.classList.contains('scroll-is-blocked')).toBe(false);
        cleanup();
    });

    test('a vote that opens the sign-up modal later is closed as it opens', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        const { manager, cleanup } = authManager();
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        manager.setAttribute('step-name', 'register');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(manager.hasAttribute('step-name')).toBe(false);
        cleanup();
    });

    test('clicking Log In opens Reddit’s sign-in normally and keeps it open', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        const { manager, cleanup } = authManager();
        let now = 1000;
        quiet = createQuiet({ doc: document, win: makeWin(), now: () => now });
        quiet.start();
        document.getElementById('login-button').addEventListener('click', (event) => event.preventDefault());
        document.getElementById('login-button').click();
        manager.setAttribute('step-name', 'login');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(manager.hasAttribute('step-name')).toBe(true);
        expect(manager.hasAttribute('data-rosint-asked')).toBe(true);
        // Still open long after the click: the viewer is typing.
        now += 60000;
        manager.setAttribute('step-name', 'password');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(manager.getAttribute('step-name')).toBe('password');
        // Once it closes, the next unasked prompt is closed again.
        manager.removeAttribute('step-name');
        await new Promise((resolve) => setTimeout(resolve, 0));
        manager.setAttribute('step-name', 'register');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(manager.hasAttribute('step-name')).toBe(false);
        cleanup();
    });

    test('Firefox for Android’s sign-up sheet is closed unless the viewer asked for it', async () => {
        cookieDoc();
        document.body.innerHTML = `<auth-flow-signup-bottom-sheet><rpl-bottom-sheet id="signup-drawer" dialog-id="signup-drawer"></rpl-bottom-sheet></auth-flow-signup-bottom-sheet><nav><a role="menuitem" href="#">Log In / Sign Up</a></nav>`;
        const sheet = document.getElementById('signup-drawer');
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        sheet.setAttribute('open', '');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sheet.hasAttribute('open')).toBe(false);
        expect(quiet.signedOut).toBe(true);
        document.querySelector('[role="menuitem"]').click();
        sheet.setAttribute('open', '');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sheet.hasAttribute('open')).toBe(true);
    });

    test('sign-in pages are left alone', () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        const { manager, cleanup } = authManager({ step: 'login' });
        quiet = createQuiet({ doc: document, win: makeWin('/login/') });
        quiet.start();
        expect(manager.getAttribute('step-name')).toBe('login');
        cleanup();
    });
});

describe('switching it off', () => {
    const settingsApi = (value) => ({ storage: { local: { get: async () => (value === undefined ? {} : { [QUIET_KEY]: value }) }, onChanged: { addListener() {}, removeListener() {} } } });
    const topWin = () => { const w = makeWin(); w.top = w; return w; };

    test('a viewer who turned it off keeps Reddit as it is, even in the first moments of a page', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader + nsfwGate + blurredPost('a');
        const booted = bootQuiet({ doc: document, win: topWin(), api: settingsApi(false) });
        // Before the setting is read only the (reversible) stylesheet applies.
        expect(document.getElementById('rosint-quiet-style')).not.toBeNull();
        expect(document.querySelector('rpl-dialog')).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.getElementById('rosint-quiet-style')).toBeNull();
        expect(document.querySelector('rpl-dialog')).not.toBeNull();
        expect(document.querySelector('shreddit-blurred-container').hasAttribute('blurred')).toBe(true);
        booted.stop();
    });

    test('with the default setting the page is quieted as soon as it is read', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader + nsfwGate;
        const booted = bootQuiet({ doc: document, win: topWin(), api: settingsApi(undefined) });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.querySelector('rpl-dialog')).toBeNull();
        booted.stop();
    });

    test('stop() removes the style, the attributes and the observer', async () => {
        cookieDoc();
        document.body.innerHTML = signedOutHeader;
        quiet = createQuiet({ doc: document, win: makeWin() });
        quiet.start();
        expect(document.getElementById('rosint-quiet-style')).not.toBeNull();
        quiet.stop();
        expect(document.getElementById('rosint-quiet-style')).toBeNull();
        expect(document.documentElement.hasAttribute(QUIET_ATTR)).toBe(false);
        document.body.insertAdjacentHTML('beforeend', blurredPost('after'));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.querySelector('shreddit-blurred-container').hasAttribute('blurred')).toBe(true);
    });

    test('the over-18 guard is only hidden once the viewer is known to be signed out', () => {
        expect(QUIET_CSS).toMatch(new RegExp(`html\\[${QUIET_ATTR}\\]\\[${SIGNED_OUT_ATTR}\\] guard-community-modal:has\\(#nsfw-action-button\\)`));
        // Everything else it hides only exists for signed-out viewers.
        expect(QUIET_CSS).not.toMatch(/shreddit-post|shreddit-feed|main/);
    });
});
