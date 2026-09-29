import styles from "./CandidateRouteState.module.css";

export default function CandidateLoading() {
  return (
    <main aria-busy="true" aria-label="Loading" className={styles.page}>
      <div aria-hidden="true" className={styles.skeleton}>
        <span className={styles.lineShort} />
        <span className={styles.lineTitle} />
        <span className={styles.block} />
        <span className={styles.block} />
      </div>
    </main>
  );
}
