/**
 * The brand's X account, linked from the site header, the landing footer and the terminal's top bar.
 * VITE_X_URL overrides it (for a different account on a different deployment); an empty value falls back to this one.
 */
export const X_URL = (import.meta.env.VITE_X_URL as string | undefined) || 'https://x.com/HANMARKETS';
