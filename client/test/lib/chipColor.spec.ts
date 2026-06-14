import { describe, it, expect } from 'vitest';
import { chipColor } from '../../src/lib/chipColor';
import { theme } from '../../src/styles/theme';

describe('chipColor', () => {
  it('returns red for $0', () => {
    expect(chipColor(0, theme)).toBe(theme.colors.chipRed);
  });
  it('returns red for $4 (below the blue threshold)', () => {
    expect(chipColor(4, theme)).toBe(theme.colors.chipRed);
  });
  it('returns blue for $5 (at the blue threshold)', () => {
    expect(chipColor(5, theme)).toBe(theme.colors.chipBlue);
  });
  it('returns blue for $24 (below the green threshold)', () => {
    expect(chipColor(24, theme)).toBe(theme.colors.chipBlue);
  });
  it('returns green for $25 (at the green threshold)', () => {
    expect(chipColor(25, theme)).toBe(theme.colors.chipGreen);
  });
  it('returns green for $99 (below the black threshold)', () => {
    expect(chipColor(99, theme)).toBe(theme.colors.chipGreen);
  });
  it('returns black for $100 (at the black threshold)', () => {
    expect(chipColor(100, theme)).toBe(theme.colors.chipBlack);
  });
  it('returns black for $1000', () => {
    expect(chipColor(1000, theme)).toBe(theme.colors.chipBlack);
  });
});
