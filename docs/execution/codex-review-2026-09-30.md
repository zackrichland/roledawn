---
title: Independent local review of main
status: backend deployed and verified; private profile updated; no UI changes
owner: engineering
last_updated: 2026-09-30
scope: review of main at 7408a7c, local fixes and cleanup, and private single-candidate readiness
---

# Independent local review

The checkout and fetched `origin/main` both started at `7408a7c`, with a clean
working tree. This review follows the [review brief](review-brief-2026-09-30.md).
It inspected submission authority and retries, question sources, candidate
input freshness, network policy, mailbox access, event/replay storage, app
structure, active UI components, and operating documentation.

**Current stage:** the authorized rollout has applied and verified all three
reviewed migrations and saved the approved private career/profile content.
Backend commit `30e7a19` is published in Netlify deployment
`6abc7f1ecfcaeba896cb4c16`. Private access, page assets, updated private profile
content and enabled worker health are verified. A new application using the
updated profile has not been submitted; inspect its documents before sending. Hosted readback confirms three earlier Greenhouse
applications across two employers. Lever remains fixture-tested and Ashby
prepares files. This is not a broader-user release.

**Initial review scope:** no hosted database access, worker runs, employer
submissions, deployment, Git commit or push was performed before the founder
authorized implementation. The subsequent rollout is recorded below. During
the initial review, the handoff's two confirmed applications were treated as
**Previously recorded**; the later hosted check verified the current counts.
Browser UI checks used synthetic data with Supabase public
configuration disabled. Read-only public Greenhouse scripts were inspected
to verify location-lookup constants.

## Findings by severity

All findings below were reproduced locally. The rollout status below records
which fixes have subsequently reached the hosted system.

| Priority | Finding and trigger | Resolution and evidence |
|---|---|---|
| P1 | A verification resend returning a server error could become a definite code rejection. If the employer had received the resend, the later timeout could authorize a duplicate attempt. Baseline: `src/server/workers/application-delivery-browser.ts:638`. | Only a recognized Greenhouse 428 `captcha-failed` response permits another code attempt. Unknown 400/428/429/500/502 responses remain `UNCERTAIN` and clear the in-memory resend permission. A synthetic employer accepted the body before the response was replaced with an error. [Browser implementation](../../src/server/workers/application-delivery-browser.ts), [regressions](../../src/server/workers/application-delivery-browser.test.ts), D-120. |
| P1 | The database accepted demographic, consent and optional standing answers the worker refused, and accepted unsupported fact namespaces. The worker also missed concrete arbitration, non-compete and attestation wordings. Baseline: `supabase/migrations/20260930060000_standing_answers_recheck.sql:17`, `src/server/workers/standing-answers.ts:36`. | Worker and database enforce matching exclusions, requiredness, fact namespaces and text length. Concrete missed sensitive wordings are covered; candidate-only answers cannot be recalled from a different application. [Policy migration](../../supabase/migrations/20260930070000_standing_answer_policy_parity.sql), [executable parity corpus](../../scripts/standing-answer-policy-parity.test.ts), D-119. |
| P1 | Career, voice and story changes did not bump the candidate input version, so earlier files could still be sent after the candidate changed their profile. The omission was explicit in `supabase/migrations/20260928100000_candidate_story_bank_and_profile.sql:10`. | Publishing or removing these inputs uses the existing version-invalidation helper. Old authority becomes stale and account auto-apply pauses. A first résumé-derived career profile preserves its own preparation when no snapshot at that input version exists; later publications invalidate. Extraction/interview metadata alone does not invalidate inputs. [Migration](../../supabase/migrations/20260930080000_candidate_profile_input_invalidation.sql), [SQL checks](../../supabase/checks/candidate_profile_input_invalidation.sql), D-121. |
| P1 | Remembered answers matched question wording without employer or role context. A synthetic “Yes” to prior employment at one company was reused at another; role-specific prose had the same risk. Baseline: `supabase/migrations/20260930050000_standing_answers.sql:223`. | All recall requires current candidate inputs. It is also bound to the frozen job, with a narrow cross-job exception for explicit context-independent education questions. Only original candidate answers are recalled, so earlier remembered copies cannot become new authority. Reusable standing/profile answers still supply routine answers. [Policy migration](../../supabase/migrations/20260930090000_remembered_answer_job_context.sql), [recall checks](../../supabase/checks/autopilot_remembered_answers.sql), D-122. |
| P2 | The location allowlist admitted arbitrary query text outside a field fill. Even after text binding, regex-matched “fixed” parameters could carry encoded unrelated data. Baseline: `src/server/workers/application-delivery-browser.ts:36`. | Require an active server-approved city fill, exact approved text or its typed prefixes, and exact reviewed public parameter constants. Changed API key, language, layers, unrelated fields, and out-of-scope requests are rejected. The existing valid city flow still passes. D-120 and source GH-20260929-01 in the [source register](../research/source-register.md). |
| P2, open | `inspect_evidence` returns extracted document paragraphs, and the private tool replay ledger retains the full result after provider cleanup. This contradicts the brief's blanket claim that tool-call records never contain document text. | Access is private and lease-gated; no public or credential leak was established. Retention cleanup remains open. Preserve active/uncertain session replay; consider removing document-bearing results only after confirmed deletion of that exact agent session. [Evidence output](../../src/server/workers/application-delivery-driver.ts), [replay persistence](../../src/server/workers/openai-agents-client.ts). |

