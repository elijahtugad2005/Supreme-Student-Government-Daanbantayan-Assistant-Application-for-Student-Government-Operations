// utils/themeStyles.js
// PURPOSE: Theme-aware style primitives shared by the roster and Death Aid
// screens.
//
// These are used in INLINE style objects on purpose. A CSS custom property
// resolves against the element's computed value, so `backgroundColor:
// 'var(--color-bg-card)'` re-resolves the moment ThemeProvider swaps the
// `theme-*` class on <html>. No re-render and no prop drilling is required,
// which is what makes the theme switch apply instantly to screens that render
// large data tables.
//
// Only tokens defined by ALL THREE themes are used here. Tokens that exist only
// in `.theme-light` (--color-brand, --color-success-border and friends) are
// deliberately avoided: referencing one would leave the other two themes with an
// empty value and silently fall back to the browser default.

/** Palette, as CSS custom property references. */
export const T = {
  bgPrimary: 'var(--color-bg-primary)',
  bgSecondary: 'var(--color-bg-secondary)',
  bgTertiary: 'var(--color-bg-tertiary)',
  bgCard: 'var(--color-bg-card)',
  bgHover: 'var(--color-bg-hover)',

  text: 'var(--color-text-primary)',
  textSoft: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-muted)',
  textOnAccent: 'var(--color-text-inverse)',

  border: 'var(--color-border-primary)',
  borderSoft: 'var(--color-border-secondary)',
  borderAccent: 'var(--color-border-accent)',

  accent: 'var(--color-accent-primary)',
  accentHover: 'var(--color-accent-hover)',
  accentLight: 'var(--color-accent-light)',

  success: 'var(--color-success)',
  successLight: 'var(--color-success-light)',
  warning: 'var(--color-warning)',
  warningLight: 'var(--color-warning-light)',
  error: 'var(--color-error)',
  errorLight: 'var(--color-error-light)',
  info: 'var(--color-info)',
  infoLight: 'var(--color-info-light)',

  shadowSm: 'var(--shadow-sm)',
  shadowMd: 'var(--shadow-md)',
};

/** Shared fragments, so the screens stay visually consistent with each other. */
export const S = {
  /** Page shell. Transparent so the app's own background shows through, which
   *  keeps it correct on all three themes without a second background layer. */
  page: {
    width: '100%',
    padding: '1.5rem',
    borderRadius: '1rem',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },

  heading: {
    fontSize: '2rem',
    color: T.accent,
    marginBottom: '0.5rem',
    fontWeight: 'bold',
  },

  subheading: {
    fontSize: '1rem',
    color: T.textSoft,
  },

  card: {
    backgroundColor: T.bgCard,
    borderRadius: '1rem',
    padding: '2rem',
    marginBottom: '2rem',
    border: `1px solid ${T.borderSoft}`,
    boxShadow: T.shadowSm,
  },

  sectionTitle: {
    fontSize: '1.4rem',
    color: T.accent,
    marginBottom: '1.2rem',
    fontWeight: 'bold',
    borderBottom: `2px solid ${T.borderSoft}`,
    paddingBottom: '0.5rem',
  },

  label: {
    fontSize: '0.85rem',
    color: T.text,
    marginBottom: '0.35rem',
    fontWeight: '600',
  },

  helper: {
    fontSize: '0.8rem',
    color: T.textSoft,
    marginTop: '0.35rem',
  },

  input: {
    padding: '0.6rem',
    border: `1px solid ${T.border}`,
    borderRadius: '0.5rem',
    backgroundColor: T.bgTertiary,
    color: T.text,
    fontSize: '0.9rem',
    outline: 'none',
    boxSizing: 'border-box',
  },

  select: {
    padding: '0.6rem',
    border: `1px solid ${T.border}`,
    borderRadius: '0.5rem',
    backgroundColor: T.bgTertiary,
    color: T.text,
    fontSize: '0.9rem',
    outline: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
  },

  /** Table headers use the tertiary surface so the grid stays legible without
   *  needing a hardcoded stripe colour. */
  tableHead: {
    padding: '0.7rem',
    textAlign: 'left',
    color: T.accent,
    fontWeight: 'bold',
    fontSize: '0.85rem',
    borderBottom: `2px solid ${T.borderAccent}`,
  },

  tableCell: {
    padding: '0.6rem 0.7rem',
    color: T.text,
    fontSize: '0.85rem',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${T.borderSoft}`,
  },

  primaryButton: {
    padding: '1rem',
    backgroundColor: T.accent,
    color: T.textOnAccent,
    border: 'none',
    borderRadius: '50px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: '220px',
  },

  secondaryButton: {
    padding: '0.6rem 1.4rem',
    backgroundColor: 'transparent',
    color: T.text,
    border: `2px solid ${T.border}`,
    borderRadius: '50px',
    fontSize: '0.9rem',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  successButton: {
    padding: '0.7rem 1.4rem',
    backgroundColor: T.success,
    color: T.textOnAccent,
    border: 'none',
    borderRadius: '50px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  disabled: {
    opacity: '0.55',
    cursor: 'not-allowed',
  },

  tabBar: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    borderBottom: `2px solid ${T.borderSoft}`,
    flexWrap: 'wrap',
  },

  tab: {
    padding: '0.7rem 1.2rem',
    backgroundColor: 'transparent',
    color: T.textSoft,
    border: 'none',
    borderBottom: '3px solid transparent',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  tabActive: {
    color: T.accent,
    borderBottomColor: T.accent,
  },

  tableWrap: {
    overflowX: 'auto',
    marginBottom: '1rem',
    borderRadius: '0.5rem',
    border: `1px solid ${T.borderSoft}`,
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: T.bgCard,
  },

  tableHeadRow: {
    backgroundColor: T.bgTertiary,
  },
};

/** A status pill built from the semantic tokens, so it re-themes with the page. */
export const statusPill = (tone) => {
  const map = {
    success: { bg: T.successLight, fg: T.success, border: T.success },
    warning: { bg: T.warningLight, fg: T.warning, border: T.warning },
    error: { bg: T.errorLight, fg: T.error, border: T.error },
    info: { bg: T.infoLight, fg: T.info, border: T.info },
    neutral: { bg: T.bgTertiary, fg: T.textSoft, border: T.border },
  };
  const c = map[tone] || map.neutral;
  return {
    display: 'inline-block',
    backgroundColor: c.bg,
    color: c.fg,
    border: `1px solid ${c.border}`,
    padding: '0.25rem 0.7rem',
    borderRadius: '50px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  };
};

/** Full-width banner, used for success/error/info feedback. */
export const banner = (tone) => {
  const map = {
    success: T.success,
    error: T.error,
    info: T.info,
  };
  return {
    color: T.textOnAccent,
    backgroundColor: map[tone] || T.info,
    padding: '1rem',
    borderRadius: '0.5rem',
    marginBottom: '1.5rem',
    fontWeight: 'bold',
  };
};

/**
 * Banner laid out as a row with room for a close button.
 * Split out from `banner` because the base style has no positioning and no gap,
 * so it can still be reused where neither is wanted.
 */
export const statusBanner = (tone) => ({
  ...banner(tone),
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
});