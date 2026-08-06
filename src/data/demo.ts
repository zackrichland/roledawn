export type StatusTone = "ready" | "needs" | "working" | "confirmed" | "closed";

export type DemoTimelineEvent = {
  time: string;
  title: string;
  detail: string;
  kind: "done" | "current" | "waiting";
};

export type DemoApplication = {
  id: string;
  company: string;
  initials: string;
  role: string;
  source: string;
  posted: string;
  rulesPassed: number;
  rulesTotal: number;
  ruleSummary: string;
  materials: string;
  status: string;
  tone: StatusTone;
  nextAction: string;
  updated: string;
  changes: string[];
  openQuestions: string[];
  evidence: { claim: string; source: string; policy: string }[];
  timeline: DemoTimelineEvent[];
  receipt?: {
    id: string;
    confirmedAt: string;
    portal: string;
    fields: number;
    files: string[];
  };
};

export const demoApplications: DemoApplication[] = [
  {
    id: "northline-solutions",
    company: "Northline Robotics",
    initials: "NR",
    role: "Solutions Engineer",
    source: "Greenhouse · posted 18 min ago",
    posted: "18 min ago",
    rulesPassed: 8,
    rulesTotal: 10,
    ruleSummary: "Remote, salary, level, and role passed. Travel needs your call.",
    materials: "3 résumé changes · 1 short answer",
    status: "Ready for approval",
    tone: "ready",
    nextAction: "Review 3 changes",
    updated: "7:05 AM",
    changes: [
      "Moved customer implementation evidence above internal tooling work.",
      "Replaced a general AI bullet with the approved scheduling-workflow result.",
      "Added the verified multi-site adoption detail from your Career Vault.",
    ],
    openQuestions: ["The role lists up to 25% travel. Your rule is capped at 15%."],
    evidence: [
      {
        claim: "Shipped a multi-site healthcare workflow",
        source: "Career Vault · Human Touch project brief, page 2",
        policy: "Approved for résumé and application answers",
      },
      {
        claim: "Translated operational needs into product requirements",
        source: "Career Vault · manager-approved experience note",
        policy: "Approved for narrative use",
      },
    ],
    timeline: [
      { time: "11:47 PM", title: "Fresh role found", detail: "Career page snapshot saved.", kind: "done" },
      { time: "11:48 PM", title: "Hard rules checked", detail: "8 passed. Travel flagged.", kind: "done" },
      { time: "12:03 AM", title: "Materials prepared", detail: "Three sourced changes; one answer drafted.", kind: "done" },
      { time: "7:05 AM", title: "Waiting for you", detail: "Nothing has been submitted.", kind: "current" },
    ],
  },
  {
    id: "fieldnote-ops",
    company: "Fieldnote Health",
    initials: "FH",
    role: "Product Operations Lead",
    source: "Ashby · posted 2 hr ago",
    posted: "2 hr ago",
    rulesPassed: 9,
    rulesTotal: 10,
    ruleSummary: "All hard rules passed. One exact salary answer is missing.",
    materials: "Résumé ready · cover letter ready",
    status: "Needs you",
    tone: "needs",
    nextAction: "Answer salary question",
    updated: "6:42 AM",
    changes: ["Reordered operations and executive-translation evidence for the role."],
    openQuestions: ["What minimum base salary should RoleDawn enter for this application?"],
    evidence: [
      {
        claim: "Led regulated multi-site modernization",
        source: "Career Vault · master résumé, experience 1",
        policy: "Approved for all job materials",
      },
    ],
    timeline: [
      { time: "5:54 AM", title: "Fresh role found", detail: "Posting and questions saved.", kind: "done" },
      { time: "5:57 AM", title: "Materials prepared", detail: "All claims passed provenance checks.", kind: "done" },
      { time: "6:42 AM", title: "Exact answer needed", detail: "Salary cannot be inferred.", kind: "waiting" },
    ],
  },
  {
    id: "lantern-platform",
    company: "Lantern Ledger",
    initials: "LL",
    role: "AI Platform Specialist",
    source: "Lever · posted 41 min ago",
    posted: "41 min ago",
    rulesPassed: 7,
    rulesTotal: 9,
    ruleSummary: "Role and compensation passed. Location policy is being checked.",
    materials: "Mapping evidence",
    status: "Preparing",
    tone: "working",
    nextAction: "No action yet",
    updated: "Now",
    changes: [],
    openQuestions: [],
    evidence: [],
    timeline: [
      { time: "7:16 AM", title: "Fresh role found", detail: "Posting snapshot saved.", kind: "done" },
      { time: "7:17 AM", title: "Checking rules", detail: "Location language needs deterministic review.", kind: "current" },
    ],
  },
  {
    id: "harborframe-success",
    company: "Harborframe",
    initials: "HF",
    role: "Technical Customer Success Manager",
    source: "Greenhouse · saved yesterday",
    posted: "Yesterday",
    rulesPassed: 10,
    rulesTotal: 10,
    ruleSummary: "Every saved rule passed.",
    materials: "Resume v12 · answers v3",
    status: "Confirmed",
    tone: "confirmed",
    nextAction: "View receipt",
    updated: "Yesterday, 9:14 PM",
    changes: ["Used the approved customer-adoption version of the Human Touch story."],
    openQuestions: [],
    evidence: [
      {
        claim: "Drove adoption across multiple operating locations",
        source: "Career Vault · adoption evidence note",
        policy: "Approved for customer-facing roles",
      },
    ],
    timeline: [
      { time: "8:46 PM", title: "Application approved", detail: "Single-use approval bound to revision 12.", kind: "done" },
      { time: "9:11 PM", title: "Portal submitted", detail: "Confirmation page detected.", kind: "done" },
      { time: "9:14 PM", title: "Receipt reconciled", detail: "Email and portal evidence agree.", kind: "done" },
    ],
    receipt: {
      id: "RD-ILLUSTRATIVE-0142",
      confirmedAt: "Yesterday at 9:14 PM ET",
      portal: "Greenhouse",
      fields: 12,
      files: ["resume-v12.pdf", "cover-letter-v3.pdf"],
    },
  },
];