### UI findings deferred from rollout

The initial review prepared changes to uncertain-state wording, answer reuse
disclosure, month-first date editing, mobile wrapping, and stale-tab recovery.
The founder subsequently requested **no UI changes**. Those interface changes
and the unused recovery helper were saved outside Git and removed from this
rollout. Current interface components, styles and error copy match `7408a7c`.
The backend uncertainty protections remain included.

## Structure and documentation

Removed unreachable old pasted-link/catalog actions, old single-fact and résumé
review wrappers, the obsolete server-buffer résumé upload implementation, and
their unused types and helpers. The current direct upload, résumé review,
cleanup, delete, batch-answer and send-intent paths remain. Imports, scripts and
call sites were checked before removal.

The legacy no-submit and v1 drafting modules still have script, evaluation or
recovery callers. They remain explicitly labeled legacy. Deleting every legacy
module would break reachable paths and was not a safe cleanup.

README, CONTRIBUTING and current-state now describe the current product, validation commands and evidence boundary.
The old current-state chronology is preserved as
[historical evidence](state-history-through-2026-09-30.md). Older architecture and
readiness snapshots are marked historical. AGENTS stays below 200 lines and
points to the owning operating documents. Personal answer values were removed
from founder directives and founder-shaped fixtures replaced with synthetic
examples. Git history was not rewritten or certified free of historical data.

Another agent introduced deploy-version and stale-tab recovery changes during
the review. The user confirmed that concurrent work. The nonvisual deployment ID and build wrapper remain. The error-boundary UI
and its recovery helper are deferred with the other interface edits; their hosting
behavior is not live proof. Installed Next.js documentation supports `deploymentId` and the current
error-boundary `retry` API.

## Validation

| Check | Result |
|---|---|
| Baseline `npm test` | 714 passed, zero failed or skipped. |
| Updated `npm test` | 718 passed after excluding UI recovery tests, zero failed or skipped. The initial broader review passed 720. |
| Local SQL checks | All 14 files pass across 92 migrations, including answer-context isolation, policy parity and input invalidation. These checks use local PGlite; the subsequent authorized hosted readback is recorded below. |
| TypeScript and ESLint | Final combined checks passed locally. |
| Production build | `npm run build` passed with the local dev server stopped. No preview route remains in the build. `npm run deploy -- --json` built and published `30e7a19`; the published deployment and its assets are verified. |
| Documentation and whitespace | Final link validation and `git diff --check` passed. |
| Dependency audit | `npm audit --omit=dev` reported zero known production dependency vulnerabilities at review time. This is not a security certification. |
| UI | Initial review rendered Home, Jobs, Experience, Stories and uncertain-state components with synthetic data at desktop and 390 px widths. The proposed date, wrapping, wording and recovery edits are deferred. The later profile update used owning RPCs and readback; authenticated production HTML checks confirm the saved career and story on their pages. No interface code changed in this rollout. |

