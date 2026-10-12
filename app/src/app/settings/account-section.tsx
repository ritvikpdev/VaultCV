"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";

import { ConfirmButton } from "@/components/ui";

import { changePassword, deleteMyAccount } from "./actions";

export function AccountSection({ canDelete }: { canDelete: boolean }) {
  const [status, setStatus] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await changePassword(formData);
      setStatus(result.ok ? "Password changed" : result.error);
    });
  }

  return (
    <section className="card space-y-6 p-6">
      <h2 className="text-lg font-semibold">Account</h2>

      <form action={onSubmit} className="space-y-3">
        <h3 className="text-sm font-semibold">Change password</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            className="field"
            placeholder="New password"
            required
          />
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            className="field"
            placeholder="Repeat it"
            required
          />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" disabled={pending}>
            Update password
          </button>
          {status && <p className="text-sm text-muted">{status}</p>}
        </div>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Your data</h3>
        <p className="hint">
          Everything in your vault and resumes as one JSON file — yours to keep, whatever
          happens to this app.
        </p>
        <a className="btn-ghost" href="/api/my-data" download>
          <Download size={15} /> Download my data
        </a>
      </div>

      {canDelete && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-red-700">Delete account</h3>
          <p className="hint">
            Permanently deletes your account, vault, resumes and tuning history. This
            can&rsquo;t be undone — download your data first if you might want it.
          </p>
          <ConfirmButton
            className="btn border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            message="Delete your account and everything in it? This cannot be undone."
            disabled={pending}
            onConfirm={() =>
              startTransition(async () => {
                const result = await deleteMyAccount();
                // On success the action redirects; only failures come back.
                if (result && !result.ok) setDeleteError(result.error);
              })
            }
          >
            Delete my account
          </ConfirmButton>
          {deleteError && <p className="text-sm text-red-700">{deleteError}</p>}
        </div>
      )}
    </section>
  );
}
