import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";

import {
  coverLetterPlainText,
  resumePlainText,
  type CoverLetterDocumentModel,
  type ResumeDocumentModel,
  type ResumeExperienceEntry,
} from "../../domain/application-documents.ts";
import { DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE } from "../resume/extract-resume.ts";
import {
  APPLICATION_DOCUMENT_RENDERER_RELEASE,
  renderApplicationPdf,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
  renderResumeDocx,
  renderResumePdf,
  verifyRenderedText,
} from "./application-document-renderer.ts";

const CONTACT = {
  location: "Boston, MA",
  email: "jordan.rivera@example.com",
  phone: "(617) 555-0142",
  linkedinUrl: "https://www.linkedin.com/in/jordanrivera",
  websiteUrl: "https://jordanrivera.dev",
} as const;

function typicalResume(overrides: Partial<ResumeDocumentModel> = {}): ResumeDocumentModel {
  return {
    release: "application-documents/1",
    name: "Jordan Rivera",
    headline: "Senior Product Manager · Healthcare Workflow Platforms",
    contact: CONTACT,
    summary: "Product manager with nine years building scheduling, staffing, and revenue-cycle software for hospitals and home-health agencies. I turn messy operational workflows into products clinicians adopt.",
    sections: [
      {
        kind: "EXPERIENCE",
        heading: "Experience",
        entries: [
          {
            title: "Senior Product Manager",
            organization: "Northwind Health",
            location: "Boston, MA",
            dates: "Mar 2022 – Present",
            context: "Clinical operations platform; three squads, 22 engineers",
            bullets: [
              "Led the rebuild of the nurse staffing workflow across 41 hospitals, cutting schedule publication from 9 days to 2 and reducing agency spend by $4.1M.",
              "Defined the shift-swap marketplace MVP from 60 nurse interviews; 68% of eligible nurses used it within one quarter.",
              "Partnered with compliance to ship audit-ready credential tracking, closing three Joint Commission findings ahead of the next survey.",
              "Coached two associate product managers through their first launches; both were promoted within 18 months.",
            ],
          },
          {
            title: "Product Manager",
            organization: "Cedarline Home Health",
            location: "Cambridge, MA",
            dates: "Jun 2019 – Feb 2022",
            context: null,
            bullets: [
              "Launched offline visit documentation for field clinicians, lifting on-time note completion from 71% to 94%.",
              "Cut claim denials 23% by moving eligibility checks into patient intake instead of billing.",
              "Negotiated EVV integration scope with three state Medicaid vendors and shipped a month before the regulatory deadline.",
            ],
          },
          {
            title: "Associate Product Manager",
            organization: "Brightpath Scheduling",
            location: "Remote",
            dates: "Aug 2017 – May 2019",
            context: null,
            bullets: [
              "Owned appointment reminders for 1,200 clinics; two-way SMS confirmation reduced no-shows by 18%.",
              "Built the first product analytics dashboards in Looker, retiring 14 manual weekly reports.",
            ],
          },
        ],
      },
      {
        kind: "SKILLS",
        heading: "Skills",
        groups: [
          { label: "Product", items: ["Roadmapping", "Discovery interviews", "Experiment design", "Pricing"] },
          { label: "Healthcare", items: ["Epic and Cerner integrations", "HL7/FHIR", "EVV", "HIPAA"] },
          { label: null, items: ["SQL", "Looker", "Amplitude"] },
        ],
      },
      {
        kind: "EDUCATION",
        heading: "Education",
        entries: [
          { credential: "M.B.A., Health Sector Management", institution: "Boston University", location: "Boston, MA", dates: "2021", details: ["Healthcare strategy concentration"] },
          { credential: "B.S., Industrial Engineering", institution: "Northeastern University", location: null, dates: "2015", details: [] },
        ],
      },
      { kind: "LIST", heading: "Certifications", items: ["Certified Scrum Product Owner (CSPO), Scrum Alliance, 2020"] },
    ],
    ...overrides,
  };
}

