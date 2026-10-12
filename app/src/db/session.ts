import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServer } from "@/lib/supabase/server";

import { bootstrap } from "./bootstrap";
import { runAsUser } from "./client";

export type SessionUser = { id: string; email: string };

/**
 * The signed-in user, verified — or null.
 *
 * `getClaims()` verifies the session JWT's signature (locally against the
 * project's published keys where it can, otherwise with the Auth server), so a
 * forged or expired cookie never yields a user. Memoised per request: a page
 * and the actions it calls share one check.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: String(data.claims.email ?? "") };
});

/** The signed-in user, or a redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function isAdmin(user: SessionUser | null): boolean {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(admin && user?.email.trim().toLowerCase() === admin);
}

/**
 * The entry point to the vault. Every page, action and route that touches the
 * database goes through this.
 *
 * Resolves the session, opens a transaction acting as that user (so row-level
 * security confines every query to their rows — see runAsUser), runs first-use
 * setup, then `fn`. Not signed in → redirect to /login; there is no anonymous
 * path to the data.
 *
 * Keep slow external calls (AI providers) outside it where you can: the
 * transaction holds a pooled connection for as long as `fn` runs.
 */
export async function withVault<T>(fn: (user: SessionUser) => Promise<T>): Promise<T> {
  const user = await requireUser();
  return runAsUser(user.id, async () => {
    await bootstrap();
    return fn(user);
  });
}

/**
 * The public origin, for links that leave the app — invite and reset emails.
 * SITE_URL when set (it should be in production); otherwise the request's own
 * host, which is right in local development.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
