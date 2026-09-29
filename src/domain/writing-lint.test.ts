import assert from "node:assert/strict";
import test from "node:test";

import {
  WRITING_LINT_CODES,
  WRITING_LINT_RELEASE,
  lintApplicationWriting,
  writingLintRepairBrief,
} from "./writing-lint.ts";
import type {
  WritingLintInput,
  WritingLintIssue,
  WritingLintReport,
  WritingLintSeverity,
} from "./writing-lint.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const CLEAN_LETTER = [
  "Dear Ms. Okafor,",
  "Last spring our billing service at Lumen Health double-charged 1,140 patients in one night. I led the fix. We traced it to a retry loop that ignored idempotency keys, shipped a patch in six hours, and refunded every account before the clinics opened.",
  "That incident is why the Payments Reliability role at Northwind caught my attention. Your posting asks for someone who has owned money-moving code in production, and that has been most of my last four years. I rebuilt our ledger reconciliation job in Go, cut its runtime from 50 minutes to 7, and wrote the runbook the on-call team still uses.",
  "Outside of incidents, I like the unglamorous work. Our team retired three cron servers last year. Nobody noticed, which was the point.",
  "I would welcome a conversation about the ledger migration you mention for next year.",
  "Sincerely,",
  "Dana Reyes",
];

const CLEAN_SUMMARY = "Payments engineer with seven years on billing and ledger systems at Lumen Health and Brightline. Rebuilt reconciliation in Go, cut its runtime from 50 minutes to 7, and ran on-call for money-moving services.";

const CLEAN_BULLETS = [
  { text: "Rebuilt the ledger reconciliation job in Go, cutting runtime from 50 minutes to 7.", current: false },
  { text: "Led the response to a double-billing incident and refunded 1,140 patients within six hours.", current: false },
  { text: "Own the on-call rotation for four payment services and review every postmortem.", current: true },
];

const CLEAN_ANSWERS = [
  "I want to work on payments because mistakes there are expensive and visible. At Lumen Health I owned the billing service for three years, including the night it double-charged 1,140 patients.",
  "Yes. I can start on November 3 and I am open to relocating to Denver.",
];

const SLOPPY_LETTER = [
  "I am writing to express my interest in the Senior Product Manager role at Acme. As a results-driven professional with over 8 years of experience, I am thrilled to apply!",
  "In today's fast-paced digital landscape, I have leveraged my unique blend of strategic, analytical, and collaborative skills to spearhead transformative initiatives. It's not just about shipping features — it's about driving impactful results. I am passionate about building seamless, cutting-edge experiences.",
  "Furthermore, I have honed my ability to navigate the complexities of cross-functional teams. What makes a great product leader? The answer is simple: empathy. Studies show that empathetic leaders foster a culture of innovation. Why does that matter? I truly believe my proven track record makes me a perfect fit.",
  "Ultimately, I am confident that I would be a valuable asset to your dynamic team. I look forward to discussing how my skills can contribute to your success.",
];

function lint(input: WritingLintInput): WritingLintReport {
  return lintApplicationWriting(input);
}

function answer(text: string, extra: Omit<WritingLintInput, "answers"> = {}): WritingLintReport {
  return lint({ ...extra, answers: [text] });
}

function codesOf(report: WritingLintReport, severity?: WritingLintSeverity): string[] {
  return [...new Set(
    report.issues.filter((issue) => !severity || issue.severity === severity).map((issue) => issue.code),
  )];
}

function withCode(report: WritingLintReport, code: string): WritingLintIssue[] {
  return report.issues.filter((issue) => issue.code === code);
}

function gating(report: WritingLintReport): WritingLintIssue[] {
  return report.issues.filter((issue) => issue.severity !== "WARNING");
}

