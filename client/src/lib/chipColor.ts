import type { AppTheme } from '../styles/theme';

export function chipColor(amount: number, theme: AppTheme) {
  if (amount >= 100) return theme.colors.chipBlack;
  if (amount >= 25) return theme.colors.chipGreen;
  if (amount >= 5) return theme.colors.chipBlue;
  return theme.colors.chipRed;
}
