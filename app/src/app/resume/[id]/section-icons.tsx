import {
  Award,
  BadgeCheck,
  BookOpen,
  Briefcase,
  Code2,
  FileText,
  FolderGit2,
  GraduationCap,
  Heart,
  HeartHandshake,
  Languages,
  Layers,
  Lightbulb,
  Medal,
  Newspaper,
  Star,
  Trophy,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { SectionType } from "@/db/schema";

/**
 * Icons for resume sections — editor chrome only. The printed heading stays
 * plain text (single column, standard headings), so these never reach the
 * PDF; they make a long list of section cards scannable.
 */

export const SECTION_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  graduation: GraduationCap,
  wrench: Wrench,
  code: Code2,
  project: FolderGit2,
  badge: BadgeCheck,
  newspaper: Newspaper,
  trophy: Trophy,
  book: BookOpen,
  users: Users,
  handshake: HeartHandshake,
  languages: Languages,
  heart: Heart,
  user: User,
  file: FileText,
  star: Star,
  medal: Medal,
  award: Award,
  lightbulb: Lightbulb,
  layers: Layers,
};

const DEFAULT_ICON: Record<SectionType, string> = {
  summary: "user",
  education: "graduation",
  skill: "wrench",
  experience: "briefcase",
  project: "project",
  certification: "badge",
  publication: "newspaper",
  award: "trophy",
  course: "book",
  organization: "users",
  volunteer: "handshake",
  language: "languages",
  interest: "heart",
  reference: "file",
  custom: "layers",
};

/** The icon name a section shows: its own choice, else its type's default. */
export function iconNameFor(section: { icon: string | null; sectionType: SectionType }): string {
  return section.icon && SECTION_ICONS[section.icon] ? section.icon : DEFAULT_ICON[section.sectionType];
}

export function defaultIconFor(type: SectionType): LucideIcon {
  return SECTION_ICONS[DEFAULT_ICON[type]]!;
}

export function SectionIcon({
  section,
  size = 16,
  className,
}: {
  section: { icon: string | null; sectionType: SectionType };
  size?: number;
  className?: string;
}) {
  const Icon = SECTION_ICONS[iconNameFor(section)] ?? Layers;
  return <Icon size={size} className={className} aria-hidden />;
}