function describeIssues(report: WritingLintReport): string {
  return report.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.surface}[${issue.index}] ${issue.excerpt}`).join("\n");
}

// ---------------------------------------------------------------------------
// Report contract
// ---------------------------------------------------------------------------

test("a clean, specific human packet passes with no issues at all", () => {
  const report = lint({
    coverLetterParagraphs: CLEAN_LETTER,
    resumeSummary: CLEAN_SUMMARY,
    resumeBullets: CLEAN_BULLETS,
    answers: CLEAN_ANSWERS,
  });
  assert.equal(report.passed, true, describeIssues(report));
  assert.deepEqual(gating(report), [], describeIssues(report));
  assert.deepEqual(report.issues, [], describeIssues(report));
  assert.equal(report.release, WRITING_LINT_RELEASE);
});

test("a sloppy AI-sounding letter fails with many distinct codes", () => {
  const report = lint({ coverLetterParagraphs: SLOPPY_LETTER });
  assert.equal(report.passed, false);
  const codes = codesOf(report);
  for (const expected of [
    "CEREMONIAL_OPENING",
    "AI_CLICHE_PHRASE",
    "EXCLAMATION",
    "TRIPLET_STACK",
    "BINARY_CONTRAST",
    "FAUX_INSIGHT_SETUP",
    "WEASEL_ATTRIBUTION",
    "RHETORICAL_QUESTION",
    "SUMMARY_CLOSER",
    "TRANSITION_OPENER",
  ]) {
    assert.ok(codes.includes(expected), `missing ${expected}\n${describeIssues(report)}`);
  }
  assert.ok(withCode(report, "AI_CLICHE_PHRASE").length >= 15, describeIssues(report));
  // Two rhetorical questions in one letter escalate from WARNING to REPAIR.
  assert.ok(withCode(report, "RHETORICAL_QUESTION").every((issue) => issue.severity === "REPAIR"));
});

test("reports are deterministic, deeply frozen, sorted, and bounded", () => {
  const input: WritingLintInput = {
    coverLetterParagraphs: SLOPPY_LETTER,
    resumeBullets: [{ text: "Responsible for synergy and leveraging my network 🚀", current: false }],
    answers: ["Great question! [Company] is my dream job."],
  };
  const first = lint(input);
  const second = lint(input);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.issues), true);
  assert.equal(Object.isFrozen(first.issues[0]), true);
  assert.equal(Object.isFrozen(first.metrics), true);

  const rank = { BLOCKING: 0, REPAIR: 1, WARNING: 2 } as const;
  for (let index = 1; index < first.issues.length; index += 1) {
    assert.ok(rank[first.issues[index - 1].severity] <= rank[first.issues[index].severity]);
  }
  for (const issue of first.issues) {
    assert.ok(issue.code in WRITING_LINT_CODES, issue.code);
    assert.match(issue.code, /^[A-Z][A-Z_]+$/u);
    assert.ok(issue.excerpt.length > 0 && issue.excerpt.length <= 120, issue.excerpt);
    assert.ok(issue.message.length > 0);
    assert.ok(issue.fix.length > 0);
    assert.ok(Number.isInteger(issue.index) && issue.index >= 0);
  }
  const keys = first.issues.map((issue) => `${issue.code}|${issue.surface}|${issue.index}|${issue.excerpt.toLowerCase()}`);
  assert.equal(new Set(keys).size, keys.length, "issues are de-duplicated");
});

test("empty input passes with neutral metrics", () => {
  const report = lint({});
  assert.equal(report.passed, true);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.metrics, {
    coverLetterWords: 0,
    sentences: 0,
    sentenceLengthCv: null,
    iStartShare: null,
    emDashesPer100Words: 0,
    openingSimilarity: null,
  });
});

test("the code registry is frozen and lists one severity per code", () => {
  assert.equal(Object.isFrozen(WRITING_LINT_CODES), true);
  for (const [code, severity] of Object.entries(WRITING_LINT_CODES)) {
    assert.match(code, /^[A-Z][A-Z_]+$/u);
    assert.ok(["BLOCKING", "REPAIR", "WARNING"].includes(severity));
  }
});

// ---------------------------------------------------------------------------
// Stock vocabulary and false-positive guards
// ---------------------------------------------------------------------------

test("flags each family of stock AI and HR phrasing as REPAIR", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["Last year I leveraged Python to automate reconciliation.", "leveraged"],
    ["We found real synergy between sales and support.", "synergy"],
    ["I spearheaded the migration to Postgres.", "spearheaded"],
    ["I utilized Terraform for every environment.", "utilized"],
    ["I delved into the incident logs.", "delved"],
    ["The city is a rich tapestry of neighborhoods.", "tapestry"],
    ["Security is an ever-evolving field.", "ever-evolving"],
    ["I work well in a fast-paced environment.", "fast-paced"],
    ["I want to join a dynamic team.", "dynamic team"],
    ["I built a robust platform for claims.", "robust platform"],
    ["The rollout was seamless for customers.", "seamless"],
    ["We used cutting-edge tools.", "cutting-edge"],
    ["The lab runs state-of-the-art equipment.", "state-of-the-art"],
    ["They offer best-in-class support.", "best-in-class"],
    ["It was a world-class team.", "world-class"],
    ["The new dashboard was a game-changer.", "game-changer"],
    ["I am a results-driven engineer.", "results-driven"],
    ["I am detail-oriented with numbers.", "detail-oriented"],
    ["I am a self-starter.", "self-starter"],
    ["I have always been a team player.", "team player"],
    ["I will hit the ground running.", "hit the ground running"],
    ["At a startup I had to wear many hats.", "wear many hats"],
    ["I have a proven track record in sales.", "proven track record"],
    ["I bring a unique blend of design and code.", "unique blend"],
    ["My work sits at the intersection of health and data.", "sits at the intersection of"],
    ["Your mission aligns perfectly with my goals.", "aligns perfectly with"],
    ["Your focus on patients resonates with me.", "resonates with me"],
    ["I honed my writing at the newspaper.", "honed"],
    ["I am adept at SQL.", "adept at"],
    ["I have a keen interest in logistics.", "keen interest"],
    ["The launch was a testament to the team.", "testament to"],
    ["I learned to navigate the complexities of hospital billing.", "navigate the complexities"],
    ["In today's competitive landscape, speed matters.", "in today's competitive landscape"],
    ["Look no further for a support lead.", "look no further"],
    ["I would be a valuable asset to Northwind.", "valuable asset"],
    ["I want to make a meaningful impact on patients.", "make a meaningful impact"],
    ["My goal is to drive impactful results.", "drive impactful results"],
    ["I am confident that I can lead this team.", "I am confident that I"],
    ["I believe I would be a great fit for the role.", "would be a great fit"],
    ["This role is a perfect fit.", "perfect fit"],
    ["This is my dream job.", "dream job"],
    ["In 2019 I embarked on a new career.", "embarked"],
    ["My career journey began in retail.", "journey"],
    ["I want to elevate the support experience.", "elevate"],
    ["The tool will empower analysts.", "empower"],
    ["It was a transformative year for the team.", "transformative"],
    ["We set out to revolutionize logistics.", "revolutionize"],
    ["The rebuild will unlock new value for clinics.", "unlock new value"],
    ["We learned to harness the power of our data.", "harness"],
    ["I worked to foster a culture of ownership.", "foster"],
    ["I cultivated strong relationships with vendors.", "cultivated strong relationships"],
    ["It was an impactful project.", "impactful"],
    ["I am passionate about accessibility.", "I am passionate"],
    ["I was thrilled when we shipped.", "thrilled"],
    ["I played a pivotal role in the merger integration plan.", "played a pivotal role"],
    ["It is worth noting that the team was small.", "it is worth noting"],
  ];
  for (const [text, expected] of cases) {
    const report = answer(text);
    const found = withCode(report, "AI_CLICHE_PHRASE").map((issue) => issue.excerpt.toLowerCase());
    assert.ok(
      found.some((excerpt) => excerpt.includes(expected.toLowerCase())),
      `expected "${expected}" in: ${text}\n${describeIssues(report)}`,
    );
    assert.equal(report.passed, false, text);
    const issue = withCode(report, "AI_CLICHE_PHRASE")[0];
    assert.equal(issue.severity, "REPAIR");
    assert.match(issue.fix, /\S/u);
  }
});

test("does not flag legitimate technical, financial, medical, or proper-noun uses", () => {
  const legitimate = [
    "Modeled the leverage ratio and net leverage for six LBOs, keeping debt under 4.5x leverage.",
    "Priced a leveraged buyout financing package for a hospital group.",
    "Our negotiators gained leverage in the renewal by switching vendors.",
    "Worked alongside a landscape architect on the site plan for the clinic.",
    "Taught dynamic programming and graph search to 120 students.",
    "Used robust statistics and robust regression to handle outliers in claims data.",
    "Built a test harness for the payments API.",
    "Designed wiring harness layouts for the aircraft cabin.",
    "Volunteered with foster care families on weekends.",
    "Triaged elevated privileges alerts in the security operations center.",
    "Screened patients with elevated blood pressure at intake.",
    "Mapped the customer journey for 12 clinics.",
    "Captured $40M in cost synergies after the merger closed.",
    "Studied the synergistic effects of two antibiotics.",
    "Published GPU utilization reports every week.",
    "Shipped seamless steel pipe orders to three refineries.",
    "Honed engine cylinders to a 0.001-inch tolerance.",
    "Achieved state-of-the-art accuracy on SQuAD 2.0 with a smaller model.",
    "Ran the Revolutionary War unit for the history department.",
    "I admire how Tapestry runs its portfolio of brands.",
    "The team moved to Foster City in 2022.",
    "Our research shows that intake calls drop after 5 p.m.",
    "The data shows churn fell 12% after the change.",
    "Tools: Harness, ArgoCD, and Terraform for every service.",
  ];
  for (const text of legitimate) {
    const report = answer(text);
    assert.deepEqual(gating(report), [], `${text}\n${describeIssues(report)}`);
  }
});

test("allowTerms protect employer and product names that collide with clichés", () => {
  const text = "Harness is hiring its first reliability engineer, and I have run CI for four years.";
  assert.equal(withCode(answer(text), "AI_CLICHE_PHRASE").length, 1);
  assert.deepEqual(answer(text, { allowTerms: ["Harness"] }).issues, []);

  const dynamicYield = "I want to join Dynamic Yield to work on personalization for retailers.";
  assert.deepEqual(answer(dynamicYield).issues, []);
  assert.deepEqual(answer(dynamicYield, { allowTerms: ["Dynamic Yield"] }).issues, []);

  // The employer name is protected, but a real cliché next to it is still flagged.
  const mixed = answer("Dynamic Yield has a dynamic team.", { allowTerms: ["Dynamic Yield"] });
  assert.deepEqual(withCode(mixed, "AI_CLICHE_PHRASE").map((issue) => issue.excerpt), ["dynamic team"]);

  const exclaimed = "I supported advertisers at Yahoo! for two years.";
  assert.equal(withCode(answer(exclaimed), "EXCLAMATION").length, 1);
  assert.deepEqual(answer(exclaimed, { allowTerms: ["Yahoo!"] }).issues, []);
});

test("a cliché mirrored from the posting inside quotation marks is only a WARNING", () => {
  const report = lint({
    coverLetterParagraphs: ["You describe the team as \"fast-paced\" and I have shipped weekly releases since 2021."],
  });
  assert.equal(report.passed, true, describeIssues(report));
  assert.deepEqual(codesOf(report), ["MIRRORED_POSTING_CLICHE"]);
  assert.equal(report.issues[0].severity, "WARNING");
  assert.equal(report.issues[0].excerpt, "fast-paced");
});

test("a question inside a quoted posting phrase is not a rhetorical question", () => {
  const report = lint({
    coverLetterParagraphs: ["Your posting asks \"who owns the pager?\" and at my last job the answer was me, for three years."],
  });
  assert.deepEqual(report.issues, [], describeIssues(report));
});

// ---------------------------------------------------------------------------
// BLOCKING families
// ---------------------------------------------------------------------------

test("placeholders, model leaks, and internal metadata are BLOCKING", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["Dear [Hiring Manager Name], thanks for reading.", "PLACEHOLDER_TEXT"],
    ["I would bring this experience to [Company].", "PLACEHOLDER_TEXT"],
    ["Welcome to {{company}} onboarding.", "PLACEHOLDER_TEXT"],
    ["Please see <insert portfolio link> for samples.", "PLACEHOLDER_TEXT"],
    ["My start date is TBD.", "PLACEHOLDER_TEXT"],
    ["Lorem ipsum dolor sit amet.", "PLACEHOLDER_TEXT"],
    ["Regards, Your Name", "PLACEHOLDER_TEXT"],
    ["I grew revenue by XX% in two quarters.", "PLACEHOLDER_TEXT"],
    ["As an AI language model, I can help with that.", "MODEL_LEAK"],
    ["I cannot assist with that request.", "MODEL_LEAK"],
    ["Here is a revised version of your answer.", "MODEL_LEAK"],
    ["I hope this helps with your application.", "MODEL_LEAK"],
    ["This is supported by evidenceVersionId 42.", "INTERNAL_METADATA_LEAK"],
    ["I rebuilt the ledger [claim: abc-123].", "INTERNAL_METADATA_LEAK"],
    ["The claimId field was set by the drafting step.", "INTERNAL_METADATA_LEAK"],
  ];
  for (const [text, code] of cases) {
    const report = answer(text);
    const found = withCode(report, code);
    assert.ok(found.length >= 1, `${code} expected for: ${text}\n${describeIssues(report)}`);
    assert.equal(found[0].severity, "BLOCKING");
    assert.equal(report.passed, false);
  }
  assert.equal(withCode(answer("Welcome to {{company}} onboarding."), "PLACEHOLDER_TEXT").length, 1);
  assert.equal(withCode(answer("Dear [Hiring Manager Name], thanks."), "PLACEHOLDER_TEXT").length, 1);
});

test("leak and placeholder rules leave legitimate text alone", () => {
  for (const text of [
    "As an AI engineer at Scale, I shipped evaluation tooling for three model launches.",
    "I cannot start before March 3 because of a notice period.",
    "Cleaned NaN values in pandas before training the churn model.",
    "The quote keeps [sic] because the original report misspelled it.",
    "Dear Hiring Manager, I rebuilt the ledger in Go.",
  ]) {
    const report = answer(text);
    assert.deepEqual(gating(report), [], `${text}\n${describeIssues(report)}`);
  }
});

test("markdown artifacts are BLOCKING in letters, while answers may use lists", () => {
  const report = lint({
    coverLetterParagraphs: [
      "**Impact:** I rebuilt the ledger in Go.",
      "## Why Northwind",
      "I shipped three things:\n- a new ledger\n- a runbook",
      "See [my portfolio](https://example.com/work) for samples.",
    ],
  });
  const markdown = withCode(report, "MARKDOWN_ARTIFACT");
  assert.deepEqual([...new Set(markdown.map((issue) => issue.index))], [0, 1, 2, 3], describeIssues(report));
  assert.ok(markdown.every((issue) => issue.severity === "BLOCKING"));

  const list = answer("Three things I would do first:\n- read the incident log\n- meet the on-call team\n- fix the flakiest alert");
  assert.deepEqual(list.issues, [], describeIssues(list));
});

test("emoji and hashtags are BLOCKING; C#, #1, and trademark signs are not", () => {
  const rocket = String.fromCodePoint(0x1f680);
  const report = answer(`Shipped the launch on time ${rocket} #blessed`);
  const issues = withCode(report, "EMOJI_OR_HASHTAG");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "BLOCKING");
  assert.equal(issues[0].excerpt, `${rocket} #blessed`);
  assert.deepEqual(answer("Wrote C# and F# services, ranked #1 in the region, and shipped Widget™ for Acme®.").issues, []);
});

