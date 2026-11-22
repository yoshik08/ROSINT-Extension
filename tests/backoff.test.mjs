import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelayMs, fetchWithBackoff, MAX_RETRIES } from '../src/postLookup.js';

const url = 'https://archive.example/api/posts/search';

// Replays the given responses in order (repeating the last) and records waits
// and onRetry calls instead of sleeping.
function setup(...responses) {
    const calls = [], waits = [], retries = [];
    const options = {
        fetcher: async () => {
            const next = responses[Math.min(calls.length, responses.length - 1)];
            calls.push(next);
            if (next instanceof Error) throw next;
            return new Response('{}', next);
        },
        wait: async ms => { waits.push(ms); },
        now: () => Date.parse('2026-10-05T00:00:00Z'),
        random: () => 0,
        onRetry: n => retries.push(n),
    };
    return { options, calls, waits, retries };
}

test('backoff doubles from 1.5s with up to 25% jitter', () => {
    assert.deepEqual([0, 1, 2].map(n => backoffDelayMs(n, () => 0)), [1500, 3000, 6000]);
    assert.deepEqual([0, 1, 2].map(n => backoffDelayMs(n, () => 1)), [1875, 3750, 7500]);
});

test('a 429 followed by success resolves to the ok response', async () => {
    const { options, calls, waits, retries } = setup({ status: 429 }, { status: 200 });
    const res = await fetchWithBackoff(url, options);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [1500]);
    assert.deepEqual(retries, [1]);
});

test('repeated 429s give up after three retries', async () => {
    const { options, calls, waits, retries } = setup({ status: 429 });
    assert.equal(await fetchWithBackoff(url, options), null);
    assert.equal(calls.length, MAX_RETRIES + 1);
    assert.deepEqual(waits, [1500, 3000, 6000]);
    assert.deepEqual(retries, [1, 2, 3]);
});

test('Retry-After is used when present and the backoff fills in when it is missing', async () => {
    const { options, waits } = setup(
        { status: 429, headers: { 'Retry-After': '4' } },
        { status: 503 },
        new TypeError('offline'),
        { status: 200 },
    );
    assert.equal((await fetchWithBackoff(url, options)).status, 200);
    assert.deepEqual(waits, [4000, 3000, 6000]);
});

test('a Retry-After over 60s fails at once', async () => {
    const { options, calls, waits } = setup({ status: 429, headers: { 'Retry-After': '61' } }, { status: 200 });
    assert.equal(await fetchWithBackoff(url, options), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
});

test('a 404 fails at once without retrying', async () => {
    const { options, calls, waits, retries } = setup({ status: 404 }, { status: 200 });
    assert.equal(await fetchWithBackoff(url, options), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
    assert.deepEqual(retries, []);
});

test('retries: 0 makes a single attempt', async () => {
    const { options, calls, waits } = setup({ status: 429 }, { status: 200 });
    assert.equal(await fetchWithBackoff(url, { ...options, retries: 0 }), null);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
});

test('retryWhen turns a normally final status into a retry', async () => {
    const { options, calls } = setup({ status: 422 }, { status: 200 });
    const res = await fetchWithBackoff(url, { ...options, retryWhen: async (r) => r.status === 422 });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);
});

test('without retryWhen a 422 still fails fast', async () => {
    const { options, calls } = setup({ status: 422 }, { status: 200 });
    assert.equal(await fetchWithBackoff(url, options), null);
    assert.equal(calls.length, 1);
});

test('a hung attempt times out and is retried', async () => {
    // Node's AbortSignal.timeout() timer is unref'd: with nothing else
    // pending, some Node versions end the test before it fires. Browsers
    // (where this code runs) have no such behaviour.
    const keepAlive = setInterval(() => {}, 1000);
    try {
        let n = 0;
        const res = await fetchWithBackoff(url, {
            timeoutMs: 50, wait: async () => {}, random: () => 0,
            fetcher: (_, init) => (n++ === 0
                ? new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
                : Promise.resolve(new Response('{}', { status: 200 }))),
        });
        assert.equal(res.status, 200);
        assert.equal(n, 2);
    } finally {
        clearInterval(keepAlive);
    }
});
