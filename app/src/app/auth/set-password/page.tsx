import { requireUser } from "@/db/session";

import { setNewPassword } from "../actions";
import { AuthCard, AuthForm } from "../auth-form";

export const dynamic = "force-dynamic";

/**
 * Where invite and reset links end up, already signed in by /auth/confirm.
 * An invited person has no password until they submit this.
 */
export default async function SetPasswordPage() {
  const user = await requireUser();

  return (
    <AuthCard title="Choose a password" subtitle={`For ${user.email}. At least 8 characters.`}>
      <AuthForm action={setNewPassword} submitLabel="Save password">
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            className="field"
            required
            minLength={8}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Repeat it
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            className="field"
            required
          />
        </div>
      </AuthForm>
    </AuthCard>
  );
}
