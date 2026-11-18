"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "spendguard-theme";

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "light",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * The blocking script in layout.tsx sets data-theme before first paint, so
 * this provider only needs to adopt that value and keep it in sync.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const changeTimer = useRef<number | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "light" ? "dark" : "light";
    const root = document.documentElement;
    // Atomic switch: suppress every transition while the theme flips, so
    // all components land on the new theme in the same paint. Fading the
    // switch instead makes it look uneven, because gradients and shadows
    // cannot fade the way flat colours can, and on a phone the repaint
    // staggers into a visible jerk. The suppression class lives for two
    // animation frames (plus a timeout fallback), long enough for the
    // flip to commit and too short to notice. The toggle thumb keeps its
    // slide: it is the one motion that should stay.
    root.classList.add("theme-instant");
    if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
    changeTimer.current = window.setTimeout(
      () => root.classList.remove("theme-instant"),
      100,
    );
    root.dataset.theme = next;
    root.style.colorScheme = next;
    // Keep the browser chrome (address bar) in step with the app theme,
    // not just the OS preference.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "dark" ? "#00081d" : "#ffffff");
    // Force the style recalc while transitions are suppressed, so the new
    // theme is committed before the class is removed.
    void root.offsetWidth;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        root.classList.remove("theme-instant");
        if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
      }),
    );
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the toggle still works for the session.
    }
    setTheme(next);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      aria-pressed={theme === "dark"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="theme-toggle-track" data-theme-state={theme}>
        <span className="theme-toggle-thumb">
          {theme === "light" ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
            </svg>
          )}
        </span>
      </span>
      <span className="theme-toggle-label">{theme === "light" ? "Light" : "Dark"}</span>
    </button>
  );
}

/**
 * Blocking inline script for <head>: resolves the theme before first paint
 * so there is no flash of the wrong theme. Stored choice wins; the OS
 * preference is only the default when nothing is stored. The theme-color
 * meta is synced here too, so the browser chrome matches on first paint.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#00081d':'#ffffff');}catch(e){document.documentElement.dataset.theme='light';}})();`;