const FILLER = [
  "Coordinated", "the", "regional", "scheduling", "redesign", "with", "nursing", "leaders", "and", "finance", "partners,",
  "reducing", "overtime", "hours", "while", "improving", "schedule", "fairness", "for", "clinicians", "across", "every",
  "participating", "hospital", "and", "clinic", "location", "in", "the", "network",
];

/** A unique, searchable bullet: the `ref…` token marks it in extracted text. */
function fillerBullet(entry: number, bullet: number, words: number): string {
  const body = Array.from({ length: words - 1 }, (_value, index) => FILLER[(index + entry * 3 + bullet) % FILLER.length]);
  return `${body.join(" ")} ref${entry}x${bullet}.`;
}

function fillerEntries(count: number, bullets: number, words: number): ResumeExperienceEntry[] {
  return Array.from({ length: count }, (_value, entry) => ({
    title: `Operations Program Manager ${entry + 1}`,
    organization: `Northwind Health Region ${entry + 1}`,
    location: "Boston, MA",
    dates: `${2024 - entry * 2} – ${2026 - entry * 2}`,
    context: null,
    bullets: Array.from({ length: bullets }, (_unused, bullet) => fillerBullet(entry, bullet, words)),
  }));
}

function letter(paragraphs: readonly string[]): CoverLetterDocumentModel {
  return {
    release: "application-documents/1",
    name: "Jordan Rivera",
    contact: CONTACT,
    dateLine: "September 28, 2026",
    recipientLines: ["Hiring Team", "Aster Health", "Senior Product Manager, Workforce"],
    salutation: "Dear Aster Health Hiring Team,",
    paragraphs,
    closing: "Sincerely,",
    signature: "Jordan Rivera",
  };
}

function wordCount(values: readonly string[]): number {
  return values.join(" ").split(/\s+/u).filter(Boolean).length;
}

const LETTER_380_WORDS = [
  "Aster Health is trying to make hospital staffing feel less like a weekly emergency. I have spent the last three years on that problem at Northwind Health, and I would like to bring the work to your Workforce team as Senior Product Manager.",
  "At Northwind I led the rebuild of our nurse staffing workflow across 41 hospitals. The old process took nine days to publish a schedule and leaned on agency nurses to fill gaps. We interviewed 60 charge nurses and staffing coordinators, found that most of the delay came from manual swap approvals, and shipped a shift-swap marketplace that 68% of eligible nurses used within a quarter. Schedules now publish in two days, and agency spend fell by $4.1M in the first year.",
  "Before that, at Cedarline Home Health, I learned how much product work happens outside the office. I rode along with visiting nurses every week, and what I saw led to offline documentation that raised on-time note completion from 71% to 94%. It also taught me to treat compliance teams as design partners: our EVV integration shipped a month before the state deadline because we scoped it with them from the first week. The same habit cut claim denials by 23% once we moved eligibility checks into intake, where the billing team had been asking for them for two years.",
  "I also know the unglamorous parts of this work. At Brightpath Scheduling I owned appointment reminders for 1,200 clinics, rewrote partner documentation that had stalled integrations for weeks, and built the first analytics dashboards the team used to decide what to fix next.",
  "Your posting asks for someone who can balance hospital operations leaders, frontline clinicians, and engineers. That balance is most of my job today. I run outcome reviews tied to four operating metrics, keep engineers close to the people using the product, and write decisions down so teams can move without waiting for me. I also spend time with finance partners so staffing tradeoffs are visible before they become budget surprises.",
  "I would welcome a conversation about where Aster's scheduling roadmap is headed and how my work could help your team ship calmer schedules for nurses and managers alike. Thank you for your time and consideration.",
];

test("exports the renderer release", () => {
  assert.equal(APPLICATION_DOCUMENT_RENDERER_RELEASE, "roledawn-documents/3");
});

