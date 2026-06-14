import 'styled-components';
import type { theme } from './theme';

declare module 'styled-components' {
  export interface DefaultTheme {
    colors: typeof theme.colors;
    spacing: typeof theme.spacing;
    typography: typeof theme.typography;
    radii: typeof theme.radii;
    shadows: typeof theme.shadows;
  }
}
