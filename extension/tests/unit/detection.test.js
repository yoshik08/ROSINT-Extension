import { describe, expect, test, vi } from 'vitest';
import { detectHiddenHistory } from '../../shared/reddit.js';

const user = 'somebody';

// A tiny fake Reddit: each path maps to [status, body]. Missing paths 404.
function reddit(routes) {
    const calls = [];
    const fetchImpl = vi.fn(async (path) => {
        calls.push(path);
        const route = routes[path];
        if (!route) return new Response('', { status: 404 });
        const [status, body] = route;
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    });
    return { fetchImpl, calls };
}

const about = (data = {}) => [200, { data: { name: user, ...data } }];
const listing = (children = []) => [200, { data: { children } }];

const paths = {
    about: `/user/${user}/about.json?raw_json=1`,
    posts: `/user/${user}/submitted.json?limit=1&raw_json=1`,
    comments: `/user/${user}/comments.json?limit=1&raw_json=1`,
};

describe('hidden history detection', () => {
    test('empty listings plus a valid about means hidden', async () => {
        const { fetchImpl } = reddit({
            [paths.about]: about(),
            [paths.posts]: listing([]),
            [paths.comments]: listing([]),
        });
        const result = await detectHiddenHistory(user, { fetchImpl });
        expect(result).toMatchObject({ hidden: true, reason: 'ok' });
    });

    test('any visible item means the profile is not hidden', async () => {
        for (const visible of [
            { [paths.posts]: listing([{ kind: 't3', data: { id: 'abc' } }]) },
            { [paths.comments]: listing([{ kind: 't1', data: { id: 'def' } }]) },
        ]) {
            const { fetchImpl } = reddit({
                [paths.about]: about(),
                [paths.posts]: listing([]),
                [paths.comments]: listing([]),
                ...visible,
            });
            expect((await detectHiddenHistory(user, { fetchImpl })).hidden).toBe(false);
        }
    });

    test('suspended accounts are skipped', async () => {
        const { fetchImpl } = reddit({
            [paths.about]: about({ is_suspended: true }),
            [paths.posts]: listing([]),
            [paths.comments]: listing([]),
        });
        expect(await detectHiddenHistory(user, { fetchImpl })).toMatchObject({ hidden: false, reason: 'suspended' });
    });

    test('a missing account is skipped', async () => {
        const { fetchImpl } = reddit({
            [paths.about]: [404, { message: 'Not Found' }],
            [paths.posts]: listing([]),
            [paths.comments]: listing([]),
        });
        expect(await detectHiddenHistory(user, { fetchImpl })).toMatchObject({ hidden: false, reason: 'no-account' });
    });

    test('a listing that cannot be read is skipped instead of guessed', async () => {
        for (const failure of [[500, {}], [403, {}]]) {
            const { fetchImpl } = reddit({
                [paths.about]: about(),
                [paths.posts]: failure,
                [paths.comments]: listing([]),
            });
            expect((await detectHiddenHistory(user, { fetchImpl })).hidden).toBe(false);
        }
    });

    test('malformed payloads are skipped', async () => {
        const { fetchImpl } = reddit({
            [paths.about]: about(),
            [paths.posts]: [200, { data: {} }],
            [paths.comments]: listing([]),
        });
        expect((await detectHiddenHistory(user, { fetchImpl })).hidden).toBe(false);
    });

    test('an abort during detection propagates instead of being swallowed', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn(async () => {
            controller.abort(new Error('navigated away'));
            throw controller.signal.reason;
        });
        await expect(detectHiddenHistory(user, { fetchImpl, signal: controller.signal })).rejects.toThrow('navigated away');
    });
});
