import { notFound } from "next/navigation";

import { isAdmin, requireUser } from "@/db/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

import { InviteForm, UserRow, type AdminUser } from "./admin-ui";

export const dynamic = "force-dynamic";

/**
 * User management for the one admin (ADMIN_EMAIL).
 *
 * Signup is closed in Supabase, so this is the only way in: create an invite
 * link and send it however you like, or have Supabase email it. Everyone else
 * gets a 404 — the page's existence isn't advertised.
 */
export default async function AdminPage() {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();

  const client = createSupabaseAdmin();
  let users: AdminUser[] = [];
  let loadError: string | null = null;

  if (!client) {
    loadError =
      "SUPABASE_SECRET_KEY isn't set, so users can't be listed or invited. Add it to the environment and restart.";
  } else {
    const { data, error } = await client.auth.admin.listUsers({ perPage: 1000 });
    if (error) loadError = error.message;
    users = (data?.users ?? [])
      .map((u) => ({
        id: u.id,
        email: u.email ?? "(no email)",
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at ?? null,
        accepted: Boolean(u.email_confirmed_at),
        isSelf: u.id === user.id,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="hint mt-1">
          Invite people and manage their accounts. Each person&rsquo;s vault is private to them —
          this page never shows anyone&rsquo;s content.
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Invite someone</h2>
        <p className="hint mt-1">
          &ldquo;Create link&rdquo; gives you a one-time sign-up link to send by any means — no
          email setup needed. &ldquo;Email invite&rdquo; has Supabase send it, which only reaches
          people outside your Supabase team once custom SMTP is configured.
        </p>
        <InviteForm />
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">People ({users.length})</h2>
        <ul className="mt-4 divide-y divide-line">
          {users.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </ul>
      </section>
    </div>
  );
}
