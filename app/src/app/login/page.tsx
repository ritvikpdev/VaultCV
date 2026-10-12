import Link from "next/link";

import { signIn } from "../auth/actions";
import { AuthCard, AuthForm } from "../auth/auth-form";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { tone: "error" | "info"; text: string }> = {
  link: {
    tone: "error",
    text: "That link has expired or was already used. Ask for a new one.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; deleted?: string }>;
}) {
  const { next, error, deleted } = await searchParams;
  const notice = error ? NOTICES[error] : null;

  // Without Supabase settings nothing below can work. Say so instead of
  // failing on submit with a stack trace.
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
    process.env.DATABASE_URL,
  );

  return (
    <AuthCard
      title="Sign in"
      subtitle="vaultCV is invite-only. Use the email you were invited with."
    >
      {!configured && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This server isn&rsquo;t connected to Supabase yet. Fill in{" "}
          <code className="text-xs">app/.env.local</code> from{" "}
          <code className="text-xs">.env.example</code> and restart.
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{notice.text}</p>
      )}
      {deleted && (
        <p className="mb-4 rounded-lg bg-canvas px-3 py-2 text-sm">
          Your account and everything in it have been deleted.
        </p>
      )}

      <AuthForm action={signIn} submitLabel="Sign in">
        <input type="hidden" name="next" value={next ?? ""} />
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="field"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="field"
            required
          />
        </div>
      </AuthForm>

      <p className="hint mt-4 text-center">
        <Link href="/forgot-password" className="text-accent hover:underline">
          Forgot your password?
        </Link>
      </p>
    </AuthCard>
  );
}
