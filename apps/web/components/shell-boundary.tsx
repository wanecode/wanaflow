"use client";

import { usePathname } from "next/navigation";

import { AppShell } from "./app-shell";
import { ThemeSwitcher } from "./theme-switcher";

export function ShellBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/sign-in") || pathname.startsWith("/join/")) {
    return (
      <>
        <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
          <ThemeSwitcher />
        </div>
        {children}
      </>
    );
  }
  return <AppShell>{children}</AppShell>;
}