test("broken text is BLOCKING: doubled words, doubled punctuation, mis-encoding, and empty items", () => {
  assert.deepEqual(codesOf(answer("The the migration finished early.")), ["BROKEN_TEXT"]);
  assert.deepEqual(codesOf(answer("The migration finished early.. Then we moved on.")), ["BROKEN_TEXT"]);
  assert.deepEqual(codesOf(answer(`We shipped the ${String.fromCodePoint(0xfffd)} fix in May.`)), ["BROKEN_TEXT"]);
  const empty = lint({ coverLetterParagraphs: ["I rebuilt the ledger in Go.", "   "], answers: [""] });
  assert.deepEqual(
    withCode(empty, "BROKEN_TEXT").map((issue) => [issue.surface, issue.index]),
    [["COVER_LETTER", 1], ["ANSWER", 0]],
  );
  assert.deepEqual(answer("I grew up in Walla Walla, and the plan we had had two phases.").issues, []);
});

test("fabricated quotes and invented dialogue are BLOCKING unless the phrase is allowed", () => {
  const phrase = "you will own production incidents from page to postmortem";
  const long = `The posting says "${phrase}" and I have done that for years.`;
  const flagged = withCode(lint({ coverLetterParagraphs: [long] }), "FABRICATED_QUOTE");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].severity, "BLOCKING");
  assert.deepEqual(withCode(lint({ coverLetterParagraphs: [long], allowTerms: [phrase] }), "FABRICATED_QUOTE"), []);

  const told = lint({ coverLetterParagraphs: ["My manager once told me, \"You make hard things boring.\" I still think about it."] });
  assert.equal(withCode(told, "FABRICATED_QUOTE").length, 1);
  assert.equal(withCode(answer("“Ship it,” my mentor said, and we did."), "FABRICATED_QUOTE").length, 1);
  assert.deepEqual(answer("Your posting mentions \"boring technology\" and I agree with that choice.").issues, []);
});

