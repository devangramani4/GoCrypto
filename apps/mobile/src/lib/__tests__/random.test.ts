import { randomUUID } from '../random';

describe('randomUUID', () => {
  it('returns RFC 4122 version-4 UUIDs', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomUUID()));
    expect(ids.size).toBe(2000);
  });
});
