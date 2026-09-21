import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

export function Layout({ children }: { children: React.ReactNode }) {
  const { currentTheme, setTheme, availableThemes, themeLabels } = useTheme();
  const [logoHidden, setLogoHidden] = useState(false);

  return (
    <div className="app-shell">
      <header className="top-bar">
        {!logoHidden && (
          <img
            className="app-logo"
            src="./logo.png"
            alt="Hardpoint"
            onError={() => setLogoHidden(true)}
          />
        )}
        <h1 className="app-title">Hardpoint</h1>
        <label className="theme-picker">
          <span className="sr-only">Theme</span>
          <select
            value={currentTheme}
            onChange={(e) => setTheme(e.target.value as typeof currentTheme)}
            aria-label="Theme"
          >
            {availableThemes.map((t) => (
              <option key={t} value={t}>
                {themeLabels[t]}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className="main-content">{children}</main>
    </div>
  );
}
