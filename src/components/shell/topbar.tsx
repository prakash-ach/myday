"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

/** Phones don't get the sidebar, so the product name and theme control
 *  live here instead. */
export function Topbar() {
  return (
    <header className="border-line bg-canvas/85 sticky top-0 z-20 flex items-center justify-between border-b px-4 py-3 backdrop-blur-xl lg:hidden">
      <Link href="/" className="font-serif text-[19px] leading-none">
        MYDAY
      </Link>
      <div className="flex items-center gap-2">
        <Link
          href="/search"
          aria-label="Search"
          className="text-ink-muted flex h-8 w-8 items-center justify-center"
        >
          <Search size={18} strokeWidth={1.9} />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}
