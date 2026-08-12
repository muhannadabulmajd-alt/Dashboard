import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS } from '@/lib/rbac';
import { HIDDEN_NAV_HREFS } from '@/components/layout/nav';

describe('navigation shell', () => {
  it('starts every navigation group collapsed', () => {
    expect(NAV_GROUPS.every((group) => group.defaultOpen === false)).toBe(true);
  });

  it('hides deferred pages without deleting their route definitions', () => {
    const expected = [
      '/dashboard-builder',
      '/compare',
      '/franchise',
      '/offers',
      '/fulfillment',
      '/roastery',
    ];

    expect([...HIDDEN_NAV_HREFS].sort()).toEqual(expected.sort());
    for (const href of expected) {
      expect(NAV_ITEMS.some((item) => item.href === href)).toBe(true);
    }
  });
});