// ---------------------------------------------------------------------------
// Openings and structural tells
// ---------------------------------------------------------------------------

test("ceremonial openers are REPAIR; soft openers and dated salutations only warn", () => {
  const openers = [
    "I am writing to apply for the Platform Engineer role.",
    "I'm excited to apply for the Platform Engineer role.",
    "Please accept this letter as my application.",
    "My name is Dana Reyes and I build payment systems.",
    "As a seasoned engineer with 10+ years of experience, I build payment systems.",
    "With over eight years of experience in payments, I know ledgers.",
    "I would like to express my interest in the Platform Engineer role.",
    "It is with great enthusiasm that I submit my application.",
  ];
  for (const opener of openers) {
    const report = lint({ coverLetterParagraphs: ["Dear Ms. Patel,", `${opener} I rebuilt our ledger in Go last year.`] });
    const issues = withCode(report, "CEREMONIAL_OPENING");
    assert.equal(issues.length, 1, `${opener}\n${describeIssues(report)}`);
    assert.equal(issues[0].severity, "REPAIR");
    assert.equal(issues[0].index, 1);
  }

  const soft = lint({ coverLetterParagraphs: ["When I saw your posting, I recognized the ledger problem you describe. I rebuilt ours last year."] });
  assert.deepEqual(withCode(soft, "CEREMONIAL_OPENING").map((issue) => issue.severity), ["WARNING"]);
  assert.equal(soft.passed, true);

  const dated = lint({ coverLetterParagraphs: ["To whom it may concern,", "I rebuilt our ledger in Go last year."] });
  assert.deepEqual(withCode(dated, "CEREMONIAL_OPENING").map((issue) => [issue.severity, issue.index]), [["WARNING", 0]]);

  const later = lint({ coverLetterParagraphs: ["I rebuilt our ledger in Go last year. I am writing to explain why that matters here."] });
  assert.deepEqual(withCode(later, "CEREMONIAL_OPENING"), []);
  assert.equal(withCode(later, "AI_CLICHE_PHRASE").length, 1);
});

test("binary contrast framing is REPAIR", () => {
  for (const text of [
    "It's not just a job, but a calling for me.",
    "It's not about the code — it's about the people who run it.",
    "The job isn't glamorous; it's necessary.",
    "Leadership is less about answers and more about questions.",
    "The tool not only cut costs but also reduced errors.",
  ]) {
    const report = answer(text);
    assert.equal(withCode(report, "BINARY_CONTRAST").length, 1, `${text}\n${describeIssues(report)}`);
    assert.equal(withCode(report, "BINARY_CONTRAST")[0].severity, "REPAIR");
  }
  assert.deepEqual(answer("The migration wasn't easy, but it was worth the nine weeks, and it is done.").issues, []);
});

test("faux-insight setups are REPAIR and their question marks are not double-counted", () => {
  const report = answer("Here's the thing: most outages start with a config change. The result? Fewer pages. The answer is simple: smaller deploys.");
  assert.equal(withCode(report, "FAUX_INSIGHT_SETUP").length, 3, describeIssues(report));
  assert.deepEqual(withCode(report, "RHETORICAL_QUESTION"), []);
  assert.deepEqual(answer("The result was a 40% drop in pages.").issues, []);
});

