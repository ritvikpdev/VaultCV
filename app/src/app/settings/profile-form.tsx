"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Profile } from "@/db/schema";

import { saveProfile } from "./actions";

type LinkRow = { label: string; url: string };

export function ProfileForm({ profile }: { profile: Profile }) {
  const [links, setLinks] = useState<LinkRow[]>(
    profile.links.length > 0 ? profile.links : [{ label: "LinkedIn", url: "" }],
  );
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await saveProfile(formData);
      setStatus(result.ok ? "Saved" : result.error);
      if (result.ok) setTimeout(() => setStatus(null), 2000);
    });
  }

  return (
    <form action={onSubmit} className="card p-6">
      <h2 className="text-lg font-semibold">Profile</h2>
      <p className="hint mt-1">
        The contact block at the top of every resume. Individual resumes can
        override the summary.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fullName">
            Full name
          </label>
          <input
            id="fullName"
            name="fullName"
            className="field"
            defaultValue={profile.fullName}
            placeholder="Ritvik Kumar Panchbhaiya"
          />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            className="field"
            defaultValue={profile.email}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input
            id="phone"
            name="phone"
            className="field"
            defaultValue={profile.phone}
            placeholder="(202) 555-0100"
          />
        </div>
        <div>
          <label className="label" htmlFor="location">
            Location
          </label>
          <input
            id="location"
            name="location"
            className="field"
            defaultValue={profile.location}
            placeholder="Arlington, Virginia, USA"
          />
        </div>
      </div>

      <div className="mt-5">
        <label className="label">Links</label>
        <div className="space-y-2">
          {links.map((link, i) => (
            <div key={i} className="flex gap-2">
              <input
                name="linkLabel"
                className="field w-40"
                defaultValue={link.label}
                placeholder="LinkedIn"
              />
              <input
                name="linkUrl"
                className="field flex-1"
                defaultValue={link.url}
                placeholder="linkedin.com/in/…"
              />
              <button
                type="button"
                className="btn-ghost px-3"
                aria-label="Remove link"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost mt-2"
          onClick={() => setLinks([...links, { label: "", url: "" }])}
        >
          <Plus size={15} /> Add link
        </button>
      </div>

      <div className="mt-5">
        <label className="label" htmlFor="summary">
          Default summary
        </label>
        <textarea
          id="summary"
          name="summary"
          className="field min-h-24 resize-y"
          defaultValue={profile.summary}
          placeholder="Optional. Most single-page resumes leave this out."
        />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button type="submit" className="btn-accent" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
        {status && <span className="text-sm text-muted">{status}</span>}
      </div>
    </form>
  );
}
