"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const dark = mounted && resolvedTheme === "dark";

  return <button
    className="qb-theme-toggle"
    type="button"
    aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    title={dark ? "Switch to light mode" : "Switch to dark mode"}
    onClick={() => setTheme(dark ? "light" : "dark")}
  >
    {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    <span>{dark ? "Light mode" : "Dark mode"}</span>
  </button>;
}
