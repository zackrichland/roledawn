"use client";

import { useState } from "react";

import ui from "@/components/app/ui.module.css";
import { displayUrl, type CoverLetterDocumentModel, type ResumeDocumentModel } from "@/domain/application-documents";
import type { ApplicationDocumentsView } from "@/server/applications/application-documents-view";

import styles from "./ApplicationDocuments.module.css";

type Tab = "LETTER" | "RESUME" | "ANSWERS" | "WHY";

export type DownloadLink = Readonly<{ label: string; href: string }>;

const ANSWER_LABELS: Readonly<Record<string, string>> = {
  WHY_COMPANY: "Why this company?",
  WHY_ROLE: "Why this role?",
  RELEVANT_EXPERIENCE: "Tell us about relevant experience",
};

const COVERAGE_LABEL: Readonly<Record<string, string>> = { DIRECT: "Proven", ADJACENT: "Related", GAP: "Gap" };

function Contact({ contact }: Readonly<{ contact: ResumeDocumentModel["contact"] }>) {
  const items = [contact.location, contact.email, contact.phone, displayUrl(contact.linkedinUrl), displayUrl(contact.websiteUrl)].filter(Boolean);
  return <p className={styles.contact}>{items.join(" · ")}</p>;
}

function ResumePaper({ model }: Readonly<{ model: ResumeDocumentModel }>) {
  return (
    <article className={styles.paper} aria-label="Résumé preview">
      <header className={styles.paperHeader}>
        <h3>{model.name}</h3>
        {model.headline ? <p className={styles.headline}>{model.headline}</p> : null}
        <Contact contact={model.contact} />
      </header>
      {model.summary ? (
        <section className={styles.paperSection}>
          <h4>Summary</h4>
          <p>{model.summary}</p>
        </section>
      ) : null}
      {model.sections.map((section) => (
        <section className={styles.paperSection} key={section.heading}>
          <h4>{section.heading}</h4>
          {section.kind === "EXPERIENCE" || section.kind === "PROJECTS" ? section.entries.map((entry) => (
            <div className={styles.entry} key={`${entry.organization}-${entry.title}-${entry.dates}`}>
              <div className={styles.entryLine}>
                <span><strong>{entry.title}</strong>, {entry.organization}{entry.location ? <em> · {entry.location}</em> : null}</span>
                {entry.dates ? <time>{entry.dates}</time> : null}
              </div>
              {entry.bullets.length ? <ul>{entry.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : null}
            </div>
          )) : null}
          {section.kind === "EDUCATION" ? section.entries.map((entry) => (
            <div className={styles.entry} key={`${entry.institution}-${entry.credential}`}>
              <div className={styles.entryLine}>
                <span><strong>{entry.credential}</strong>, {entry.institution}</span>
                {entry.dates ? <time>{entry.dates}</time> : null}
              </div>
            </div>
          )) : null}
          {section.kind === "SKILLS" ? section.groups.map((group) => (
            <p className={styles.skills} key={group.label ?? group.items.join(",")}>{group.label ? <strong>{group.label}: </strong> : null}{group.items.join(", ")}</p>
          )) : null}
          {section.kind === "LIST" ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </section>
      ))}
    </article>
  );
}

function LetterPaper({ model }: Readonly<{ model: CoverLetterDocumentModel }>) {
  return (
    <article className={`${styles.paper} ${styles.letter}`} aria-label="Cover letter preview">
      <header className={styles.paperHeader}>
        <h3>{model.name}</h3>
        <Contact contact={model.contact} />
      </header>
      <p className={styles.meta}>{model.dateLine}</p>
      <p className={styles.meta}>{model.recipientLines.join("\n")}</p>
      <p>{model.salutation}</p>
      {model.paragraphs.map((paragraph) => <p key={paragraph.slice(0, 48)}>{paragraph}</p>)}
      <p className={styles.closing}>{model.closing}<br />{model.signature}</p>
    </article>
  );
}

export function ApplicationDocuments({ view, letterDownloads, resumeDownloads, combinedDownload }: Readonly<{
  view: ApplicationDocumentsView;
  letterDownloads: readonly DownloadLink[];
  resumeDownloads: readonly DownloadLink[];
  combinedDownload: DownloadLink | null;
}>) {
  const [tab, setTab] = useState<Tab>("LETTER");
  const [copied, setCopied] = useState<string | null>(null);
  const tabs: readonly Readonly<{ id: Tab; label: string }>[] = [
    { id: "LETTER", label: "Cover letter" },
    { id: "RESUME", label: "Résumé" },
    ...(view.answers.length ? [{ id: "ANSWERS" as const, label: "Short answers" }] : []),
    ...(view.brief || view.strategy ? [{ id: "WHY" as const, label: "Why this approach" }] : []),
  ];

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  const downloads = tab === "RESUME" ? resumeDownloads : tab === "LETTER" ? letterDownloads : [];

  return (
    <section className={styles.documents} aria-label="Your application documents">
      <div className={styles.tabBar} role="tablist" aria-label="Documents">
        {tabs.map((entry) => (
          <button aria-selected={tab === entry.id} key={entry.id} onClick={() => setTab(entry.id)} role="tab" type="button">{entry.label}</button>
        ))}
        {combinedDownload ? <a className={styles.combined} href={combinedDownload.href}>{combinedDownload.label}</a> : null}
      </div>

      <div className={styles.panel} role="tabpanel">
        {tab === "LETTER" ? <LetterPaper model={view.coverLetter} /> : null}
        {tab === "RESUME" ? <ResumePaper model={view.resume} /> : null}
        {tab === "ANSWERS" ? (
          <div className={styles.answers}>
            <p className={ui.hint}>Ready for the free-text boxes employers often add. RoleDawn uses these when a form asks, and you can copy them for anything else.</p>
            {view.answers.map((answer) => (
              <div className={styles.answer} key={answer.kind}>
                <div className={styles.answerHead}>
                  <strong>{ANSWER_LABELS[answer.kind] ?? answer.kind}</strong>
                  <button className={`${ui.quiet} ${ui.small}`} onClick={() => copy(answer.text, answer.kind)} type="button">{copied === answer.kind ? "Copied" : "Copy"}</button>
                </div>
                <p>{answer.text}</p>
              </div>
            ))}
          </div>
        ) : null}
        {tab === "WHY" ? (
          <div className={styles.why}>
            {view.brief ? (
              <>
                <div className={styles.whyBlock}>
                  <span className={ui.eyebrow}>What they need</span>
                  <p className={styles.whyLead}>{view.brief.roleSummary}</p>
                  {view.brief.sixMonthOutcome ? <p><strong>In six months, this hire has to:</strong> {view.brief.sixMonthOutcome}</p> : null}
                </div>
                {view.brief.whyNow.type !== "UNKNOWN" ? (
                  <div className={styles.whyBlock}>
                    <span className={ui.eyebrow}>Our read on why now · a guess</span>
                    <p>{view.brief.whyNow.hypothesis}</p>
                    <p className={ui.hint}>Based on: {view.brief.whyNow.basis}</p>
                  </div>
                ) : null}
              </>
            ) : null}
            {view.strategy ? (
              <div className={styles.whyBlock}>
                <span className={ui.eyebrow}>The angle</span>
                <p>{view.strategy.angle}</p>
                <ul className={styles.requirements}>
                  {view.strategy.topRequirements.map((requirement) => (
                    <li key={requirement.requirement} data-coverage={requirement.coverage}>
                      <span className={styles.coverage}>{COVERAGE_LABEL[requirement.coverage] ?? requirement.coverage}</span>
                      <span>{requirement.requirement}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {view.brief?.theirLanguage.length ? (
              <div className={styles.whyBlock}>
                <span className={ui.eyebrow}>Their words, mirrored where true</span>
                <div className={styles.terms}>{view.brief.theirLanguage.map((term) => <span className={ui.chip} key={term}>{term}</span>)}</div>
              </div>
            ) : null}
            {view.facts.length ? (
              <div className={styles.whyBlock}>
                <span className={ui.eyebrow}>What RoleDawn read about them</span>
                <ul className={styles.facts}>
                  {view.facts.map((fact) => (
                    <li key={fact.id}>
                      <span>{fact.text}</span>
                      <a href={fact.url} rel="noreferrer" target="_blank">{fact.sourceTitle}{fact.published ? ` · ${fact.published}` : ""}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {view.quality?.warnings.length ? (
              <div className={styles.whyBlock}>
                <span className={ui.eyebrow}>Notes from the checks</span>
                <ul className={styles.notes}>{view.quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            ) : null}
            <p className={ui.hint}>Every claim in these documents was checked against your résumé, your approved stories, the posting, or the pages cited above.</p>
          </div>
        ) : null}
      </div>

      {downloads.length ? (
        <div className={styles.downloads}>
          {downloads.map((download) => <a className={`${ui.secondary} ${ui.small}`} href={download.href} key={download.href}>{download.label}</a>)}
        </div>
      ) : null}
    </section>
  );
}
