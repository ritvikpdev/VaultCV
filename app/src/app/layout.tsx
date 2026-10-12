import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import { getSessionUser, isAdmin, type SessionUser } from "@/db/session";

import "./globals.css";

export const metadata: Metadata = {
  title: "vaultCV",
  description: "Resume tuner: one vault of everything you have done, many tailored resumes",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null when signed out — or when Supabase isn't configured yet, in which
  // case the login page explains what's missing rather than this crashing.
  let user: SessionUser | null = null;
  try {
    user = await getSessionUser();
  } catch {
    user = null;
  }

  return (
    <html lang="en">
      <body>
        <Nav user={user ? { email: user.email, isAdmin: isAdmin(user) } : null} />
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