test("one rhetorical question warns; two or more require repair", () => {
  const one = lint({ coverLetterParagraphs: ["Why payments? Because mistakes there are expensive and visible, and I like that pressure."] });
  assert.deepEqual(withCode(one, "RHETORICAL_QUESTION").map((issue) => issue.severity), ["WARNING"]);
  assert.equal(one.passed, true);
  const two = lint({ coverLetterParagraphs: ["Why payments? Because mistakes are expensive.", "What would I do first? Read the incident log."] });
  assert.deepEqual(
    withCode(two, "RHETORICAL_QUESTION").map((issue) => [issue.severity, issue.index]),
    [["REPAIR", 0], ["REPAIR", 1]],
  );
});

test("exclamations and summary closers are REPAIR; transition openers warn", () => {
  const report = lint({
    coverLetterParagraphs: [
      "I rebuilt the ledger in nine weeks!",
      "Moreover, the on-call load fell by a third after the rebuild.",
      "In conclusion, reliability work is where I do my best work.",
      "At the end of the day, the pager stayed quiet.",
      "That's the kind of ownership I would bring to Northwind.",
      "Ultimately, I want to work where money moves.",
    ],
  });
  assert.equal(withCode(report, "EXCLAMATION").length, 1);
  assert.equal(withCode(report, "EXCLAMATION")[0].severity, "REPAIR");
  assert.deepEqual(withCode(report, "TRANSITION_OPENER").map((issue) => [issue.severity, issue.excerpt]), [["WARNING", "Moreover"]]);
  assert.deepEqual(withCode(report, "SUMMARY_CLOSER").map((issue) => issue.index), [2, 3, 4, 5], describeIssues(report));
  assert.ok(withCode(report, "SUMMARY_CLOSER").every((issue) => issue.severity === "REPAIR"));
});

test("stacked abstract triplets are REPAIR; concrete lists and fixed terms are not", () => {
  for (const text of [
    "I am innovative, strategic, and collaborative.",
    "I bring clarity, empathy, and rigor to reviews.",
    "We value reliability, scalability, and security.",
  ]) {
    assert.equal(withCode(answer(text), "TRIPLET_STACK").length, 1, text);
  }
  for (const text of [
    "I write Python, Go, and Rust.",
    "I led diversity, equity, and inclusion training for 40 managers.",
    "We traded off speed, quality, and cost on every release.",
    "I managed planning, design, and construction for two clinics.",
  ]) {
    assert.deepEqual(withCode(answer(text), "TRIPLET_STACK"), [], text);
  }
});

test("dash density above one per 90 words is REPAIR; a dramatic dash payoff warns", () => {
  const dense = lint({
    coverLetterParagraphs: ["The rebuild — nine weeks of work — moved the ledger to Go. The runbook -- which I wrote -- is still in use. The pager – once loud – is quiet now."],
  });
  const density = withCode(dense, "EM_DASH_DENSITY");
  assert.equal(density.length, 1);
  assert.equal(density[0].severity, "REPAIR");
  assert.equal(dense.metrics.emDashesPer100Words, 22.22);
  assert.deepEqual(withCode(dense, "DRAMATIC_DASH_PAYOFF"), [], "paired dashes are parenthetical, not a payoff");

  const payoff = lint({ coverLetterParagraphs: ["We spent nine weeks rebuilding the ledger — and it worked. The team shipped it in March after a long review."] });
  assert.deepEqual(withCode(payoff, "DRAMATIC_DASH_PAYOFF").map((issue) => issue.severity), ["WARNING"]);
  assert.deepEqual(withCode(payoff, "EM_DASH_DENSITY"), []);
  assert.equal(payoff.passed, true);
  assert.deepEqual(answer("The 2019–2021 contract ran from pages 3 – 5 of the appendix.").issues, []);
});

// ---------------------------------------------------------------------------
// Letter metrics and cadence
// ---------------------------------------------------------------------------

test("metrics describe the cover letter body and skip the salutation and signature", () => {
  const report = lint({
    coverLetterParagraphs: ["Dear Ms. Patel,", "I rebuilt the ledger. It took nine weeks — longer than planned.", "The team shipped it in March.", "Sincerely,", "Dana"],
    recentOpenings: ["I rebuilt the billing ledger."],
  });
  assert.deepEqual(report.metrics, {
    coverLetterWords: 22,
    sentences: 3,
    sentenceLengthCv: 0.22,
    iStartShare: 0.333,
    emDashesPer100Words: 4.55,
    openingSimilarity: 0.8,
  });
  assert.deepEqual(codesOf(report).sort(), ["DRAMATIC_DASH_PAYOFF", "OPENING_REUSE"]);
});

test("uniform sentence lengths and I-heavy letters are flagged", () => {
  const uniform = lint({
    coverLetterParagraphs: [
      "I led the billing team for four years. I rebuilt the ledger service in Go. I cut the batch runtime by half.",
      "I hired three engineers for the team. I wrote the incident runbook myself. I ran the weekly review with ops.",
    ],
  });
  assert.equal(uniform.metrics.sentences, 6);
  assert.equal(uniform.metrics.sentenceLengthCv, 0.082);
  assert.equal(uniform.metrics.iStartShare, 1);
  assert.deepEqual(withCode(uniform, "SENTENCE_UNIFORMITY").map((issue) => issue.severity), ["REPAIR"]);
  assert.deepEqual(withCode(uniform, "I_START_OVERUSE").map((issue) => issue.severity), ["REPAIR"]);

  const mild = lint({
    coverLetterParagraphs: [
      "The ledger team shipped four releases in the first quarter. Each release cut reconciliation time a bit. By June the nightly batch finished before the clinics opened on the coast.",
      "Support tickets about duplicate charges dropped to almost zero. The finance team stopped reconciling accounts by hand at month end. Nobody on call was paged that entire summer.",
    ],
  });
  assert.equal(mild.metrics.sentenceLengthCv, 0.204);
  assert.deepEqual(withCode(mild, "SENTENCE_UNIFORMITY").map((issue) => issue.severity), ["WARNING"]);
  assert.equal(mild.passed, true, describeIssues(mild));

  const everyParagraph = lint({
    coverLetterParagraphs: [
      "I rebuilt the ledger in Go. The batch now finishes in seven minutes. Finance closes the books two days sooner.",
      "I hired three engineers last year. Two of them now lead projects. One runs the on-call rotation.",
      "I would enjoy talking about your ledger migration. Your posting says it starts in January. That timing works well for me.",
    ],
  });
  assert.equal(everyParagraph.metrics.iStartShare, 0.333);
  const overuse = withCode(everyParagraph, "I_START_OVERUSE");
  assert.equal(overuse.length, 1);
  assert.equal(overuse[0].excerpt, "every paragraph starts with \"I\"");
});