test("renders a typical résumé on one page with selectable text in reading order", async () => {
  const model = typicalResume();
  const pdf = await renderResumePdf(model);
  assert.equal(pdf.mimeType, PDF_MEDIA_TYPE);
  assert.equal(pdf.pageCount, 1);
  assert.deepEqual(pdf.droppedBullets, []);

  const qa = await verifyRenderedText(pdf, resumePlainText(model));
  assert.equal(qa.pageCount, 1);
  assert.ok(qa.coverage >= 0.97, `coverage ${qa.coverage}`);
  const order = ["Jordan Rivera", "Senior Product Manager · Healthcare", "SUMMARY", "EXPERIENCE", "Northwind Health", "Cedarline Home Health", "SKILLS", "EDUCATION", "CERTIFICATIONS"];
  const positions = order.map((needle) => qa.text.indexOf(needle));
  assert.ok(positions.every((position) => position >= 0), `missing text: ${order.filter((_needle, index) => positions[index] < 0).join(", ")}`);
  assert.deepEqual([...positions].sort((left, right) => left - right), positions, "text must extract in reading order");
  assert.match(qa.text, /Senior Product Manager, Northwind Health · Boston, MA Mar 2022 – Present/u);
});

test("section headings extract as plain words, not letter-spaced", async () => {
  const pdf = await renderResumePdf(typicalResume());
  const { text } = await verifyRenderedText(pdf, "");
  for (const heading of ["SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION", "CERTIFICATIONS"]) {
    assert.match(text, new RegExp(`^${heading}$`, "mu"), `${heading} should be its own plain line`);
  }
  assert.doesNotMatch(text, /E X P E R I E N C E/u);
});

test("ligatures stay off so extracted words match the typed words", async () => {
  const pdf = await renderResumePdf(typicalResume());
  const { text } = await verifyRenderedText(pdf, "");
  assert.match(text, /\bstaffing\b/u);
  assert.match(text, /\bworkflow\b/u);
  assert.match(text, /\bworkflows\b/u);
  assert.doesNotMatch(text, /[\ufb00-\ufb06]/u);
});

test("renders Latin Extended and Latin-1 names through per-run font fallback", async () => {
  for (const name of ["Łukasz Nowak", "José Núñez", "Zoltán Kővári"]) {
    const model = typicalResume({ name, contact: { ...CONTACT, location: "Kraków, Poland" } });
    const pdf = await renderResumePdf(model);
    const qa = await verifyRenderedText(pdf, resumePlainText(model));
    assert.ok(qa.text.startsWith(name), `expected "${name}" at the top, got "${qa.text.slice(0, 40)}"`);
    assert.match(qa.text, /Kraków, Poland/u);
    assert.ok(qa.coverage >= 0.97, `coverage ${qa.coverage} for ${name}`);
  }
});

test("email, LinkedIn, and website are clickable links; unsafe schemes are not linked", async () => {
  const model = typicalResume({ contact: { ...CONTACT, websiteUrl: "javascript:alert(1)" } });
  const pdf = await renderResumePdf(model);
  const document = await getDocumentProxy(Uint8Array.from(pdf.bytes), { verbosity: 0 });
  try {
    const annotations = await (await document.getPage(1)).getAnnotations();
    const urls = annotations.map((annotation) => String(annotation.url ?? annotation.unsafeUrl ?? ""));
    assert.ok(urls.includes("mailto:jordan.rivera@example.com"), urls.join(", "));
    assert.ok(urls.includes("https://www.linkedin.com/in/jordanrivera"), urls.join(", "));
    assert.ok(urls.every((url) => !url.startsWith("javascript:")), urls.join(", "));
  } finally {
    await document.loadingTask.destroy();
  }
});

type PositionedText = Readonly<{ text: string; x: number; y: number; width: number }>;

