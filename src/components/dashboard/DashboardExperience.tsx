"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Brand } from "@/components/ui/Brand";
import { Icon, IconName } from "@/components/ui/Icon";
import { DemoApplication, demoApplications } from "@/data/demo";

type DashboardView = "Today" | "Approval Queue" | "Search" | "Applications" | "Inbox" | "Career Vault" | "Rules" | "Settings";
type Filter = "All" | "Ready" | "Needs you" | "Working" | "Confirmed";

const navPrimary: { label: DashboardView; icon: IconName; badge?: number }[] = [
  { label: "Today", icon: "today" },
  { label: "Approval Queue", icon: "queue", badge: 2 },
  { label: "Search", icon: "search" },
  { label: "Applications", icon: "applications" },
  { label: "Inbox", icon: "inbox", badge: 1 },
];

const navSecondary: { label: DashboardView; icon: IconName }[] = [
  { label: "Career Vault", icon: "vault" },
  { label: "Rules", icon: "rules" },
  { label: "Settings", icon: "settings" },
];

function Status({ application }: { application: DemoApplication }) {
  return <span className={`status-pill status-pill--${application.tone}`}><span aria-hidden="true" className="status-dot" />{application.status}</span>;
}

function AppIdentity({ application }: { application: DemoApplication }) {
  return (
    <span className="application-identity">
      <span className="company-avatar">{application.initials}</span>
      <span><strong>{application.company}</strong><small>{application.role}</small></span>
    </span>
  );
}

function Sidebar({ current, onChange }: { current: DashboardView; onChange: (view: DashboardView) => void }) {
  const renderItem = (item: { label: DashboardView; icon: IconName; badge?: number }) => (
    <button className={current === item.label ? "is-active" : ""} key={item.label} onClick={() => onChange(item.label)} type="button">
      <Icon name={item.icon} /><span>{item.label}</span>{item.badge ? <i>{item.badge}</i> : null}
    </button>
  );
  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand"><Brand /></div>
      <nav aria-label="Dashboard">{navPrimary.map(renderItem)}<div className="nav-divider" />{navSecondary.map(renderItem)}</nav>
      <div className="sidebar-account"><span className="company-avatar">AR</span><span><strong>Alex Rivera</strong><small>Founding preview</small></span></div>
      <Link className="sidebar-back" href="/">← Back to landing page</Link>
    </aside>
  );
}

