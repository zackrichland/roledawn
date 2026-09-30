---
title: RoleDawn current state
status: canonical project snapshot
owner: founder, product, and engineering
last_updated: 2026-09-30
scope: current repository capability, recorded production evidence, and remaining single-account limits
---

# Current state

RoleDawn can prepare and deliver a named Greenhouse application for the
founder's private account. Three employer-confirmed applications across two employers were verified in a
read-only hosted check on 2026-09-30 UTC; the [review brief](review-brief-2026-09-30.md)
records the earlier two. That is evidence for this bounded
path, not every Greenhouse form or every ATS.

The review started at `7408a7c` and was initially local only. This snapshot now
includes the authorized rollout's verified hosted metadata, three applied
migrations, and approved private profile update. Backend commit `30e7a19` is
published in verified Netlify deployment `6abc7f1ecfcaeba896cb4c16`. The first review kept the interface unchanged. The founder then requested Ashby
delivery, faster intake, company logos, and removal of redundant send approval.
The follow-up changes below are locally implemented; their deployment and live
acceptance remain to be recorded.
The earlier dated observations are preserved in
[state history](state-history-through-2026-09-30.md); they are not current
operating instructions.

## What exists

| Area | Current capability | Evidence and boundary |
|---|---|---|
| Home | Paste a supported posting, follow preparation and sending, answer questions, enter an emailed code, and retry eligible stops. | Code and [application playbook](application-playbook.md). Home reports the stored workflow state. |
| Jobs | Ranked catalog search, saved jobs, and named-job application intake. | Code; source inventory changes over time. Old catalog counts are historical, not current availability. |
| Profile | Résumé upload/review, structured experience, stories/interview, routine profile answers, preferences, and a read-only Gmail connection. | Code. Candidate facts and approved evidence remain private database records. |
| Writing | Frozen candidate inputs, owned writing policies, research, source-linked drafting/verification, and five rendered files. | Code and [writing policies](../../policies/application-writing/README.md). |
| Delivery | Browserbase plus the form agent, exact-fact filling, acknowledged uploads, a single-use submit permission, and employer-evidenced receipts. | Code; Greenhouse acceptance below. Uncertain outcomes require reconciliation. |
| Routine questions | Profile facts, candidate answers remembered by question wording, standing answers, then the candidate. | D-112, D-115 and D-117 in the [decision log](decision-log.md). Sensitive exclusions are enforced in the worker and database. |
| Operations | Scheduled background lanes, bounded retry/recovery, sanitized send timings and worker events, read-only `ops:status`. | Code and D-114/D-116. Live health must be checked separately. |
| Access | Private access key required for new single-account sessions. | D-109; ordinary Supabase sessions and ownership checks remain in use. |

## ATS coverage

| Site | Supported path | Proof |
|---|---|---|
| Greenhouse | Prepare, fill, submit, handle the employer's emailed code, and confirm. | **Verified hosted readback:** three confirmed applications across two employers on 2026-09-30 UTC; all three record mailbox-supplied codes. No new submission was made during this rollout. |
| Lever | Delivery adapter and fixture coverage. | No recorded live employer confirmation. |
| Ashby | Hosted-form delivery adapter: schema-bound drafts, attachments, single/multiple-form submission, and employer receipts. | Synthetic browser coverage and public form inspection; no live employer confirmation yet. |
| Other boards | Research templates only. | No delivery adapter proof; see [board templates](../boards/README.md). |

The Greenhouse location lookup was checked on a live form without submitting
(D-118). This proves that field interaction, not a further confirmed application.

## Recorded deployment boundary

The [review brief](review-brief-2026-09-30.md) records all 20 migrations from
2026-09-28 through 2026-09-30 as applied and recorded in production. It records
deployment through `fa27648`; `e6e8b36` adds `fillMs` timing and had not been
deployed. `7408a7c` adds the brief. Those are the handoff's historical release
boundaries. The three review migrations are now applied and verified as detailed
below. Backend commit `30e7a19` was built and published as Netlify deployment
`6abc7f1ecfcaeba896cb4c16` on 2026-09-30 at 03:17 UTC. Its authenticated worker
health endpoint confirms that exact enabled deployment; all 14 checked page
assets return 200, private access is enforced, and the saved private profile
and story appear on their authenticated pages.

The earlier no-build asset failure and open single-account sign-in were
recorded as fixed in `6abc4897`. Their descriptions in the history are incident
records, not current behavior. Use `deploy --build` and the private access-key
flow described in the playbook.

## Reviewed rollout

The founder authorized implementation, then requested no UI changes. Interface
edits from the review are deferred outside Git. Backend schema readback passes;
the built deployment and its private pages, assets and worker health are verified.

