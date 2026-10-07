import { isEmbeddedHttpMode } from './api';

export const AVAILABLE_THEMES = [
  'blue-oval-theme',
  'bubblegum-theme',
  'commander-keen-theme',
  'electric-lime-theme',
  'flambeau-theme',
  'flambeau-inverse-theme',
  'green-acres-theme',
  'hacker-theme',
  'hawkeye-theme',
  'lava-theme',
  'merica-theme',
  'neon-theme',
  'red-barn-theme',
  'retrowave-theme',
] as const;

export type Theme = (typeof AVAILABLE_THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  'blue-oval-theme': 'Blue Oval',
  'bubblegum-theme': 'Bubblegum',
  'commander-keen-theme': 'Commander Keen',
  'electric-lime-theme': 'Electric Lime',
  'flambeau-theme': 'Flambeau',
  'flambeau-inverse-theme': 'Flambeau Inverse',
  'green-acres-theme': 'Green Acres',
  'hacker-theme': 'Hacker',
  'hawkeye-theme': 'Hawkeye',
  'lava-theme': 'Lava',
  'merica-theme': 'Merica',
  'neon-theme': 'Neon',
  'red-barn-theme': 'Red Barn',
  'retrowave-theme': 'Retrowave',
};

const DEFAULT_THEME: Theme = 'hacker-theme';
const STORAGE_KEY = 'hardpoint-theme';

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && AVAILABLE_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_THEME;
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage not available
  }
}

export function applyTheme(theme: Theme | null): void {
  const body = document.body;
  AVAILABLE_THEMES.forEach((t) => body.classList.remove(t));
  body.classList.add(theme ?? DEFAULT_THEME);
}

export interface EmbedOptions {
  /** Theme forced by the host app (not persisted), or null to use the stored one. */
  theme: Theme | null;
  /** Host app supplies its own chrome: hide the title bar and the embed banner. */
  bare: boolean;
}

/**
 * A host app embedding this page over HTTP can pass `?theme=<name>&bare=1`
 * to match its own look. Ignored in the desktop window.
 */
export function getEmbedOptions(): EmbedOptions {
  if (!isEmbeddedHttpMode()) return { theme: null, bare: false };
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('theme');
  const name = raw && !raw.endsWith('-theme') ? `${raw}-theme` : raw;
  const theme = AVAILABLE_THEMES.includes(name as Theme) ? (name as Theme) : null;
  const bare = ['1', 'true'].includes(params.get('bare') ?? '');
  return { theme, bare };
}