async function firstPageText(bytes: Uint8Array): Promise<Readonly<{ items: PositionedText[]; links: Readonly<{ url: string; rect: number[] }>[]; info: Record<string, unknown> }>> {
  const document = await getDocumentProxy(Uint8Array.from(bytes), { verbosity: 0 });
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => ("str" in item && item.str.trim()
      ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }]
      : []));
    const links = (await page.getAnnotations()).map((annotation) => ({ url: String(annotation.url ?? ""), rect: annotation.rect as number[] }));
    const metadata = await document.getMetadata();
    return { items, links, info: metadata.info as Record<string, unknown> };
  } finally {
    await document.loadingTask.destroy();
  }
}

test("a long title wraps clear of its right-aligned dates, and links cover their text", async () => {
  const base = typicalResume();
  const model = typicalResume({
    sections: [{
      kind: "EXPERIENCE",
      heading: "Experience",
      entries: [{
        title: "Senior Director, Clinical Operations Strategy and Revenue Cycle Transformation",
        organization: "Northwind Regional Health Partners Accountable Care Organization",
        location: "Tampa, FL",
        dates: "September 2019 – Present",
        context: null,
        bullets: ["Reduced days in accounts receivable from 58 to 41 across all agencies."],
      }],
    }, ...base.sections.slice(1)],
  });
  const pdf = await renderResumePdf(model);
  const { items, links, info } = await firstPageText(pdf.bytes);

  const dates = items.find((item) => item.text === "September 2019 – Present");
  assert.ok(dates, "dates render as one run");
  const sameLine = items.filter((item) => item !== dates && Math.abs(item.y - dates.y) < 0.5);
  assert.ok(sameLine.length > 0, "the title shares the dates baseline");
  for (const item of sameLine) {
    assert.ok(item.x + item.width <= dates.x - 10, `"${item.text}" ends at ${item.x + item.width}, dates start at ${dates.x}`);
  }
  assert.ok(dates.x + dates.width <= 612 - 36, "dates stay inside the right margin");

  // pdf.js may merge the contact line into one item; the link must sit inside it, cover its
  // baseline, and be about as wide as the address itself.
  const contactLine = items.find((item) => item.text.includes("jordan.rivera@example.com"));
  const mailto = links.find((link) => link.url === "mailto:jordan.rivera@example.com");
  assert.ok(contactLine && mailto);
  const [left, bottom, right, top] = mailto.rect;
  assert.ok(left >= contactLine.x - 0.5 && right <= contactLine.x + contactLine.width + 0.5, `link rect ${mailto.rect.join(",")}`);
  assert.ok(right - left > 80 && right - left < 160, `link width ${right - left}`);
  assert.ok(bottom <= contactLine.y && top >= contactLine.y, "link rectangle spans the email baseline");
  assert.ok(links.some((link) => link.url === "https://jordanrivera.dev/"), links.map((link) => link.url).join(", "));

  assert.equal(info.Title, "Jordan Rivera – Résumé");
  assert.equal(info.Author, "Jordan Rivera");
  assert.equal(info.CreationDate, undefined, "no fabricated creation time");
});

test("typed bullet markers are not doubled, and an empty name is refused", async () => {
  const model = typicalResume({ sections: [{ kind: "LIST", heading: "Awards", items: ["• Northwind Health President's Award, 2024", "- Aster Innovation Prize, 2021"] }] });
  const pdf = await renderResumePdf(model);
  const { text } = await verifyRenderedText(pdf, "");
  assert.match(text, /^• Northwind Health President's Award, 2024$/mu);
  assert.match(text, /^• Aster Innovation Prize, 2021$/mu);
  assert.doesNotMatch(text, /• [•-]/u);

  await assert.rejects(renderResumePdf(typicalResume({ name: "   " })), /APPLICATION_DOCUMENT_NAME_REQUIRED/u);
  await assert.rejects(renderCoverLetterDocx({ ...letter(["Body."]), name: "" }), /APPLICATION_DOCUMENT_NAME_REQUIRED/u);
});

test("identical input renders identical PDF bytes", async () => {
  const model = typicalResume();
  const first = await renderResumePdf(model);
  const second = await renderResumePdf(model);
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes));
});

