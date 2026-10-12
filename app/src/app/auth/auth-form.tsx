"use client";

import { useState, useTransition } from "react";

import type { AuthResult } from "./actions";

/**
 * The shared shell of every signed-out form: fields come in as children, the
 * action's error or confirmation is shown underneath. Success usually means a
 * redirect from the action itself, so only failures and messages come back.
 */
export function AuthForm({
  action,
  submitLabel,
  children,
}: {
  action: (formData: FormData) => Promise<AuthResult>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [result, setResult] = useState<AuthResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(formData) =>
        startTransition(async () => {
          const r = await action(formData);
          if (r) setResult(r);
        })
      }
    >
      {children}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Please wait…" : submitLabel}
      </button>
      {result && !result.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>
      )}
      {result?.ok && result.message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {result.message}
        </p>
      )}
    </form>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <p className="mb-6 text-center text-2xl font-semibold tracking-tight">
        vault<span className="text-accent">CV</span>
      </p>
      <div className="card p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="hint mt-1">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
