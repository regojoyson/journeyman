import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "journeyman.theme";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

const DEFAULT_THEME: Theme = "dark";

function initialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr === "dark" || attr === "light") return attr;
  }
  return readStored() ?? DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // Private mode / disabled storage — apply for this session only.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