test("intensifier pileups warn; technical 'highly available' does not count", () => {
  const pileup = answer("I am truly grateful for the chance, deeply curious about ledgers, and incredibly focused on reliability.");
  assert.deepEqual(withCode(pileup, "INTENSIFIER_PILEUP").map((issue) => [issue.severity, issue.excerpt]), [["WARNING", "truly, deeply, incredibly"]]);
  assert.equal(pileup.passed, true);
  assert.deepEqual(answer("We run highly available services, and I am truly glad to be deeply involved.").issues, []);
});

test("hedge filler warns while unattributed claims require repair", () => {
  const hedges = answer("I have worked on various projects across numerous teams.");
  assert.deepEqual(withCode(hedges, "HEDGE_FILLER").map((issue) => issue.excerpt), ["various", "numerous"]);
  assert.equal(hedges.passed, true);
  for (const text of ["Studies show that most outages start with a change.", "Many experts believe that on-call is broken."]) {
    const report = answer(text);
    assert.deepEqual(withCode(report, "WEASEL_ATTRIBUTION").map((issue) => issue.severity), ["REPAIR"], text);
  }
});

// ---------------------------------------------------------------------------
// Résumé surfaces
// ---------------------------------------------------------------------------

test("résumé bullets: pronouns, weak openers, tense by role, verbs, length, punctuation, openers, buzzwords", () => {
  const report = lint({
    resumeBullets: [
      { text: "Led migration of 14 billing services to Kubernetes, cutting deploy time from 40 to 6 minutes.", current: false },
      { text: "Lead a team of six engineers that owns the payments ledger and reconciliation jobs", current: true },
      { text: "Lead weekly incident reviews for the payments org and track follow-ups to closure.", current: false },
      { text: "Responsible for managing vendor relationships across three regions and two currencies.", current: false },
      { text: "Helped the team ship stuff.", current: false },
      { text: "My team and I rebuilt the on-call rotation, reducing pages by 38% in one quarter.", current: false },
      { text: "Ran Phase I clinical trial logistics for 220 patients and processed I-9 forms for 40 hires.", current: false },
      { text: "Successfully launched a self-serve refund tool that handled 12,000 requests per month.", current: false },
      { text: "Spearheaded cross-functional synergy to drive impactful results across the organization.", current: false },
      { text: "- Built dashboards in Looker that finance used to close the books two days faster.", current: false },
      { text: "Leading the design of a new fraud model that flags risky transfers before settlement.", current: true },
      { text: "Led quarterly planning for 3 product lines with 25 engineers and a $4M budget.", current: false },
      { text: "Led the vendor security review program, closing 90 findings in two quarters.", current: false },
      { text: "Profiled disk I/O on the ledger hosts and cut p99 write latency by half.", current: false },
    ],
  });
  const indexes = (code: string) => withCode(report, code).map((issue) => issue.index);
  assert.deepEqual(indexes("FIRST_PERSON_IN_BULLET"), [5], describeIssues(report));
  assert.equal(withCode(report, "FIRST_PERSON_IN_BULLET")[0].severity, "BLOCKING");
  assert.match(withCode(report, "FIRST_PERSON_IN_BULLET")[0].message, /My, I/u);
  assert.deepEqual(indexes("MARKDOWN_ARTIFACT"), [9]);
  assert.deepEqual(lint({ resumeBullets: [{ text: "- Leveraged Kafka to cut settlement lag from 9 hours to 40 minutes.", current: false }] }).issues.map((issue) => issue.code).sort(), ["AI_CLICHE_PHRASE", "MARKDOWN_ARTIFACT"]);
  assert.deepEqual(withCode(report, "WEAK_BULLET_OPENER").map((issue) => [issue.index, issue.excerpt]), [[3, "Responsible for"], [4, "Helped"]]);
  assert.deepEqual(withCode(report, "BULLET_TENSE_MISMATCH").map((issue) => [issue.index, issue.excerpt]), [[2, "Lead"]]);
  assert.deepEqual(withCode(report, "BULLET_NOT_ACTION_VERB").map((issue) => [issue.index, issue.excerpt]), [[5, "My"], [7, "Successfully launched"], [10, "Leading"]]);
  assert.deepEqual(indexes("BULLET_LENGTH"), [4]);
  assert.deepEqual(withCode(report, "BUZZWORD_SOUP").map((issue) => [issue.index, issue.severity]), [[8, "REPAIR"]]);
  assert.deepEqual(withCode(report, "BULLET_PUNCTUATION_INCONSISTENT").map((issue) => [issue.index, issue.excerpt]), [[1, "13 of 14 bullets end with a period"]]);
  assert.deepEqual(withCode(report, "BULLET_REPEATED_OPENER").map((issue) => [issue.index, issue.excerpt]), [[12, "led"]]);
  for (const clean of [0, 6, 13]) {
    assert.deepEqual(report.issues.filter((issue) => issue.index === clean), [], `bullet ${clean}`);
  }
});

test("present tense is accepted only for current roles", () => {
  const text = "Build the payments ledger and review every reconciliation change before release.";
  assert.deepEqual(lint({ resumeBullets: [{ text, current: true }] }).issues, []);
  assert.deepEqual(
    codesOf(lint({ resumeBullets: [{ text, current: false }] })),
    ["BULLET_TENSE_MISMATCH"],
  );
});

test("the résumé summary gets phrase, triplet, and placeholder checks", () => {
  const report = lint({ resumeSummary: "Results-driven, innovative, and collaborative leader with a proven track record at [Company]." });
  assert.equal(report.passed, false);
  assert.ok(report.issues.every((issue) => issue.surface === "RESUME_SUMMARY" && issue.index === 0));
  assert.deepEqual(codesOf(report).sort(), ["AI_CLICHE_PHRASE", "PLACEHOLDER_TEXT", "TRIPLET_STACK"]);
});

// ---------------------------------------------------------------------------
// Candidate history and preferences
// ---------------------------------------------------------------------------

