import { describe, expect, test, vi } from 'vitest';
import { connectionStatus, missingOrigins, REQUIRED_ORIGINS } from '../../shared/connection.js';

const apiWith = (missing = []) => ({ permissions: { contains: vi.fn(async ({ origins }) => !missing.includes(origins[0])) } });

describe('extension host access and connection', () => {
    test('identifies withheld hosts before making a CORS-blocked request', async () => {
        const missing = ['https://removal.rosint.dev/*'];
        const fetchImpl = vi.fn();
        expect(await missingOrigins(apiWith(missing))).toEqual(missing);
        expect(await connectionStatus({ api: apiWith(missing), fetchImpl })).toEqual({ ok: false, error: 'host-permission-required', missing });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('validates real response shapes for both public removal endpoints', async () => {
        const fetchImpl = vi.fn(async (url) => Response.json(url.endsWith('/config') ? { featuresEnabled: true } : { hashes: ['a'.repeat(64)] }));
        const api = apiWith();
        expect(await connectionStatus({ api, fetchImpl })).toEqual({ ok: true, missing: [] });
        expect(api.permissions.contains).toHaveBeenCalledTimes(REQUIRED_ORIGINS.length);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    test('reports a service failure rather than claiming that access is granted', async () => {
        const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
        expect(await connectionStatus({ api: apiWith(), fetchImpl })).toMatchObject({ ok: false, error: 'connection-failed', detail: 'Failed to fetch' });
    });

    test('invalid blocklist is a failed connection', async () => {
        const fetchImpl = vi.fn(async (url) => Response.json(url.endsWith('/config') ? { featuresEnabled: true } : { hashes: ['invalid'] }));
        expect(await connectionStatus({ api: apiWith(), fetchImpl })).toMatchObject({ ok: false, error: 'connection-failed' });
    });
});
