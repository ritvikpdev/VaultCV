import Link from "next/link";

import { requestPasswordReset } from "../auth/actions";
import { AuthCard, AuthForm } from "../auth/auth-form";

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one. If it doesn't arrive, ask whoever invited you for a reset link."
    >
      <AuthForm action={requestPasswordReset} submitLabel="Send reset link">
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
      </AuthForm>
      <p className="hint mt-4 text-center">
        <Link href="/login" className="text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
