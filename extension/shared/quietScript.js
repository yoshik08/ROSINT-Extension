// Content script that runs at document_start on every reddit.com page and
// keeps Reddit quiet for signed-out viewers (see quiet.js). Its stylesheet
// applies at once; the rest waits for the saved setting (on by default), then
// follows the popup's switch.

import { createQuiet } from './quiet.js';
import { onQuietChange, readQuiet } from './settings.js';

export function bootQuiet({ doc = document, win = window, api = globalThis.browser ?? globalThis.chrome } = {}) {
    if (win.top !== win) return null;
    const quiet = createQuiet({ doc, win });
    quiet.hold();
    readQuiet(api).then((on) => (on ? quiet.start() : quiet.stop()));
    const unsubscribe = onQuietChange((on) => (on ? quiet.start() : quiet.stop()), api);
    return { quiet, stop: () => { unsubscribe(); quiet.stop(); } };
}

if (typeof window !== 'undefined' && !globalThis.__rosintQuietLoaded) {
    globalThis.__rosintQuietLoaded = true;
    bootQuiet();
}
