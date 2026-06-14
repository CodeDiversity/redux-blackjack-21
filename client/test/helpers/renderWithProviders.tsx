import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import type { ReactElement } from 'react';
import { theme } from '../../src/styles/theme';

type Opts = Omit<RenderOptions, 'wrapper'> & { store: any };

export function renderWithProviders(ui: ReactElement, opts: Opts): RenderResult {
  const { store, ...rest } = opts;
  return render(
    <Provider store={store}>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </Provider>,
    rest,
  );
}
