"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, Palette } from "lucide-react";
import { cn } from "@wanaflow/ui";

const STORAGE_KEY = "wanaflow-theme";

const themes = [
  {
    id: "default",
    label: "Default",
    description: "Neutral and precise",
  },
  {
    id: "claude",
    label: "Claude",
    description: "Warm and editorial",
  },
] as const;

type ThemeId = (typeof themes)[number]["id"];

function currentTheme(): ThemeId {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem(STORAGE_KEY) === "claude" ? "claude" : "default";
}

function persistTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = "light";
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event("wanaflow-theme-change"));
}

function subscribeToTheme(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    document.documentElement.dataset.theme = event.newValue === "claude" ? "claude" : "default";
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("wanaflow-theme-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("wanaflow-theme-change", onStoreChange);
  };
}

export function ThemeSwitcher({ className }: { className?: string }) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, () => "default");

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const choose = (nextTheme: ThemeId) => {
    persistTheme(nextTheme);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-label="Choose theme"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex size-9 items-center justify-center rounded-[var(--radius)] border border-transparent text-[var(--muted-ink)] transition-colors",
          "hover:border-[var(--line)] hover:bg-[var(--paper-raised)] hover:text-[var(--ink)]",
          open && "border-[var(--line)] bg-[var(--paper-raised)] text-[var(--ink)]",
        )}
        title={`Theme: ${theme === "claude" ? "Claude" : "Default"}`}
      >
        <Palette className="size-[17px] stroke-[1.7]" />
      </button>

      {open ? (
        <fieldset
          id={panelId}
          className="absolute right-0 top-11 z-50 w-[276px] overflow-hidden rounded-[calc(var(--radius)+0.375rem)] border border-[var(--line)] bg-[var(--popover)] text-[var(--popover-foreground)] shadow-[var(--shadow-xl)]"
        >
          <legend className="sr-only">Visual theme</legend>
          <div className="border-b border-[var(--line)] px-4 py-3.5">
            <p className="text-xs font-semibold tracking-[-0.01em]">Appearance</p>
            <p className="mt-1 text-[0.65rem] text-[var(--muted-ink)]">Two quiet systems for the same workspace.</p>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {themes.map((option) => (
              <label
                key={option.id}
                className="group flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-[var(--wash)]"
              >
                <input
                  type="radio"
                  name="wanaflow-theme"
                  value={option.id}
                  checked={theme === option.id}
                  onChange={() => choose(option.id)}
                  className="sr-only"
                />
                <span
                  className="theme-preview grid size-10 shrink-0 grid-cols-[9px_1fr] overflow-hidden rounded-[var(--radius)] border"
                  data-preview-theme={option.id}
                  aria-hidden="true"
                >
                  <span className="theme-preview-sidebar" />
                  <span className="theme-preview-page flex flex-col justify-end gap-1 p-1.5">
                    <span className="theme-preview-line h-1 w-full rounded-sm" />
                    <span className="theme-preview-accent h-1 w-3/5 rounded-sm" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className="mt-0.5 block text-[0.625rem] text-[var(--muted-ink)]">{option.description}</span>
                </span>
                <Check
                  className={cn(
                    "size-3.5 text-[var(--signal)] transition-opacity",
                    theme === option.id ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
