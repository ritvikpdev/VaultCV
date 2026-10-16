"use client";

import { createContext, useContext } from "react";

import type { VaultIndex } from "@/lib/vault-path";

/**
 * Where every vault item lives, for the resume editor's "Group → Section"
 * labels — the vault picker, pulled entries' source tags and tuner suggestions.
 *
 * A context rather than props because those three sit at different depths of
 * the editor and none of their parents use it. Built once on the server per
 * page load; an entry moved in the vault shows its new home on the next load.
 */
const VaultIndexContext = createContext<VaultIndex>({
  sections: {},
  entrySection: {},
  skillSection: {},
  entryNickname: {},
  skillEntry: {},
});

export function VaultIndexProvider({
  index,
  children,
}: {
  index: VaultIndex;
  children: React.ReactNode;
}) {
  return <VaultIndexContext.Provider value={index}>{children}</VaultIndexContext.Provider>;
}

export function useVaultIndex(): VaultIndex {
  return useContext(VaultIndexContext);
}
