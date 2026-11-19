"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

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
    // Re-assert the theme after mount. A reload with a persisted wallet
    // fires a React hydration mismatch, and the recovery re-render drops
    // the data-theme attribute the blocking init script set. Reading only
    // what is on the element would then adopt the wrong (light) theme even
    // though the user stored dark. Stored choice wins; otherwise keep the
    // element value the init script set.
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode: keep whatever the init script set.
    }
    const next: Theme =
      stored === "dark" || stored === "light"
        ? stored
        : document.documentElement.dataset.theme === "dark"
          ? "dark"
          : "light";
    const root = document.documentElement;
    root.dataset.theme = next;
    root.style.colorScheme = next;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next === "dark" ? "#00081d" : "#ffffff");
    setTheme(next);
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
            <Sun size={14} aria-hidden="true" />
          ) : (
            <Moon size={14} aria-hidden="true" />
          )}
        </span>
      </span>
      <span className="theme-toggle-label">{theme === "light" ? "Light" : "Dark"}</span>
    </button>
  );
}

/**
 * Blocking inline script for <head>: resolves the theme before first paint
 * so there is no flash of the wrong theme. Stored choice wins; otherwise
 * the default is light (Muhammed's call, 19 Nov 2026: the light theme
 * looks better in this app, so first-time visitors get light and only
 * keep dark if they switch to it). The theme-color meta is synced here
 * too, so the browser chrome matches on first paint.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var t=s==='light'||s==='dark'?s:'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#00081d':'#ffffff');}catch(e){document.documentElement.dataset.theme='light';}})();`;