The normal concurrency of three was preserved for the full Node suite. Local
browser/SQL fixtures establish mechanics. The separate authorized hosted checks
below establish their stated schema, profile and prior-application metadata;
the published-deployment checks below establish release/asset availability,
but do not establish current provider quota or a new current-profile employer receipt.

## Approval and remaining work

| Decision | Assessment |
|---|---|
| Review and commit this cleanup/fix set | Completed: `30e7a19` is committed, pushed and deployed; local checks and hosted migration/profile/release readbacks pass. |
| Use the product for one candidate's Greenhouse applications | Built deployment verified; inspect newly prepared current-profile documents before sending. No unsent packet currently needs regeneration. Observe the next authorized named application through a terminal or needs-you state; this rollout creates no new submission. |
| Leave general auto-apply unattended | Not yet recommended. Standing-answer interpretation can still be semantically wrong despite structural validation, and monitoring/answer-management UI remains limited. |
| Broader ATS or public launch | Not approved by this evidence. Lever live delivery, account-based ATS support, standing-answer editing/readback, notifications, archive/export/delete flows and wider Gmail readiness remain incomplete. |

The approved private career entry and responsibility-only story are now saved
to the hosted profile and verified by readback. Companion narrative, résumé,
cover-letter and evidence-gathering materials remain in ignored private local
files. No private career details are repository content, and no current-role
achievements, tools or metrics were invented.

The authorized built deployment and verification of its published version and
worker health are complete. The current hosted state contains
no unarchived unsent packet to regenerate. Future applications must use the
updated inputs, and a new send must never bypass unresolved submission
uncertainty. The [playbook](application-playbook.md) owns the operating commands.

## Authorized rollout (September 29 EDT / September 30 UTC)

The founder approved implementation and requested no UI changes. The four
modified interface files and stale-tab UI helper were set aside in an ignored,
restorable local patch. The rollout retains the existing interface.

- Migrations `20260930070000`, `20260930080000` and `20260930090000` were applied
  atomically and recorded. Readback verified eight function bodies, search paths
  and grants, five enabled triggers, and all three migration-history entries.
- Regenerated public TypeScript types are identical to the checked-in file.
- The private career entry and approved responsibility-only story were saved
  through the owning candidate RPCs, read back, and advanced the input version.
  Existing career entries and evidence bindings were preserved. No private
  career details or save payloads are committed to this public repository.
- Hosted metadata shows three confirmed applications across two employers.
  Two earlier archived uncertain attempts have no active lease and have exhausted
  reconciliation. They were left unchanged and retain their retry blocks. Legacy
  fill sessions are expired; their completed takeover records were left intact.
- There are no open send intents or enabled account auto-apply settings. The only
  unarchived applications are confirmed, so no unsent packet needs regeneration.
- Security advisors reported no errors. Warnings cover 45 existing authenticated
  SECURITY DEFINER command RPCs and disabled leaked-password protection. The
  reviewed migrations add no anonymous/authenticated execute grant; command RPC
  ownership checks remain intentional. Wider-account hardening remains open.
- The backend-only suite passes 718 tests. Backend commit `30e7a19` was pushed
  to `main`, built and published as deployment `6abc7f1ecfcaeba896cb4c16`.
- Netlify reports the deployment ready and published. Authenticated worker health
  reports the same deployment ID with workers enabled; cleanup completed after
  publication. The private-entry URL rejects requests without a key, authenticated
  Experience and Stories pages return 200 with the saved content, and all 14
  checked page assets return 200. No secret or session cookie is recorded here.

This rollout does not submit a new employer application or establish a new
current-profile employer receipt. The UI wording issues identified above remain
deferred under the founder's no-UI-change instruction.
