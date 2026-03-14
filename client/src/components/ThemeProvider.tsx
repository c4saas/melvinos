import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** True when Claude Code is actively running */
  ccActive: boolean;
  setCcActive: (active: boolean) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
  ccActive: false,
  setCcActive: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

/** Resolve the effective theme (dark or light) from the user's stored preference */
function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [ccActive, setCcActiveRaw] = useState(false);

  // Apply theme to <html> — set data attribute when CC is active
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    const resolved = resolveTheme(theme);
    root.classList.add(resolved);

    // Set a data attribute so CSS variable overrides kick in for CC mode
    if (ccActive) {
      root.setAttribute('data-cc-active', 'true');
    } else {
      root.removeAttribute('data-cc-active');
    }
  }, [theme, ccActive]);

  const setCcActive = useCallback((active: boolean) => {
    setCcActiveRaw(active);
  }, []);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    ccActive,
    setCcActive,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
