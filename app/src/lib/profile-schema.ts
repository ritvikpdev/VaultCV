import { z } from "zod";

/**
 * Shared with the vault import save path, which also needs to validate
 * profile fields before merging them in. Kept out of `settings/actions.ts`
 * because that file is `"use server"`, and Next.js only allows async-function
 * exports from such modules — exporting a Zod schema breaks the build.
 */
export const linkSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().min(1),
});

export const profileSchema = z.object({
  fullName: z.string().trim().max(120),
  email: z.string().trim().max(200),
  phone: z.string().trim().max(60),
  location: z.string().trim().max(160),
  summary: z.string().trim().max(4000),
  links: z.array(linkSchema).max(8),
});
