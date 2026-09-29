import type { ReactNode } from "react";

import ui from "@/components/app/ui.module.css";
import { ProfileHeader } from "@/components/profile/ProfileHeader";

import styles from "./VaultLayout.module.css";

export default function VaultLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className={`${ui.page} ${styles.page}`}>
      <ProfileHeader />
      {children}
    </main>
  );
}
