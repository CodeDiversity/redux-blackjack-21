export const theme = {
  colors: {
    feltLight:  '#2d6a4f',
    feltMid:    '#1b4332',
    feltDark:   '#0f2a20',
    feltBorder: '#2b1d0e',
    feltStitch: 'rgba(220,210,190,0.22)',
    textPrimary:   '#ece4d4',
    textSecondary: '#c9bfa8',
    textDim:       '#a8a194',
    cardWhite: '#fafafa',
    cardBlack: '#111111',
    cardRed:   '#d40000',
    cardBackFrom: '#8b1a1a',
    cardBackTo:   '#5a0f0f',
    statusActive:    '#ece4d4',
    statusWin:       '#4ade80',
    statusLose:      '#f87171',
    statusPush:      '#94a3b8',
    statusBlackjack: '#fde047',
    surfaceDim:        'rgba(0,0,0,0.25)',
    surfaceDimmer:     'rgba(0,0,0,0.40)',
    surfaceBorder:     'rgba(220,210,190,0.25)',
    surfaceBorderActive: '#ece4d4',
    // Entrance (Home + Lobby) — dark "lobby" backdrop, gold accent
    entranceBg:         '#0a1612',   // already used by GlobalStyle body
    entranceSurface:    '#122822',   // card / seat background
    entranceSurfaceAlt: '#0e1f1a',   // slightly darker for nested surfaces
    entranceBorder:     'rgba(220,210,190,0.15)',
    entranceBorderSoft: 'rgba(220,210,190,0.08)',

    // Gold accent (primary CTAs, player initials, brand text)
    goldFrom: '#c9a96a',
    goldTo:   '#8b7340',
    goldText: '#0a1612',   // text color when on a gold background

    // Seated (re-uses statusWin color in the entrance context)
    seatedBorder: '#4ade80',
    seatedGlow:   '0 0 16px rgba(74,222,128,0.30)',
    chipRed:   { from: '#d40000', to: '#8b0000' },
    chipBlue:  { from: '#2563eb', to: '#1e3a8a' },
    chipGreen: { from: '#16a34a', to: '#14532d' },
    chipBlack: { from: '#262626', to: '#0a0a0a' },
  },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', xxl: '32px' },
  typography: {
    fontFamily: '"Georgia", "Times New Roman", serif',
    bodySize:  '14px',
    smallSize: '11px',
    largeSize: '18px',
    titleSize: '22px',
  },
  radii: { sm: '4px', md: '6px', lg: '12px', pill: '180px', seat: '8px' },
  shadows: {
    card:       '0 2px 4px rgba(0,0,0,0.4)',
    cardLarge:  '0 2px 6px rgba(0,0,0,0.5)',
    activeGlow: '0 0 18px rgba(236,228,212,0.35)',
    table:      'inset 0 0 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.6)',
    seat:       '0 4px 10px rgba(0,0,0,0.4)',
  },
};

export type AppTheme = typeof theme;
