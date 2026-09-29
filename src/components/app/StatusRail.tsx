import { APPLICATION_STEPS, type ApplicationPresentation } from "@/domain/application-presentation";

import styles from "./StatusRail.module.css";

/** Midnight track, one First Light bead moving toward "Done". */
export function StatusRail({ presentation, compact = false }: Readonly<{ presentation: ApplicationPresentation; compact?: boolean }>) {
  const complete = presentation.tone === "done";
  return (
    <ol
      aria-label={`Progress: ${presentation.label}`}
      className={`${styles.rail} ${compact ? styles.compact : ""}`}
      data-tone={presentation.tone}
    >
      {APPLICATION_STEPS.map((step, index) => {
        const state = complete || index < presentation.step ? "past" : index === presentation.step ? "current" : "future";
        return (
          <li data-state={state} key={step}>
            <span aria-hidden="true" className={styles.bead} />
            {!compact ? <span className={styles.label}>{step}</span> : <span className={styles.srOnly}>{step}</span>}
          </li>
        );
      })}
    </ol>
  );
}
