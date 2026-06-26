import { describe, expect, it } from 'vitest';
import { bridgedUniqueId } from './bridgedUniqueId.js';

describe('bridgedUniqueId', () => {
    it('uses default suffix without bind epoch', () => {
        expect(bridgedUniqueId('cam-123')).toBe('cam-123-uid');
    });

    it('uses compact suffix when bind epoch is set', () => {
        expect(bridgedUniqueId('cam-123', 1)).toBe('cam-123-u1');
    });

    it('truncates to 32 bytes for long endpoint ids', () => {
        const longId = 'person-cam-1782415058405';
        const result = bridgedUniqueId(longId, 999999);
        expect(result.length).toBeLessThanOrEqual(32);
        expect(result).toContain('u999999');
    });
});
