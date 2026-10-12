"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, LogOut, Settings, Shield, Vault } from "lucide-react";

import { signOut } from "@/app/auth/actions";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "My Resumes", icon: FileText, exact: true },
  { href: "/vault", label: "My Vault", icon: Vault, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

/**
 * App chrome. Signed out, it's just the wordmark — the login page needs no
 * links to places it can't reach.
 */
export function Nav({ user }: { user: { email: string; isAdmin: boolean } | null }) {
  const pathname = usePathname();
  const links = user
    ? user.isAdmin
      ? [...LINKS, { href: "/admin", label: "Admin", icon: Shield, exact: false }]
      : LINKS
    : [];

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-6">
        <Link href="/" className="mr-4 text-base font-semibold tracking-tight">
          vault<span className="text-accent">CV</span>
        </Link>

        {links.map(({ href, label, icon: Icon, exact }) => {
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

        {user && (
          <form action={signOut} className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
            <button
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-canvas hover:text-ink"
              title="Sign out"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        )}
      </nav>
    </header>
  );
}
