import { safeNext } from "@/lib/safe-next";

import { confirmLink } from "../actions";
import { AuthCard } from "../auth-form";

export const dynamic = "force-dynamic";

const COPY: Record<string, { title: string; subtitle: string; button: string }> = {
  invite: {
    title: "You've been invited",
    subtitle: "Click continue to accept and choose a password.",
    button: "Continue",
  },
  recovery: {
    title: "Reset your password",
    subtitle: "Click continue, then choose a new password.",
    button: "Continue",
  },
};
const DEFAULT_COPY = {
  title: "Continue to vaultCV",
  subtitle: "Click continue to finish signing in.",
  button: "Continue",
};

/**
 * Where invite and password-reset links land — a deliberate extra click, not
 * an automatic verification. See confirmLink's comment in auth/actions.ts for
 * why: opening this page is safe no matter who or what fetches it (a preview
 * bot included); only pressing the button spends the one-time token.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; code?: string; next?: string }>;
}) {
  const sp = await searchParams;

  const fallbackNext = sp.type === "invite" || sp.type === "recovery" ? "/auth/set-password" : "/";
  const next = safeNext(sp.next, fallbackNext);
  const valid = Boolean(sp.code) || Boolean(sp.token_hash && sp.type);
  const copy = (sp.type && COPY[sp.type]) || DEFAULT_COPY;

  if (!valid) {
    return (
      <AuthCard title="Link not recognized">
        <p className="hint">
          This link is missing something it needs. If you copied it by hand, copy the whole
          thing — or ask whoever sent it for a fresh one.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={copy.title} subtitle={copy.subtitle}>
      <form action={confirmLink}>
        <input type="hidden" name="token_hash" value={sp.token_hash ?? ""} />
        <input type="hidden" name="type" value={sp.type ?? ""} />
        <input type="hidden" name="code" value={sp.code ?? ""} />
        <input type="hidden" name="next" value={next} />
        <button className="btn-primary w-full">{copy.button}</button>
      </form>
    </AuthCard>
  );
}
