import React, { createContext, useContext, useEffect, useState } from 'react';
import { Theme, AVAILABLE_THEMES, getStoredTheme, saveTheme, applyTheme, THEME_LABELS } from '../utils/themes';

interface ThemeContextType {
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
  availableThemes: typeof AVAILABLE_THEMES;
  themeLabels: typeof THEME_LABELS;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  const handleSetTheme = (theme: Theme) => {
    setCurrentTheme(theme);
    saveTheme(theme);
  };

  return (
    <ThemeContext.Provider
      value={{ currentTheme, setTheme: handleSetTheme, availableThemes: AVAILABLE_THEMES, themeLabels: THEME_LABELS }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