function AuthorityBar({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return (
    <section className={`authority-bar ${paused ? "authority-bar--paused" : ""}`} aria-label="Current agent authority">
      <div><span className="authority-icon"><Icon name={paused ? "pause" : "check"} /></span><span><strong>{paused ? "All work paused" : "Per-application approval"}</strong><small>{paused ? "No discovery, drafting, or submission work will start." : "Drafting is active. One approval is required for every submission."}</small></span></div>
      <div className="authority-actions"><span className="mono">QUIET HOURS · 10 PM–7 AM</span><button className="button button--outline button--small" onClick={onToggle} type="button"><Icon name="pause" size={16} />{paused ? "Resume work" : "Pause all"}</button></div>
    </section>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`metric-card metric-card--${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AttentionCard({ application, onOpen }: { application: DemoApplication; onOpen: () => void }) {
  return (
    <article className="attention-card">
      <div className="attention-card__top"><AppIdentity application={application} /><Status application={application} /></div>
      <p>{application.openQuestions[0]}</p>
      <div className="attention-card__meta"><span><Icon name="clock" size={16} /> Since {application.updated}</span><span>{application.materials}</span></div>
      <button className="button button--dark button--small" onClick={onOpen} type="button">{application.nextAction} <Icon name="arrow" size={16} /></button>
    </article>
  );
}

function QueueCard({ application, onOpen, onApprove, paused }: { application: DemoApplication; onOpen: () => void; onApprove: () => void; paused: boolean }) {
  return (
    <article className="queue-card">
      <div className="queue-card__header"><AppIdentity application={application} /><span className="mono">{application.posted}</span></div>
      <div className="queue-card__rules"><strong>{application.rulesPassed} of {application.rulesTotal} rules passed</strong><p>{application.ruleSummary}</p></div>
      <div className="queue-card__materials"><Icon name="document" size={18} /><span>{application.materials}</span></div>
      <div className="queue-card__footer"><button className="text-button" onClick={onOpen} type="button">Review changes</button><button className="button button--sun button--small" disabled={paused} onClick={onApprove} type="button">Approve this application</button></div>
    </article>
  );
}

function WorkingCard({ application, onOpen }: { application: DemoApplication; onOpen: () => void }) {
  return (
    <button className="working-card" onClick={onOpen} type="button">
      <AppIdentity application={application} />
      <span className="working-progress"><i /><i className="is-active" /><i /></span>
      <span><strong>{application.status}</strong><small>{application.timeline.at(-1)?.detail}</small></span>
      <Icon name="arrow" />
    </button>
  );
}

function ReceiptCard({ application, onOpen }: { application: DemoApplication; onOpen: () => void }) {
  return (
    <button className="receipt-card" onClick={onOpen} type="button">
      <span className="receipt-check"><Icon name="check" /></span>
      <span><strong>{application.company} · {application.role}</strong><small>Confirmed {application.receipt?.confirmedAt}</small></span>
      <span className="mono">{application.receipt?.id}</span><Icon name="arrow" />
    </button>
  );
}

function TodayView({ paused, open, approve }: { paused: boolean; open: (app: DemoApplication) => void; approve: (app: DemoApplication) => void }) {
  const ready = demoApplications[0];
  const needs = demoApplications[1];
  const working = demoApplications[2];
  const confirmed = demoApplications[3];
  return (
    <>
      <section className="dashboard-heading"><div><span className="mono dashboard-date">THURSDAY · AUGUST 6</span><h1>Good morning, Alex.</h1><p>Four useful things happened while you were away. Two need a decision.</p></div><span className="prototype-badge">Illustrative prototype</span></section>
      <div className="metrics-grid"><MetricCard detail="Named applications" label="Ready for approval" tone="ready" value="2"/><MetricCard detail="Exact answer required" label="Needs you" tone="needs" value="1"/><MetricCard detail="No action yet" label="Working" tone="working" value="1"/><MetricCard detail="With evidence" label="Confirmed" tone="confirmed" value="1"/></div>
      <section className="dashboard-section"><div className="dashboard-section__heading"><div><span className="eyebrow eyebrow--small">First</span><h2>Needs you</h2></div><span>RoleDawn stops when an exact answer is missing.</span></div><AttentionCard application={needs} onOpen={() => open(needs)} /></section>
      <section className="dashboard-section"><div className="dashboard-section__heading"><div><span className="eyebrow eyebrow--small">Your call</span><h2>Approval Queue</h2></div><button className="text-button" type="button">View all 2</button></div><QueueCard application={ready} onApprove={() => approve(ready)} onOpen={() => open(ready)} paused={paused} /></section>
      <div className="dashboard-two-col"><section className="dashboard-section"><div className="dashboard-section__heading"><div><span className="eyebrow eyebrow--small">In progress</span><h2>Working</h2></div></div><WorkingCard application={working} onOpen={() => open(working)} /></section><section className="dashboard-section"><div className="dashboard-section__heading"><div><span className="eyebrow eyebrow--small">Proof</span><h2>Recent receipt</h2></div></div><ReceiptCard application={confirmed} onOpen={() => open(confirmed)} /></section></div>
    </>
  );
}

function ApplicationTable({ applications, onOpen }: { applications: DemoApplication[]; onOpen: (application: DemoApplication) => void }) {
  return (
    <>
      <div className="application-table-wrap">
        <table className="application-table">
          <thead><tr><th>Application</th><th>Source</th><th>Rule result</th><th>Materials</th><th>Status</th><th>Next action</th></tr></thead>
          <tbody>{applications.map((application) => <tr key={application.id} onClick={() => onOpen(application)}><td><AppIdentity application={application} /></td><td>{application.posted}<small>{application.source.split(" · ")[0]}</small></td><td><strong>{application.rulesPassed} of {application.rulesTotal} passed</strong><small>{application.ruleSummary}</small></td><td>{application.materials}</td><td><Status application={application} /></td><td><button aria-label={`Open ${application.company} ${application.role}`} className="row-action" type="button">{application.nextAction}<Icon name="arrow" size={16}/></button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="application-mobile-list">{applications.map((application) => <button className="application-mobile-card" key={application.id} onClick={() => onOpen(application)} type="button"><div><AppIdentity application={application}/><Status application={application}/></div><p>{application.rulesPassed} of {application.rulesTotal} rules · {application.posted}</p><span>{application.nextAction}<Icon name="arrow" size={16}/></span></button>)}</div>
    </>
  );
}

function ApplicationsView({ initialFilter = "All", open }: { initialFilter?: Filter; open: (application: DemoApplication) => void }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const filters: Filter[] = ["All", "Ready", "Needs you", "Working", "Confirmed"];
  const applications = useMemo(() => demoApplications.filter((application) => {
    if (filter === "All") return true;
    if (filter === "Ready") return application.tone === "ready";
    if (filter === "Needs you") return application.tone === "needs";
    if (filter === "Working") return application.tone === "working";
    return application.tone === "confirmed";
  }), [filter]);
  return (
    <>
      <section className="dashboard-heading"><div><span className="mono dashboard-date">APPLICATION CONTROL</span><h1>{initialFilter === "Ready" ? "Approval Queue" : "Applications"}</h1><p>Every state names the next action. Confirmed means evidence exists.</p></div><span className="prototype-badge">Illustrative prototype</span></section>
      <div className="filter-row" role="group" aria-label="Filter applications">{filters.map((item) => <button aria-pressed={filter === item} className={filter === item ? "is-active" : ""} key={item} onClick={() => setFilter(item)} type="button">{item}</button>)}</div>
      {applications.length ? <ApplicationTable applications={applications} onOpen={open}/> : <div className="empty-state"><Icon name="check" size={30}/><h2>Nothing in this state.</h2><p>The filter is working. No illustrative applications match it.</p></div>}
    </>
  );
}

function SearchView({ open }: { open: (application: DemoApplication) => void }) {
  return (
    <><section className="dashboard-heading"><div><span className="mono dashboard-date">SEARCH · ACTIVE</span><h1>Fresh matches</h1><p>Hard rules first. Explanations before scores.</p></div><span className="prototype-badge">Illustrative prototype</span></section><div className="search-rules-summary"><div><strong>Solutions · Product operations</strong><span>Remote or DC hybrid · $120k+ · ask above 15% travel</span></div><button className="button button--outline button--small" type="button">Edit rules</button></div><div className="search-card-grid">{demoApplications.slice(0, 3).map((application) => <button className="search-match-card" key={application.id} onClick={() => open(application)} type="button"><span className="mono">{application.posted}</span><AppIdentity application={application}/><strong>{application.rulesPassed} of {application.rulesTotal} saved rules passed</strong><p>{application.ruleSummary}</p><span className="text-button">Inspect match <Icon name="arrow" size={16}/></span></button>)}</div></>
  );
}

function PlaceholderView({ view }: { view: DashboardView }) {
  const descriptions: Record<DashboardView, string> = {
    Today: "",
    "Approval Queue": "",
    Search: "",
    Applications: "",
    Inbox: "Recruiter replies and confirmation messages will appear here after an explicitly connected channel is shipped.",
    "Career Vault": "Approved facts, source documents, usage policy, and version history live here.",
    Rules: "Search filters, authority, sensitive-answer policy, quiet hours, and exclusions live here.",
    Settings: "Connections, security, billing, export, deletion, and support live here—not in the operating queue.",
  };
  return (
    <><section className="dashboard-heading"><div><span className="mono dashboard-date">PRODUCT BLUEPRINT</span><h1>{view}</h1><p>{descriptions[view]}</p></div><span className="prototype-badge">Planned surface</span></section><div className="placeholder-surface"><div className="placeholder-icon"><Icon name={view === "Inbox" ? "inbox" : view === "Career Vault" ? "vault" : view === "Rules" ? "rules" : "settings"} size={30}/></div><h2>This page is specified, not faked.</h2><p>The prototype keeps this route visible to validate information architecture. It will be wired only when its data and permission contracts are ready.</p><Link className="button button--dark" href="/">Read the product story</Link></div></>
  );
}

function DetailPanel({ application, onClose, onApprove, paused }: { application: DemoApplication; onClose: () => void; onApprove: () => void; paused: boolean }) {
  return (
    <aside aria-label={`${application.company} application detail`} className="detail-panel">
      <div className="detail-panel__header"><div><span className="illustrative-label">Illustrative application</span><h2>{application.company}</h2><p>{application.role}</p></div><button aria-label="Close application detail" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button></div>
      <div className="detail-status"><Status application={application}/><span className="mono">UPDATED {application.updated.toUpperCase()}</span></div>
      <section><h3>Why it is here</h3><strong>{application.rulesPassed} of {application.rulesTotal} rules passed</strong><p>{application.ruleSummary}</p></section>
      {application.openQuestions.length > 0 && <section className="detail-alert"><h3>Needs a decision</h3>{application.openQuestions.map((question) => <p key={question}>{question}</p>)}</section>}
      {application.changes.length > 0 && <section><h3>Material changes</h3><ol className="detail-list">{application.changes.map((change) => <li key={change}>{change}</li>)}</ol></section>}
      {application.evidence.length > 0 && <section><h3>Evidence used</h3>{application.evidence.map((item) => <div className="detail-evidence" key={item.claim}><strong>{item.claim}</strong><span>{item.source}</span><small>{item.policy}</small></div>)}</section>}
      <section><h3>Activity</h3><ol className="event-timeline">{application.timeline.map((event) => <li className={`event-timeline__${event.kind}`} key={`${event.time}-${event.title}`}><span/><time className="mono">{event.time}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></li>)}</ol></section>
      {application.receipt && <section className="detail-receipt"><h3>Receipt</h3><dl><div><dt>ID</dt><dd className="mono">{application.receipt.id}</dd></div><div><dt>Portal</dt><dd>{application.receipt.portal}</dd></div><div><dt>Fields</dt><dd>{application.receipt.fields}</dd></div><div><dt>Files</dt><dd>{application.receipt.files.join(", ")}</dd></div></dl></section>}
      {application.tone === "ready" && <div className="detail-actions"><button className="button button--sun" disabled={paused} onClick={onApprove} type="button">Approve this application</button><button className="button button--outline" type="button">Edit</button><button className="text-button text-button--danger" type="button">Skip</button></div>}
    </aside>
  );
}

function ApprovalDialog({ application, dialogRef, onConfirm, onDismiss }: { application: DemoApplication | null; dialogRef: React.RefObject<HTMLDialogElement | null>; onConfirm: () => void; onDismiss: () => void }) {
  const [checked, setChecked] = useState(false);

  if (!application) return null;
  return (
    <dialog className="approval-dialog" onClose={onDismiss} ref={dialogRef}>
      <form method="dialog">
        <div className="approval-dialog__top"><span className="approval-lock"><Icon name="check" /></span><button aria-label="Close approval dialog" className="icon-button" value="cancel"><Icon name="close" /></button></div>
        <span className="eyebrow eyebrow--small">One application · one revision</span>
        <h2>Approve {application.company}?</h2>
        <p>This prototype demonstrates the authority boundary. It does not submit anything.</p>
        <dl><div><dt>Role</dt><dd>{application.role}</dd></div><div><dt>Revision</dt><dd>12 · immutable after approval</dd></div><div><dt>Material changes</dt><dd>{application.changes.length}</dd></div><div><dt>Open decisions</dt><dd>{application.openQuestions.length}</dd></div><div><dt>Expires</dt><dd>Two hours after confirmation</dd></div></dl>
        <label className="approval-check"><input checked={checked} onChange={(event) => setChecked(event.target.checked)} required type="checkbox"/><span>I am approving only this named application and revision.</span></label>
        <div className="approval-dialog__actions"><button className="button button--outline" value="cancel">Cancel</button><button className="button button--sun" disabled={!checked} onClick={onConfirm} type="button">Record demo approval</button></div>
      </form>
    </dialog>
  );
}

function MobileNav({ current, onChange }: { current: DashboardView; onChange: (view: DashboardView) => void }) {
  const items: { label: string; view: DashboardView; icon: IconName }[] = [{ label: "Today", view: "Today", icon: "today" }, { label: "Queue", view: "Approval Queue", icon: "queue" }, { label: "Search", view: "Search", icon: "search" }, { label: "Inbox", view: "Inbox", icon: "inbox" }, { label: "More", view: "Settings", icon: "menu" }];
  return <nav aria-label="Mobile dashboard" className="mobile-app-nav">{items.map((item) => <button className={current === item.view ? "is-active" : ""} key={item.label} onClick={() => onChange(item.view)} type="button"><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>;
}

export function DashboardExperience() {
  const [view, setView] = useState<DashboardView>("Today");
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<DemoApplication | null>(null);
  const [approval, setApproval] = useState<DemoApplication | null>(null);
  const [toast, setToast] = useState("");
  const approvalDialog = useRef<HTMLDialogElement>(null);

  const requestApproval = (application: DemoApplication) => {
    setApproval(application);
    window.setTimeout(() => approvalDialog.current?.showModal(), 0);
  };
  const confirmApproval = () => {
    approvalDialog.current?.close();
    setToast(`Demo approval recorded for ${approval?.company}. Nothing was submitted.`);
    setApproval(null);
    window.setTimeout(() => setToast(""), 5000);
  };
  const changeView = (next: DashboardView) => {
    setView(next);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="dashboard-app">
      <Sidebar current={view} onChange={changeView}/>
      <header className="mobile-app-header"><Brand compact/><strong>{view}</strong><button aria-label={paused ? "Resume all work" : "Pause all work"} className="icon-button" onClick={() => setPaused((value) => !value)} type="button"><Icon name="pause"/></button></header>
      <main className="dashboard-main">
        <div className="dashboard-topbar"><div className="dashboard-search"><Icon name="search"/><span>Search applications, companies, receipts…</span></div><div><span className="prototype-dot"/><span>Local prototype</span><span className="company-avatar">AR</span></div></div>
        <div className="dashboard-content">
          {view === "Today" && <><AuthorityBar paused={paused} onToggle={() => setPaused((value) => !value)}/><TodayView paused={paused} open={setSelected} approve={requestApproval}/></>}
          {view === "Approval Queue" && <ApplicationsView initialFilter="Ready" open={setSelected}/>} 
          {view === "Applications" && <ApplicationsView open={setSelected}/>} 
          {view === "Search" && <SearchView open={setSelected}/>} 
          {(["Inbox", "Career Vault", "Rules", "Settings"] as DashboardView[]).includes(view) && <PlaceholderView view={view}/>} 
        </div>
      </main>
      {selected && <><button aria-label="Close application detail" className="detail-scrim" onClick={() => setSelected(null)} type="button"/><DetailPanel application={selected} onApprove={() => requestApproval(selected)} onClose={() => setSelected(null)} paused={paused}/></>}
      <ApprovalDialog application={approval} dialogRef={approvalDialog} key={approval?.id ?? "closed"} onConfirm={confirmApproval} onDismiss={() => setApproval(null)}/>
      {toast && <div className="app-toast" role="status"><Icon name="check"/><span>{toast}</span></div>}
      <MobileNav current={view} onChange={changeView}/>
    </div>
  );
}