test("an oversized résumé takes two pages without trimming and never strands a heading", async () => {
  const model = typicalResume({
    sections: [
      { kind: "EXPERIENCE", heading: "Experience", entries: fillerEntries(6, 5, 25) },
      ...typicalResume().sections.slice(1),
    ],
  });
  const pdf = await renderResumePdf(model);
  assert.equal(pdf.pageCount, 2);
  assert.deepEqual(pdf.droppedBullets, []);

  const qa = await verifyRenderedText(pdf, resumePlainText(model));
  assert.ok(qa.coverage >= 0.97, `coverage ${qa.coverage}`);
  const [firstPage, secondPage] = qa.text.split("\f").map((page) => page.trim().split("\n"));
  const lastLine = firstPage.at(-1) ?? "";
  assert.ok(!["EXPERIENCE", "SKILLS", "EDUCATION", "CERTIFICATIONS"].includes(lastLine), `page 1 ends with heading ${lastLine}`);
  assert.doesNotMatch(lastLine, /\d{4} – \d{4}$/u, "page 1 must not end with an entry title line");
  assert.ok(secondPage.length > 0);
});

test("a résumé too long for two pages trims only trailing bullets and reports them", async () => {
  const model = typicalResume({
    sections: [
      { kind: "EXPERIENCE", heading: "Experience", entries: fillerEntries(12, 8, 30) },
      ...typicalResume().sections.slice(1),
    ],
  });
  const pdf = await renderResumePdf(model);
  assert.ok(pdf.pageCount !== null && pdf.pageCount <= 2, `pages ${pdf.pageCount}`);
  assert.ok(pdf.droppedBullets.length > 0);

  const { text } = await verifyRenderedText(pdf, "");
  const firstBullets = new Set(fillerEntries(12, 8, 30).map((entry) => entry.bullets[0]));
  for (const dropped of pdf.droppedBullets) {
    assert.ok(!firstBullets.has(dropped), "the first bullet of an entry is never dropped");
    const marker = /ref\d+x\d+/u.exec(dropped)?.[0] ?? "";
    assert.ok(marker && !text.includes(marker), `dropped bullet ${marker} must not be rendered`);
  }
  for (let entry = 0; entry < 12; entry += 1) {
    assert.ok(text.includes(`ref${entry}x0.`), `entry ${entry} keeps its first bullet`);
  }
});

test("a small one-page overflow trims the oldest entry's last bullets instead of adding a page", async () => {
  const base = typicalResume();
  let result: Awaited<ReturnType<typeof renderResumePdf>> | null = null;
  // Grow non-bullet content until the page overflows by a little.
  for (let groups = 1; groups <= 40; groups += 1) {
    const model = typicalResume({
      sections: [
        ...base.sections,
        {
          kind: "SKILLS",
          heading: "Tools",
          groups: Array.from({ length: groups }, (_value, index) => ({ label: `Toolkit ${index + 1}`, items: ["Looker", "Amplitude", "Figma", "Jira", "Tableau"] })),
        },
      ],
    });
    result = await renderResumePdf(model);
    if (result.droppedBullets.length > 0 || result.pageCount !== 1) break;
  }
  assert.ok(result);
  assert.equal(result.pageCount, 1, "a small overflow stays on one page");
  assert.ok(result.droppedBullets.length >= 1 && result.droppedBullets.length <= 3, `dropped ${result.droppedBullets.length}`);
  const experience = base.sections[0];
  assert.ok(experience.kind === "EXPERIENCE");
  const trimmable = new Set(experience.entries.flatMap((entry) => entry.bullets.slice(1)));
  for (const dropped of result.droppedBullets) {
    assert.ok(trimmable.has(dropped), `"${dropped}" is not a trailing experience bullet`);
  }
  assert.equal(result.droppedBullets.at(-1), experience.entries.at(-1)?.bullets.at(-1), "the oldest entry's last bullet goes first");
});

