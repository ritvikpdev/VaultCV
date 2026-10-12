"use client";

import { useState, useTransition } from "react";
import { Copy, Link2, Mail } from "lucide-react";

import { ConfirmButton } from "@/components/ui";

import { createInviteLink, createResetLink, deleteUser, sendInviteEmail } from "./actions";

export type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  lastSignIn: string | null;
  accepted: boolean;
  isSelf: boolean;
};

/** A generated link, with a copy button. Links are one-time and expire. */
function LinkBox({ link, note }: { link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg bg-canvas p-3">
      <div className="flex items-center gap-2">
        <input
          className="field flex-1 bg-surface text-xs"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy size={14} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="hint mt-2">{note}</p>
    </div>
  );
}

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(kind: "link" | "email") {
    setLink(null);
    setMessage(null);
    startTransition(async () => {
      if (kind === "link") {
        const r = await createInviteLink(email);
        if (r.ok) setLink(r.data);
        else setMessage(r.error);
      } else {
        const r = await sendInviteEmail(email);
        setMessage(r.ok ? `Invite emailed to ${email}.` : r.error);
      }
    });
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <input
          className="field min-w-56 flex-1"
          type="email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={pending || !email.trim()}
          onClick={() => run("link")}
        >
          <Link2 size={15} /> Create link
        </button>
        <button
          className="btn-ghost"
          disabled={pending || !email.trim()}
          onClick={() => run("email")}
        >
          <Mail size={15} /> Email invite
        </button>
      </div>
      {link && (
        <LinkBox
          link={link}
          note="Send this to them. It signs them in once and asks them to choose a password. It expires (one hour by default — adjustable in Supabase under Authentication → Emails)."
        />
      )}
      {message && <p className="mt-3 text-sm text-muted">{message}</p>}
    </div>
  );
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "never";
}

export function UserRow({ user }: { user: AdminUser }) {
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {user.email}
            {user.isSelf && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
          </p>
          <p className="hint">
            {user.accepted
              ? `Last signed in ${when(user.lastSignIn)}`
              : "Invited — hasn't set a password yet"}
          </p>
        </div>
        <button
          className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setMessage(null);
              const r = await createResetLink(user.email);
              if (r.ok) setLink(r.data);
              else setMessage(r.error);
            })
          }
        >
          {user.accepted ? "Reset link" : "New invite link"}
        </button>
        {!user.isSelf && (
          <ConfirmButton
            className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
            disabled={pending}
            message={`Delete ${user.email} and everything in their vault? This cannot be undone.`}
            onConfirm={() =>
              startTransition(async () => {
                const r = await deleteUser(user.id);
                if (!r.ok) setMessage(r.error);
              })
            }
          >
            Delete
          </ConfirmButton>
        )}
      </div>
      {link && (
        <LinkBox
          link={link}
          note="One-time link. It signs them in and takes them straight to choosing a new password."
        />
      )}
      {message && <p className="mt-2 text-sm text-red-700">{message}</p>}
    </li>
  );
}