test("opening reuse is REPAIR by token similarity or identical first six words", () => {
  const similar = lint({
    coverLetterParagraphs: ["Hospitals lose money every time a claim bounces back unpaid."],
    recentOpenings: ["Hospitals lose money when a claim bounces back unpaid.", "Something else entirely."],
  });
  assert.equal(similar.metrics.openingSimilarity, 0.727);
  assert.deepEqual(withCode(similar, "OPENING_REUSE").map((issue) => issue.severity), ["REPAIR"]);

  const prefix = lint({
    coverLetterParagraphs: ["I have spent six years building payment systems at Stripe, mostly on reconciliation."],
    recentOpenings: ["Dear team, I have spent four years building data pipelines at Airbnb."],
  });
  assert.ok((prefix.metrics.openingSimilarity ?? 1) < 0.55);
  assert.match(withCode(prefix, "OPENING_REUSE")[0]?.message ?? "", /first six words/u);

  const fresh = lint({
    coverLetterParagraphs: ["Your ledger migration is a project I have done twice."],
    recentOpenings: ["Hospitals lose money when a claim bounces back unpaid."],
  });
  assert.ok(fresh.metrics.openingSimilarity !== null && fresh.metrics.openingSimilarity < 0.1);
  assert.deepEqual(fresh.issues, []);

  const tooOld = lint({
    coverLetterParagraphs: ["Hospitals lose money every time a claim bounces back unpaid."],
    recentOpenings: [...Array.from({ length: 10 }, (_, index) => `Unrelated opening number ${index} about gardens.`), "Hospitals lose money when a claim bounces back unpaid."],
  });
  assert.deepEqual(withCode(tooOld, "OPENING_REUSE"), [], "only the ten newest openings count");
  assert.equal(lint({ coverLetterParagraphs: ["Hospitals lose money."] }).metrics.openingSimilarity, null);
});

test("candidate-banned phrases are REPAIR, case-insensitive, boundary-aware, and yield to allowTerms", () => {
  const report = lint({
    coverLetterParagraphs: ["The Rockstar engineers I admire write boring code, and they avoid game-changer language."],
    candidateBannedPhrases: ["rockstar", "  ", "ROCKSTAR", "boring code", "game changer", "rock"],
  });
  const banned = withCode(report, "CANDIDATE_BANNED_PHRASE");
  assert.deepEqual(banned.map((issue) => issue.excerpt), ["Rockstar", "boring code", "game-changer"], describeIssues(report));
  assert.ok(banned.every((issue) => issue.severity === "REPAIR"));
  assert.deepEqual(withCode(report, "AI_CLICHE_PHRASE"), [], "a banned span is not double-reported");

  const allowed = lint({
    answers: ["I would love to work on Rockstar's build tooling."],
    candidateBannedPhrases: ["rockstar"],
    allowTerms: ["Rockstar"],
  });
  assert.deepEqual(allowed.issues, []);
});

test("answers: chatbot preambles are REPAIR, model leaks are BLOCKING, plain yes-answers pass", () => {
  for (const text of [
    "Great question! I have led incident response for four years.",
    "Certainly. I moved our billing jobs to Temporal in 2023.",
    "Thanks for asking. I moved our billing jobs to Temporal in 2023.",
    "That's a good question. I moved our billing jobs to Temporal in 2023.",
  ]) {
    const issues = withCode(answer(text), "ANSWER_PREAMBLE");
    assert.equal(issues.length, 1, text);
    assert.equal(issues[0].severity, "REPAIR");
  }
  const leak = answer("As an AI, I don't have personal experiences, but here is a sample answer.");
  assert.deepEqual(withCode(leak, "MODEL_LEAK").map((issue) => issue.severity), ["BLOCKING"]);
  assert.deepEqual(answer("Absolutely. I can relocate to Denver by June.").issues, []);
});

// ---------------------------------------------------------------------------
// Repair brief and performance
// ---------------------------------------------------------------------------

test("the repair brief groups identical fixes, orders by severity, and stays within 25 lines", () => {
  const report = lint({
    coverLetterParagraphs: ["I leveraged Kafka to rebuild billing. Later I leveraged Go for the ledger."],
    resumeBullets: [
      { text: "Leveraged Terraform to cut provisioning time from 2 days to 20 minutes.", current: false },
      { text: "Rebuilt the [Company] ledger in Go, cutting runtime by 86% in one quarter.", current: false },
    ],
    answers: ["I work across various teams and it was great!"],
  });
  const brief = writingLintRepairBrief(report);
  const lines = brief.split("\n");
  assert.ok(lines.length <= 25);
  assert.match(lines[0], /^Writing repair brief \(roledawn-writing-lint\/1\): 1 blocking, \d+ repair, \d+ optional\.$/u);
  const leverage = lines.filter((line) => line.includes("'leveraged'"));
  assert.equal(leverage.length, 1, brief);
  assert.match(leverage[0], /letter ¶1, bullet 1: "leveraged"\)$/u);
  const firstBlocking = lines.findIndex((line) => line.startsWith("- [BLOCKING]"));
  const firstRepair = lines.findIndex((line) => line.startsWith("- [REPAIR]"));
  const firstOptional = lines.findIndex((line) => line.startsWith("- [OPTIONAL]"));
  assert.ok(firstBlocking > 0 && firstBlocking < firstRepair && firstRepair < firstOptional, brief);
  assert.equal(new Set(lines).size, lines.length, "no duplicate lines");

  assert.equal(
    writingLintRepairBrief(lint({ answers: CLEAN_ANSWERS })),
    "Writing lint (roledawn-writing-lint/1): no issues; no rewrite needed.",
  );
});

test("the repair brief truncates to 25 lines with an overflow note", () => {
  const phrases = [
    "leveraged", "spearheaded", "utilized", "delved", "tapestry", "ever-evolving", "fast-paced", "seamless",
    "cutting-edge", "world-class", "game-changer", "results-driven", "self-starter", "team player", "honed",
    "impactful", "transformative", "embarked", "empower", "perfect fit", "dream job", "proven track record",
    "look no further", "wear many hats", "unique blend",
  ];
  const report = lint({ answers: phrases.map((phrase) => `The note mentioned ${phrase} once.`) });
  const lines = writingLintRepairBrief(report).split("\n");
  assert.equal(lines.length, 25);
  assert.match(lines[24], /^- \(\+\d+ lower-priority fixes omitted; rerun the linter after this pass\.\)$/u);
});

