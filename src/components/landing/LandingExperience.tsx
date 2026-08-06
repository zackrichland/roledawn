"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, KeyboardEvent, useState } from "react";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { demoApplications } from "@/data/demo";

const scenarioTabs = ["Fresh match", "Resume change", "Needs your answer", "Confirmed"] as const;
type Scenario = (typeof scenarioTabs)[number];

function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="site-header__inner">
        <Brand />
        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="nav-menu-button"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <Icon name={open ? "close" : "menu"} />
        </button>
        <nav aria-label="Primary" className={`site-nav ${open ? "site-nav--open" : ""}`}>
          <a href="#how" onClick={() => setOpen(false)}>How it works</a>
          <a href="#proof" onClick={() => setOpen(false)}>What gets sent</a>
          <a href="#safety" onClick={() => setOpen(false)}>Safety</a>
          <a href="#pricing" onClick={() => setOpen(false)}>Pricing</a>
          <Link href="/dashboard" onClick={() => setOpen(false)}>Sign in</Link>
          <Link className="button button--dark button--small" href="/dashboard" onClick={() => setOpen(false)}>
            View dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}

function RuleChip({ children, warning = false }: { children: React.ReactNode; warning?: boolean }) {
  return (
    <span className={`rule-chip ${warning ? "rule-chip--warning" : ""}`}>
      <span aria-hidden="true">{warning ? "!" : "✓"}</span>
      {children}
    </span>
  );
}

function HeroSection() {
  return (
    <section aria-labelledby="hero-title" className="home-hero">
      <div className="home-hero__art" aria-hidden="true">
        <Image
          alt=""
          className="home-hero__image"
          fill
          priority
          sizes="100vw"
          src="/brand/roledawn-night-shift-machine.png"
        />
        <div className="home-hero__shade" />
      </div>
      <div className="home-hero__content">
        <div className="home-hero__title">
          <span className="eyebrow eyebrow--light">The application agent you can text</span>
          <h1 id="hero-title">Your job search has a night shift.</h1>
        </div>
        <div className="home-hero__pitch">
          <p>RoleDawn watches fresh job pages, shapes each application from your real work, and brings you the final call. Approve one. Get the receipt.</p>
          <div className="home-hero__actions">
            <a className="button button--light" href="#founding">Join the founding 50 <Icon name="arrow" size={18} /></a>
            <Link className="button button--hero-secondary" href="/dashboard">See the dashboard <Icon name="arrow" size={18} /></Link>
          </div>
          <small>No card. Nothing submitted without your approval.</small>
        </div>
      </div>
    </section>
  );
}

function NightShiftMachine() {
  const steps = ["Fresh career pages", "Sourced edits", "One approval", "ATS confirmation"];

  return (
    <section aria-labelledby="machine-title" className="machine-section">
      <div className="machine-section__copy">
        <div>
          <span className="eyebrow">The night shift</span>
          <h2 id="machine-title">One careful application at a time.</h2>
        </div>
        <div>
          <p>Fresh job pages come in. RoleDawn checks your rules, shapes the materials from your real work, and pauses when the answer belongs to you. After approval, it handles the portal and waits for confirmation.</p>
          <a className="text-link" href="#how">Follow the workflow <Icon name="arrow" size={18} /></a>
        </div>
      </div>
      <figure className="machine-stage">
        <Image
          alt=""
          className="machine-stage__image"
          height={941}
          priority
          sizes="(max-width: 900px) 100vw, 1280px"
          src="/brand/roledawn-night-shift-machine.png"
          width={1672}
        />
        <figcaption>
          <span>Original RoleDawn concept</span>
          <span>The hand gate marks the approval boundary.</span>
        </figcaption>
      </figure>
      <ol aria-label="The RoleDawn application loop" className="machine-steps">
        {steps.map((step, index) => <li key={step}><span className="mono">0{index + 1}</span>{step}</li>)}
      </ol>
    </section>
  );
}

function TrustStrip() {
  const items = [
    ["Every claim", "has a source"],
    ["One approval", "one application"],
    ["A receipt", "after confirmation"],
    ["Pause", "at any time"],
  ];
  return (
    <section aria-label="RoleDawn trust contract" className="trust-strip">
      <div className="trust-strip__inner">
        {items.map(([top, bottom]) => <div key={top}><strong>{top}</strong><span>{bottom}</span></div>)}
      </div>
    </section>
  );
}