| Change | Rollout boundary |
|---|---|
| Reviewed worker and SQL policy use matching standing-answer eligibility, fact allowlists, and protected-question exclusions. | Migration `20260930070000` is applied and read back; matching worker code is deployed in `30e7a19`. |
| Publishing career, voice or story changes invalidates older application inputs and pauses auto-apply. | D-121 is applied and read back; the private profile publication verified the input-version increase. |
| Remembered answers require current candidate inputs and the same frozen job. Explicit GPA/degree questions may cross jobs within that input version. Only original candidate answers establish recall authority. | D-122 migration `20260930090000` is applied and read back. |
| A verification resend with an unrecognized response remains uncertain; the city lookup admits only approved query text and exact reviewed parameters. | Deployed in `30e7a19`; the next named application remains the live delivery check for this release. |

The approved private career entry and responsibility-only story were saved
through the owning RPCs and verified by readback. Existing career entries and
evidence bindings were preserved; exact private content stays outside this
public repository. At that profile-update boundary, no open send intents or enabled account
auto-apply settings existed. A later founder-pasted Ashby application prepared
successfully but its old send intent closed as `NOT_DELIVERABLE`, with no
submission attempt. The follow-up adapter must be published before enabling
its SQL gate; recovery requires a fresh authenticated candidate command.

## Ashby and intake follow-up

- Ashby uses the existing browser, approved facts, sealed submission permission,
  durable attempts and receipt rules. Exact public GraphQL operations bind every
  autosave to the approved field/value; uploads require acknowledged exact bytes.
  A visible CAPTCHA still stops the run. Security clearance and explicit
  no-AI response instructions require candidate answers.
- An existing open send request means **Queued to apply**, then **Applying**.
  It no longer asks the candidate to approve the same send again. A closed
  unsupported request remains **Send stopped** until a fresh retry; an uncertain
  result never becomes an automatic retry. Cancellation reports success only
  when the database actually cancels the request.
- Production intake and successful lane completion wake the next due lanes.
  Database leases and the scheduled dispatcher remain authoritative. Local web
  development still relies on the hosted scheduler for the initial tick.
- Ashby company icons come from that exact employer's published ATS theme,
  without an API subscription or guessed domain. Bounded image fetching and
  caching retain initials when branding is unavailable. Other ATS logo sources
  remain follow-up work.

Local verification: all 761 tests, typecheck, lint and documentation links pass;
all 15 SQL check files pass across 93 migrations. Hosted rollout and live
acceptance remain pending.

## Remaining limits

| Gap | Consequence for one candidate |
|---|---|
| Standing answers have no editor; automatic answers are not listed on the application page. | Their source and basis are persisted, but correction and inspection still need operator access. |
| Private agent replay records can retain extracted document text after provider cleanup. | No public disclosure was found; retention cleanup must preserve active and uncertain-session recovery. |
| Required consent, privacy and attestation fields need candidate input. | A send may pause on a valid form. O-013 remains open; automation must not invent consent. |
| Two historical archived attempts remain uncertain, with no lease and reconciliation exhausted. | Keep their existing retry blocks; profile changes do not resolve employer outcomes. |
| Archive has no candidate button; candidate export and account deletion are incomplete. | Operator work remains; this is not a broader-user release. |
| No notification channel outside the app. | Check Home while sends run; Gmail disconnection or a new question may need attention. |
| Only one delivery runs at once. | Suitable for bounded personal use; throughput and multi-user operation are unproven. |
| Wider Gmail consent verification and account-based ATS flows are incomplete. | Keep the private-account scope; Workday and similar sites are not supported delivery paths. |
| Résumé parsing has no malware quarantine or OCR. | Sources are truthfully marked `NOT_SCANNED`; scanned files need a text-based replacement. |

## Next checks

1. Review the completed [rollout record](codex-review-2026-09-30.md). The source,
   schema, private profile and published deployment are verified.
2. Inspect newly prepared documents from the updated private profile before the
   next authorized application. Existing confirmed applications remain history;
   no current unsent packet requires regeneration.
3. Publish and verify the Ashby adapter before applying migration
   `20260930100000`, then recover the authorized stopped application with a
   fresh candidate command. Observe a terminal or needs-you state; only an
   employer receipt establishes live Ashby acceptance. Keep historical uncertain
   attempts blocked until their own outcomes are reconciled.

The [application playbook](application-playbook.md) owns operating instructions;
the [decision log](decision-log.md) owns decisions and reversal triggers;
[state history](state-history-through-2026-09-30.md) and the
[changelog](../../CHANGELOG.md) preserve older evidence.
