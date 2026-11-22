import { describe, expect, test } from 'vitest';
import { hydrateChild, hydrateChildren, isVisibleChild, parentTitlesFrom } from '../../shared/hydration.js';

const child = (kind, data) => ({ kind, data: { id: 'abc', name: `${kind === 't3' ? 't3' : 't1'}_abc`, author: 'somebody', created_utc: 1_700_000_000, ...data } });

describe('hydration filter', () => {
    test('drops deleted and removed items Reddit would no longer list', () => {
        const dropped = [
            child('t3', { author: '[deleted]' }),
            child('t3', { selftext: '[deleted]' }),
            child('t3', { selftext: '[removed]' }),
            child('t3', { removed_by_category: 'moderator' }),
            child('t3', { removed: true }),
            child('t1', { body: '[deleted]' }),
            child('t1', { body: '[removed]' }),
            child('t1', { removed_by_category: 'moderator' }),
            child('t1', { body: null }),
        ];
        for (const item of dropped) {
            expect(isVisibleChild(item)).toBe(false);
            expect(hydrateChild(item)).toBeNull();
        }
    });

    test('keeps edited items with their current text', () => {
        const edited = child('t3', { selftext: 'the corrected text', edited: 1_700_000_500 });
        expect(hydrateChild(edited)).toMatchObject({
            kind: 'posts',
            fullname: 't3_abc',
            data: { selftext: 'the corrected text', edited: 1_700_000_500 },
        });

        const editedComment = child('t1', { body: 'edited comment body', edited: 1_700_000_600 });
        expect(hydrateChild(editedComment).data.body).toBe('edited comment body');
    });

    test('keeps the live NSFW and spoiler flags so the native component blurs them', () => {
        const item = hydrateChild(child('t3', { over_18: true, spoiler: true, selftext: 'nsfw body' }));
        expect(item.data.over_18).toBe(true);
        expect(item.data.spoiler).toBe(true);
    });

    test('drops items with no usable id or timestamp', () => {
        expect(hydrateChild(child('t3', { id: undefined }))).toBeNull();
        expect(hydrateChild({ kind: 't5', data: { id: 'abc' } })).toBeNull();
        expect(hydrateChild(null)).toBeNull();
    });

    test('sorts newest first and removes duplicate fullnames', () => {
        const result = hydrateChildren([
            child('t3', { id: 'old', name: 't3_old', created_utc: 100 }),
            child('t1', { id: 'new', name: 't1_new', created_utc: 300, body: 'text' }),
            child('t3', { id: 'old', name: 't3_old', created_utc: 100 }),
        ]);
        expect(result.map((item) => item.fullname)).toEqual(['t1_new', 't3_old']);
        expect(result[0].kind).toBe('comments');
    });

    test('parent titles keep only posts with a title', () => {
        const titles = parentTitlesFrom([{ id: 'a', title: 'hello' }, { id: 'b' }, { title: 'no id' }]);
        expect([...titles.keys()]).toEqual(['a']);
        expect(titles.get('a').title).toBe('hello');
    });
});