function HowItWorks() {
  const cards = [
    { number: "01", title: "Teach it your truth.", body: "Upload a résumé, then approve the facts RoleDawn may use. Exact claims stay structured and sourced.", visual: "vault" },
    { number: "02", title: "Set the rules.", body: "Name the roles, salary, location, dealbreakers, and decisions that always come back to you.", visual: "rules" },
    { number: "03", title: "Wake up to approvals.", body: "Get a short queue with fit evidence, material changes, and the open questions that need your call.", visual: "queue" },
    { number: "04", title: "Get the receipt.", body: "After a confirmed submission, keep the exact answers, file versions, timestamp, and portal evidence.", visual: "receipt" },
  ];
  return (
    <section className="section how-section" id="how">
      <div className="section-heading">
        <span className="eyebrow">How it works</span>
        <h2>A better application starts with better context.</h2>
        <p>Give RoleDawn your real work, your search rules, and the decisions that should always come back to you.</p>
      </div>
      <div className="how-grid">
        {cards.map((card) => (
          <article className="how-card" key={card.number}>
            <div className={`how-card__visual how-card__visual--${card.visual}`}>
              <span className="how-card__number mono">{card.number}</span>
              {card.visual === "vault" && <><span className="mini-source">Resume.pdf · p2</span><span className="mini-claim">Multi-site launch</span><span className="mini-link" /></>}
              {card.visual === "rules" && <div className="mini-rule-list"><RuleChip>Remote</RuleChip><RuleChip>$120k+</RuleChip><RuleChip warning>Ask on travel</RuleChip></div>}
              {card.visual === "queue" && <div className="mini-queue"><span>Ready · 2</span><span>Needs you · 1</span><span>Working · 1</span></div>}
              {card.visual === "receipt" && <div className="mini-receipt"><Icon name="check" /><span>Confirmed</span><small className="mono">7:08 AM</small></div>}
            </div>
            <div className="how-card__copy"><h3>{card.title}</h3><p>{card.body}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScenarioPanel({ scenario }: { scenario: Scenario }) {
  if (scenario === "Fresh match") {
    return (
      <div className="scenario-panel">
        <div className="scenario-copy"><span className="mono scenario-time">11:47 PM</span><h3>Northline Robotics · Solutions Engineer</h3><p>Start with the reason this role belongs in your queue. The score can follow.</p></div>
        <div className="scenario-detail"><RuleChip>Role passed</RuleChip><RuleChip>Salary passed</RuleChip><RuleChip>Remote passed</RuleChip><RuleChip warning>25% travel conflicts with your 15% rule</RuleChip><strong>8 of 10 rules passed</strong></div>
      </div>
    );
  }
  if (scenario === "Resume change") {
    return (
      <div className="scenario-panel">
        <div className="scenario-copy"><span className="mono scenario-time">12:03 AM</span><h3>See every material change.</h3><p>RoleDawn shows the rewrite and the approved source that makes it defensible.</p></div>
        <div className="scenario-detail scenario-detail--diff"><div className="diff-line diff-line--removed">− Worked on internal healthcare tools.</div><div className="diff-line diff-line--added">+ Shipped a multi-site healthcare workflow used by operating teams.</div><div className="evidence-link"><span className="evidence-link__dot"/><span>Human Touch project brief · page 2</span></div></div>
      </div>
    );
  }
  if (scenario === "Needs your answer") {
    return (
      <div className="scenario-panel">
        <div className="scenario-copy"><span className="mono scenario-time">6:42 AM</span><h3>It stops where your facts stop.</h3><p>Salary, sponsorship, legal, and voluntary disclosure answers are never filled from a guess.</p></div>
        <div className="scenario-detail scenario-detail--question"><span className="status-pill status-pill--needs">Needs you</span><strong>What minimum base salary should I enter?</strong><p>No saved answer applies to this role. Nothing else is blocked.</p><button className="button button--dark button--small" type="button">Add exact answer</button></div>
      </div>
    );
  }
  return (
    <div className="scenario-panel">
      <div className="scenario-copy"><span className="mono scenario-time">7:08 AM</span><h3>“Submitted” has to mean confirmed.</h3><p>RoleDawn records what went out only after portal or email evidence is reconciled.</p></div>
      <div className="scenario-detail scenario-detail--confirmed"><div className="receipt-check"><Icon name="check" /></div><span className="status-pill status-pill--confirmed">Confirmed</span><strong>12 answers · 2 files · revision 12</strong><span className="mono">RD-ILLUSTRATIVE-0143</span></div>
    </div>
  );
}

function DifferenceTabs() {
  const [active, setActive] = useState<Scenario>(scenarioTabs[0]);
  const handleKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!(["ArrowRight", "ArrowLeft", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % scenarioTabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + scenarioTabs.length) % scenarioTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = scenarioTabs.length - 1;
    setActive(scenarioTabs[next]);
    document.getElementById(`scenario-tab-${next}`)?.focus();
  };
  return (
    <section className="section difference-section" id="proof">
      <div className="section-heading section-heading--center">
        <span className="eyebrow">The difference</span>
        <h2>See the reason. See the edit. Then decide.</h2>
      </div>
      <div aria-label="Application evidence examples" className="scenario-tabs" role="tablist">
        {scenarioTabs.map((tab, index) => (
          <button
            aria-controls="scenario-panel"
            aria-selected={active === tab}
            className={active === tab ? "is-active" : ""}
            id={`scenario-tab-${index}`}
            key={tab}
            onClick={() => setActive(tab)}
            onKeyDown={(event) => handleKeys(event, index)}
            role="tab"
            tabIndex={active === tab ? 0 : -1}
            type="button"
          >{tab}</button>
        ))}
      </div>
      <div aria-labelledby={`scenario-tab-${scenarioTabs.indexOf(active)}`} id="scenario-panel" role="tabpanel">
        <ScenarioPanel scenario={active} />
      </div>
    </section>
  );
}

function CareerVault() {
  return (
    <section className="section vault-section" id="safety">
      <div className="vault-layout">
        <div className="section-heading section-heading--left">
          <span className="eyebrow">Career Vault</span>
          <h2>Your work history, ready for the right role.</h2>
          <p>Your résumé starts the vault. Projects, metrics, and exact answers become approved facts with sources, versions, and rules for where they can be used.</p>
          <ul className="check-list">
            <li><Icon name="check" /> Exact facts stay structured.</li>
            <li><Icon name="check" /> Narrative evidence keeps its source.</li>
            <li><Icon name="check" /> Sensitive answers require explicit policy.</li>
            <li><Icon name="check" /> Unsupported claims fail before review.</li>
          </ul>
        </div>
        <div className="vault-visual">
          <div className="vault-source-card"><span className="mono">SOURCE · PROJECT BRIEF · P2</span><p>Led the rollout of a scheduling workflow across multiple operating locations...</p></div>
          <div className="vault-connector" aria-hidden="true"><span /></div>
          <div className="vault-fact-card"><span className="status-pill status-pill--confirmed">Approved fact</span><h3>Shipped a multi-site healthcare workflow</h3><dl><div><dt>Use</dt><dd>Résumé + application answers</dd></div><div><dt>Version</dt><dd>Approved Aug 6, 2026</dd></div></dl></div>
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <section className="section dashboard-marketing-section">
      <div className="section-heading section-heading--center">
        <span className="eyebrow">The control room</span>
        <h2>Open it when something needs you.</h2>
        <p>The dashboard leads with approvals, open questions, and confirmed applications. The background work stays in the background.</p>
      </div>
      <div className="dashboard-preview-shell">
        <div className="dashboard-preview-sidebar"><Brand compact /><span className="is-active"><Icon name="today" /> Today</span><span><Icon name="queue" /> Approval Queue</span><span><Icon name="applications" /> Applications</span><span><Icon name="inbox" /> Inbox</span><span><Icon name="vault" /> Career Vault</span><span><Icon name="rules" /> Rules</span></div>
        <div className="dashboard-preview-main">
          <div className="preview-top"><div><span className="mono">THURSDAY · AUGUST 6</span><h3>Good morning, Alex.</h3></div><span className="illustrative-label">Illustrative data</span></div>
          <div className="preview-authority"><span><strong>Per-application approval</strong> · Quiet hours ended at 7:00 AM</span><span className="status-pill">Search active</span></div>
          <div className="preview-metrics"><div><strong>2</strong><span>Ready</span></div><div><strong>1</strong><span>Needs you</span></div><div><strong>1</strong><span>Working</span></div><div><strong>1</strong><span>Confirmed</span></div></div>
          <div className="preview-table">
            <div className="preview-table__header"><span>Application</span><span>Rules</span><span>Status</span><span>Next</span></div>
            {demoApplications.slice(0, 4).map((application) => (
              <div className="preview-row" key={application.id}><span className="preview-company"><i>{application.initials}</i><b>{application.company}<small>{application.role}</small></b></span><span>{application.rulesPassed} of {application.rulesTotal}<small>{application.posted}</small></span><span><span className={`status-pill status-pill--${application.tone}`}>{application.status}</span></span><span>{application.nextAction}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="center-action"><Link className="button button--dark" href="/dashboard">Open the interactive dashboard <Icon name="arrow" /></Link></div>
    </section>
  );
}

function ReceiptSection() {
  return (
    <section className="section receipt-section">
      <div className="receipt-section__copy"><span className="eyebrow">Application Receipt</span><h2>Know what went out.</h2><p>A receipt appears after portal or email confirmation. It keeps the final answers, file versions, approval revision, timestamp, and the evidence that the application arrived.</p></div>
      <div className="large-receipt">
        <div className="large-receipt__header"><div className="receipt-check"><Icon name="check" /></div><div><span className="mono">CONFIRMED · 7:08 AM ET</span><h3>Northline Robotics</h3><p>Solutions Engineer</p></div></div>
        <dl><div><dt>Portal</dt><dd>Greenhouse</dd></div><div><dt>Approval</dt><dd>Revision 12 · single use</dd></div><div><dt>Fields</dt><dd>12 final answers</dd></div><div><dt>Files</dt><dd>Resume v12 · Letter v3</dd></div></dl>
        <div className="large-receipt__footer"><span className="mono">RD-ILLUSTRATIVE-0143</span><span>Portal + email evidence agree</span></div>
      </div>
    </section>
  );
}

function FAQ() {
  const questions = [
    ["Will RoleDawn invent experience to improve my chances?", "No. Customer-facing materials must resolve to approved evidence in your Career Vault. If the evidence is missing, RoleDawn asks or stops."],
    ["Does it submit applications while I sleep?", "The launch product prepares a verified queue while you sleep. Every MVP submission requires one explicit approval tied to one named application and one immutable revision."],
    ["What happens with sponsorship, legal, or demographic questions?", "RoleDawn uses only an exact saved policy or asks you live. It does not infer sensitive answers from a résumé, message history, or embedding."],
    ["What if an ATS asks for a CAPTCHA or one-time code?", "The workflow saves its progress and asks you to take over that step. It does not bypass the challenge or restart blindly."],
    ["How do I know the application was sent?", "A confirmed receipt appears only after portal or email evidence is captured and reconciled. Uncertain states remain labeled as checking submission."],
  ];
  return (
    <section className="section faq-section">
      <div className="section-heading section-heading--left"><span className="eyebrow">Questions worth asking</span><h2>The important questions, answered early.</h2></div>
      <div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
    </section>
  );
}

function FoundingCTA() {
  const [submitted, setSubmitted] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };
  return (
    <section className="founding-section" id="founding">
      <div className="founding-section__sky" aria-hidden="true" />
      <div className="founding-section__inner">
        <span className="eyebrow eyebrow--light">Founding 50</span>
        <h2>Put your search on the night shift.</h2>
        <p>Join the design-partner list for a guided setup and the first supported application workflows.</p>
        {submitted ? (
          <div className="form-success" role="status"><Icon name="check" /><div><strong>You’re on the prototype list.</strong><span>This demo does not send data anywhere yet.</span></div></div>
        ) : (
          <form className="founding-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="founding-email">Email address</label>
            <input id="founding-email" name="email" placeholder="you@example.com" required type="email" />
            <button className="button button--light" type="submit">Request early access</button>
          </form>
        )}
        <small>Prototype only. No information is transmitted or stored by this local build.</small>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer"><Brand inverse /><p>Nothing invented. Nothing outside your rules.</p><nav aria-label="Footer"><a href="#safety">Safety</a><Link href="/dashboard">Dashboard</Link><a href="mailto:hello@roledawn.example">Contact</a></nav><span className="mono">WORKING NAME · 2026</span></footer>
  );
}

export function LandingExperience() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <HeroSection />
        <TrustStrip />
        <NightShiftMachine />
        <HowItWorks />
        <DifferenceTabs />
        <CareerVault />
        <DashboardPreview />
        <ReceiptSection />
        <section className="section pricing-section" id="pricing"><div><span className="eyebrow">Pricing principle</span><h2>Pricing tied to confirmed applications.</h2></div><div className="pricing-note"><p>The private alpha is guided by the founding team. Post-alpha plans will count confirmed applications; failed, canceled, duplicate, and uncertain attempts will not use an application credit.</p><span className="status-pill status-pill--needs">Price tests, not launch commitments</span></div></section>
        <FAQ />
        <FoundingCTA />
      </main>
      <Footer />
    </>
  );
}
