---
status: verified_local_and_live_synthetic
last_updated: 2026-09-16
---

# Application writing repair and evidence coverage

RoleDawn now permits one feedback-driven revision for repairable writing failures. Every replacement passes deterministic source checks, independent semantic checks, and the writing quality gate before artifact rendering or commit. Unsupported or ambiguous facts, invalid source bindings, refusals, and malformed model output do not enter a revision loop. Exhausted writing failures atomically finish the preparation run, move the application to `FAILED_SAFE`, and dead-letter the leased drafting message with redacted attempt metadata.

## Versioned behavior

| Contract | Release / behavior |
| --- | --- |
| Frozen writing policy | `roledawn-writing-policy/3`; 120–300 words, 3–5 paragraphs |
| Editable guidance | `roledawn-application-writing/3`; prefer about 160–220 words when evidence supports it; never pad to a target |
| Drafting adapter | `openai-responses-drafting/3` |
| Semantic request / adapter | `application-entailment/2` / `openai-responses-entailment/2` |
| Repair history | `application-drafting-repair/1`; at most two attempts |
| Packet / artifacts | `application-kit/3`; separate résumé and letter PDF/DOCX plus cover-letter-first combined PDF |

The semantic request checks both declared claims and the actual generated résumé and letter paragraphs. Each segment uses its attached evidence. A missing or empty source blocks the packet even if the verifier incorrectly returns an accepting decision. Job-field citations resolve separately labeled fields from the same frozen posting; a title citation therefore retains that posting's employer and requirements. Job context cannot support a candidate claim. Conventional interest or an invitation to discuss the sourced record is allowed only in document prose; factual assertions, qualifications, availability, and commitments still require evidence.

Policy hashes and adapter releases are retained with the packet. Attempt history stores fixed issue codes, word/paragraph counts, and policy release/hash; it contains no failed prose, candidate source text, or provider error body. The final packet remains private and contains its normal full validation/provenance report.

## Verification

**Verified locally:** unit cases cover an initially short draft repaired successfully, exhausted repair, refusal/incomplete output, unsupported numbers, initial and post-revision semantic rejection, missing provenance, redacted errors, and no artifact/commit callback before validation. Entailment regression cases cover undeclared assertions in actual prose, missing attached sources, generated ID collisions, candidate claims citing only job fields, and complete frozen job context.

The terminal failure migration passed 23 local PGlite checks for source/run/message binding, live lease ownership, cancellation, atomic state changes, exact replay, redaction, and service-only access. The writing-policy `/3` forward migration passed 12 local PGlite checks. It changes only the allowed policy-release list in the existing quality trigger; its other body text and ACL remain unchanged. Historical `/2` packets remain readable.

The repeatable synthetic evaluation is `node scripts/eval-application-writing.ts`. Its default uses explicit fixture adapters, so it is a local rendering/control-flow test, not an independent model evaluation. `--live` opts into at most two drafts and two semantic calls per profession; `--profession=teacher`, `nursing`, or `finance` bounds the selection. Synthetic reports and artifacts go to a new directory under `/tmp`. No candidate database, employer form, or submission is involved. Synthetic diagnostics are kept only by this evaluation script; production history stays redacted.

### Frozen final live run

The final bounded run used `gpt-5.6-terra`, writing guidance hash `2d43e0e13b726e5ea181cde406ecdbe4ae1e55710f4c0867572c94cb14479b93`, and the full document verifier. Code and instructions were then frozen; there was no retry-until-success loop.

| Synthetic profession | Final outcome | Words / paragraphs | Evidence units | Artifacts |
| --- | --- | --- | --- | --- |
| Teacher | Accepted on first draft | 133 / 3 | 14 declared claims + 4 actual segments | All 5 passed QA |
| Nursing | Accepted on first draft | 125 / 4 | 13 declared claims + 5 actual segments | All 5 passed QA |
| Finance | Blocked on first draft | 128 / 4 | Final paragraph lacked attached role-requirement evidence | None rendered or committed |

The finance closing referred to the role's stated responsibilities but attached only an approved research claim saying the employer was hiring, alongside candidate facts. Its attached source did not include those responsibilities. The gate kept the packet blocked; the run was not repeated to obtain a favorable result. This remains a citation-selection reliability limit.

Editorial inspection of the accepted packets found concrete, sourced work and no invented metrics, credentials, or outcomes. The nursing letter explains teaching, documentation, and handoffs without adding padding. The teacher letter is serviceable but repeats the posting's responsibilities in its closing; it is not evidence of consistently polished storytelling. Both combined PDFs were rasterized and visually inspected: letter first, résumé on the next page, readable text, and no clipping. Per-page extraction independently confirmed the candidate header on both pages.

The final report and synthetic source diagnostics are at `/tmp/roledawn-writing-eval-live-1789605171879/report.json`. Accepted artifacts are in its `teacher/` and `nursing/` directories. The separate default-mode fixture run passed all three professions and 15 artifact checks; it is not live-model proof. Full-suite snapshot: 504 passing tests, followed by 13 passing pipeline tests including two added provenance/artifact-QA cases. Owned ESLint passed. Other agents' concurrent shared-workspace changes may change the final aggregate suite count.


## Findings and limits

Earlier live tests correctly rejected a 138-word letter under the former 140-word minimum. One bounded repair produced accepted teacher and finance packets under that rule, but editorial inspection found repeated meaning in one teacher letter. The minimum changed to 120 so a complete, factual 131–136-word letter need not be padded. The preferred range remains longer when the source record warrants it.

The stronger semantic check exposed two separate source problems. Detached synthetic activity statements did not establish which employer they belonged to; the fixture sources now explicitly preserve that relationship, while a negative test remains. The evaluation keeps its synthetic label in report metadata so the invented posting does not contradict its own hiring statement. Other proposals cited only employer/title when making a hiring or role-requirement statement; resolving the same frozen posting's complete job context repairs that evidence loss without inventing facts.

**Open limitation:** production evidence segmented into separate role headings and task bullets can still lack an explicit approved relationship. The model may not invent the employer attribution. Structured, provenance-linked role/task relationships are a later improvement. General answers are currently scoped to an application; approved exact profile facts are reused through the existing frozen-input path. A broader reusable answer bank remains a separate design, requiring typed intent and scope, explicit reuse choice, versioning, revocation, and deterministic matching.

These small synthetic tests establish specific accepted and blocked cases, not a population success rate or a guarantee of good writing. A semantic pass does not independently establish style quality. Official-posting-only research intentionally produces `RESEARCH_DEPTH_LIMITED`; no additional employer research was invented.
