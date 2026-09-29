"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./Profile.module.css";

const TABS = [
  { href: "/vault", label: "Résumé", match: ["/vault"] },
  { href: "/vault/experience", label: "Experience", match: ["/vault/experience", "/vault/facts"] },
  { href: "/vault/stories", label: "Stories", match: ["/vault/stories", "/vault/interview"] },
  { href: "/vault/answers", label: "Answers", match: ["/vault/answers"] },
  { href: "/vault/preferences", label: "Preferences", match: ["/vault/preferences"] },
] as const;

const COPY: Readonly<Record<string, Readonly<{ title: string; detail: string }>>> = {
  "/vault": { title: "Your résumé", detail: "The source RoleDawn tailors for every job. Confirm the text once and it stays yours." },
  "/vault/experience": { title: "Your experience", detail: "Employers, titles, and dates exactly as your résumé prints them. RoleDawn never invents a role or a date." },
  "/vault/facts": { title: "Résumé lines", detail: "Every line RoleDawn may use, one by one. Hide anything you'd rather not see in an application." },
  "/vault/stories": { title: "Your stories", detail: "Specific moments from your work, in your words. They're what make a cover letter sound like you and not like everyone else." },
  "/vault/interview": { title: "Interview", detail: "A short conversation about your best work. You approve every story before RoleDawn uses it." },
  "/vault/answers": { title: "Your answers", detail: "The questions every application asks. Answer once; RoleDawn fills them exactly as saved." },
  "/vault/preferences": { title: "What you're looking for", detail: "Roles, places, and ways of working. Autopilot only applies to jobs that fit." },
};

export function ProfileHeader() {
  const pathname = usePathname();
  const copy = COPY[pathname] ?? COPY["/vault"];
  return (
    <header className={styles.header}>
      <span className={styles.kicker}>Profile</span>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.lede}>{copy.detail}</p>
      <nav aria-label="Profile sections" className={styles.tabs}>
        {TABS.map((tab) => {
          const active = (tab.match as readonly string[]).includes(pathname);
          return <Link aria-current={active ? "page" : undefined} href={tab.href} key={tab.href}>{tab.label}</Link>;
        })}
      </nav>
    </header>
  );
}