test("lints a 400-word letter in well under 5 ms once warm", () => {
  const paragraph = [CLEAN_LETTER[1], CLEAN_LETTER[2], CLEAN_LETTER[3]].join(" ");
  const letter = [CLEAN_LETTER[0], paragraph, paragraph, paragraph, CLEAN_LETTER[4], CLEAN_LETTER[5], CLEAN_LETTER[6]];
  const input: WritingLintInput = {
    coverLetterParagraphs: letter,
    recentOpenings: ["I have spent six years building payment systems."],
    candidateBannedPhrases: ["rockstar", "synergy"],
    allowTerms: ["Northwind", "Payments Reliability Engineer"],
  };
  const words = letter.join(" ").split(/\s+/u).length;
  assert.ok(words >= 300 && words <= 450, `fixture has ${words} words`);
  for (let run = 0; run < 20; run += 1) lintApplicationWriting(input);
  // The fastest of several batches measures the linter, not other test files
  // competing for the CPU in the parallel runner.
  const batches = Array.from({ length: 5 }, () => {
    const started = performance.now();
    for (let run = 0; run < 10; run += 1) lintApplicationWriting(input);
    return (performance.now() - started) / 10;
  });
  const average = Math.min(...batches);
  assert.ok(average < 5, `average ${average.toFixed(3)} ms`);
});

test("identifiers are not first-person pronouns and link labels are not placeholders", () => {
  const bullets = lint({
    resumeBullets: [{ text: "Moved 40 services to us-east-1 and cut I/O wait on my-service hosts by half.", current: false }],
  });
  assert.deepEqual(bullets.issues, [], describeIssues(bullets));
  const link = answer("See [project demo](https://example.com/demo) for the walkthrough.");
  assert.deepEqual(codesOf(link), ["MARKDOWN_ARTIFACT"]);
});

test("oversized or pathological input is capped, reported, and linted quickly", () => {
  const flood = "leverage synergy honed ".repeat(10_000);
  const started = performance.now();
  const report = lint({
    coverLetterParagraphs: [flood, "[x ".repeat(10_000), "**bold** ".repeat(3_000), "[".repeat(40_000)],
    answers: ["why? ".repeat(20_000)],
  });
  assert.ok(performance.now() - started < 1_000, "pathological input must not backtrack");
  const capped = withCode(report, "BROKEN_TEXT").filter((issue) => issue.excerpt.endsWith("characters"));
  assert.deepEqual(capped.map((issue) => [issue.surface, issue.index]), [["COVER_LETTER", 0], ["COVER_LETTER", 1], ["COVER_LETTER", 2], ["ANSWER", 0]]);
  assert.ok(withCode(report, "BROKEN_TEXT").some((issue) => issue.index === 3), "a symbol-only paragraph is reported as empty");
  assert.equal(report.passed, false);
});

// ---------------------------------------------------------------------------
// Self-undercutting and repeated phrases (from a real 2026-09-28 draft)
// ---------------------------------------------------------------------------

test("flags lines that talk the candidate down", () => {
  const letter = lint({ coverLetterParagraphs: [
    "My AI adoption experience is practical. That is adjacent to, rather than the same as, the governed agentic software delivery GitLab describes. Likewise, my shipped platform uses Swift and JavaScript rather than the Ruby on Rails or Go experience you request. I would not present it as equivalent to Staff-level work in GitLab's product codebase.",
  ] });
  assert.ok(withCode(letter, "SELF_UNDERCUT").length >= 3, describeIssues(letter));
  const reply = answer("Those experiences provide a bridge to customer-facing engineering. My evidence is adjacent to this role's Staff-level product contribution, not a claim that I have already done that same work.");
  assert.ok(withCode(reply, "SELF_UNDERCUT").length >= 1, describeIssues(reply));
  const lack = answer("While I haven't used Go in production, I have shipped three services in TypeScript.");
  assert.equal(withCode(lack, "SELF_UNDERCUT").length, 1, describeIssues(lack));
});

test("does not flag ordinary contrasts or places", () => {
  const report = lint({ coverLetterParagraphs: [
    "The clinic is adjacent to the county hospital, so transfers happened daily. Scheduling nurses was harder than scheduling drivers, and I built the dispatch board that fixed it.",
    "GitLab connects customer problems to direct product work rather than stopping at recommendations.",
  ] });
  assert.equal(withCode(report, "SELF_UNDERCUT").length, 0, describeIssues(report));
});

test("flags a phrase repeated across three résumé lines but not listed tools", () => {
  const report = lint({
    resumeSummary: "Extended that operator-led approach into a Twilio review tool that sent about 5,000 messages in one day.",
    resumeBullets: [
      { text: "Mapped staffing workflows with intake coordinators, applying an operator-led approach to scheduling.", current: true },
      { text: "Automated Indeed outreach to keep recruiting active beyond office hours, extending the operator-led approach.", current: true },
      { text: "Built a clinician app backed by Supabase and PostgreSQL.", current: true },
      { text: "Built an admin dashboard backed by Supabase and PostgreSQL.", current: true },
      { text: "Moved reporting to Supabase and PostgreSQL views.", current: true },
    ],
    allowTerms: ["Supabase", "PostgreSQL"],
  });
  const repeated = withCode(report, "REPEATED_PHRASE");
  assert.equal(repeated.length, 1, describeIssues(report));
  assert.equal(repeated[0]?.excerpt, "operator-led approach");
});

test("talking the candidate down is caught even when the sentence names the employer", () => {
  const talkDown = [
    "That is adjacent to, rather than the same as, the governed agentic software delivery GitLab describes.",
    "The relevant bridge is hands-on workflow discovery; I would not present it as equivalent to Staff-level work in GitLab’s product codebase.",
    "My background is not a direct match for the Staff title at GitLab, but the discovery work transfers.",
  ];
  for (const sentence of talkDown) {
    const report = lintApplicationWriting({ coverLetterParagraphs: [sentence], allowTerms: ["GitLab", "Staff Forward Deployed Engineer"] });
    assert.equal(report.issues.some((issue) => issue.code === "SELF_UNDERCUT"), true, sentence);
  }
  // The employer's own name is still never flagged on its own.
  const plain = lintApplicationWriting({ coverLetterParagraphs: ["GitLab’s customers ship through one pipeline, and I built the dashboard that routed 600 clinicians."], allowTerms: ["GitLab"] });
  assert.equal(plain.issues.some((issue) => issue.code === "SELF_UNDERCUT"), false);
});