test("a cover letter with a ~380-word body fits on one page", async () => {
  const words = wordCount(LETTER_380_WORDS);
  assert.ok(words >= 360 && words <= 400, `fixture has ${words} words`);
  const model = letter(LETTER_380_WORDS);
  const pdf = await renderCoverLetterPdf(model);
  assert.equal(pdf.pageCount, 1);
  const qa = await verifyRenderedText(pdf, coverLetterPlainText(model));
  assert.ok(qa.coverage >= 0.97, `coverage ${qa.coverage}`);
  assert.ok(qa.text.indexOf("September 28, 2026") < qa.text.indexOf("Dear Aster Health Hiring Team,"));
  assert.ok(qa.text.indexOf("Sincerely,") < qa.text.lastIndexOf("Jordan Rivera"));
});

test("the application PDF puts the cover letter first and starts the résumé on a new page", async () => {
  const cover = letter(LETTER_380_WORDS);
  const resume = typicalResume();
  const pdf = await renderApplicationPdf(cover, resume);
  assert.equal(pdf.pageCount, 2);
  const qa = await verifyRenderedText(pdf, `${coverLetterPlainText(cover)}\n${resumePlainText(resume)}`);
  assert.ok(qa.coverage >= 0.97, `coverage ${qa.coverage}`);
  const [letterPage, resumePage] = qa.text.split("\f").map((page) => page.trim());
  assert.match(letterPage, /Dear Aster Health Hiring Team,/u);
  assert.doesNotMatch(letterPage, /EXPERIENCE/u);
  assert.ok(resumePage.startsWith("Jordan Rivera\nSenior Product Manager · Healthcare Workflow Platforms"), resumePage.slice(0, 80));
  assert.match(resumePage, /^EXPERIENCE$/mu);
});

test("DOCX résumé keeps every word, uses Word bullets and hyperlinks, and avoids layout tables", async () => {
  const model = typicalResume();
  const docx = await renderResumeDocx(model);
  assert.equal(docx.mimeType, DOCX_MEDIA_TYPE);
  assert.equal(docx.pageCount, null);
  const qa = await verifyRenderedText(docx, resumePlainText(model));
  assert.equal(qa.coverage, 1);
  assert.match(qa.text, /^EXPERIENCE$/mu);

  const zip = await JSZip.loadAsync(docx.bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  assert.ok(documentXml);
  assert.match(documentXml, /<w:numPr>/u, "bullets come from a numbering definition");
  assert.doesNotMatch(documentXml, /<w:t[^>]*>\u2022/u, "no typed bullet characters");
  assert.match(documentXml, /<w:hyperlink /u);
  assert.match(documentXml, /<w:tab w:val="right"/u, "dates align on a right tab stop");
  assert.doesNotMatch(documentXml, /<w:tbl>|<w:txbxContent>/u);
  assert.equal(Object.keys(zip.files).some((name) => /word\/(header|footer)\d*\.xml$/u.test(name)), false);

  const html = await mammoth.convertToHtml({ buffer: Buffer.from(docx.bytes) });
  assert.match(html.value, /<a href="mailto:jordan\.rivera@example\.com">/u);
  assert.match(html.value, /<a href="https:\/\/www\.linkedin\.com\/in\/jordanrivera">/u);
});

test("DOCX cover letter keeps every word", async () => {
  const model = letter(LETTER_380_WORDS);
  const docx = await renderCoverLetterDocx(model);
  assert.equal(docx.mimeType, DOCX_MEDIA_TYPE);
  const qa = await verifyRenderedText(docx, coverLetterPlainText(model));
  assert.equal(qa.coverage, 1);
});

test("text QA reports missing expected tokens", async () => {
  const pdf = await renderResumePdf(typicalResume());
  const qa = await verifyRenderedText(pdf, "Jordan Rivera Kubernetes Terraform");
  assert.ok(qa.coverage > 0 && qa.coverage < 1, `coverage ${qa.coverage}`);
});
