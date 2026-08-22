"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Settings, Vault } from "lucide-react";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "My Resumes", icon: FileText, exact: true },
  { href: "/vault", label: "My Vault", icon: Vault, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-6">
        <Link href="/" className="mr-4 text-base font-semibold tracking-tight">
          vault<span className="text-accent">CV</span>
        </Link>

        {LINKS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accentSoft font-medium text-accent"
                  : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
