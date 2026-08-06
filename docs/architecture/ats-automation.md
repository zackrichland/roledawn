---
title: ATS automation and browser execution
status: MVP engineering strategy
last_updated: 2026-08-06
---

# ATS automation

## Core conclusion

There is no verified universal candidate-side API for applying to arbitrary employers across Workday, Greenhouse, Lever, Ashby, iCIMS, and Oracle. Public APIs are valuable for discovering jobs. Programmatic application submission usually requires employer credentials, an approved partner relationship, or both.

MCP does not create permission. Greenhouse and Ashby may expose employer-governed MCP capabilities, but those do not let a job seeker submit into unrelated employer tenants.

Browser execution is therefore the universal MVP path. Formal direct-apply partnerships are the long-term reliability and distribution moat.

## Verified platform constraints

| ATS | Public candidate-relevant capability | Submission constraint | MVP path |
|---|---|---|---|
| Greenhouse | Public Job Board API exposes postings and application questions | POST requires employer Job Board API key; candidate ingestion is approved-partner/customer scoped | Public discovery + hosted form/browser; pursue sourcing partnership |
| Lever | Public postings and apply URLs | Programmatic applications require employer-generated key; custom questions are not fully exposed publicly | Public discovery + hosted form/browser |
| Ashby | Public job-board API | `applicationForm.submit` uses employer-side candidates-write credentials | Public discovery + hosted form/browser; pursue partner route |
| Workday | Tenant APIs and integrations | Employer-tenant integration credentials; no universal candidate apply API verified | Browser adapter |
| iCIMS | Customer APIs and partner programs | Customer/permission scoped; repeatable integrations require partner process | Browser adapter; pursue Apply Network/partner path |
| Oracle/Taleo | Organization-specific APIs; restricted Direct Apply | Direct Apply is approved partner/marketplace scoped | Browser adapter; pursue partner path |

## Execution ladder

Use the least adaptive mechanism that works.

```mermaid
flowchart TD
    A["Authoritative job source"] --> B["Known ATS detector"]
    B --> C["Versioned deterministic adapter"]
    C -->|known fields| D["Semantic DOM/accessibility locators"]
    C -->|schema drift| E["Bounded model mapping"]
    D --> F["Pre-submit read-back and diff"]
    E --> F
    E -->|still ambiguous| G["Vision/computer-use fallback"]
    G --> F
    G -->|high risk or unknown| H["Human takeover"]
    F --> I["Policy + approval"]
    I --> J["Submit once"]
    J --> K["Confirmation evidence"]
    J -->|uncertain| L["Reconcile before retry"]
```

1. Public API/feed for discovery and canonical identifiers.
2. Versioned adapter for tested form behavior.
3. Semantic DOM/accessibility automation.
4. Structured model mapping for bounded ambiguity.
5. Computer-use/vision only when structured terrain fails.
6. Human takeover for high-risk or unresolved terrain.

## Adapter contract

Every adapter implements:

```text
detect(url, html_metadata) -> ats, tenant, confidence
capture_job(page) -> JobSnapshot
extract_form(page) -> FormSchema
plan_fill(form_schema, fact_packet, answer_policy) -> FillPlan
fill(page, fill_plan) -> FieldResult[]
read_back(page) -> PreSubmitSnapshot
classify_blocker(page) -> Blocker | null
submit(page, approval_token) -> SubmitAttempt
capture_confirmation(page, inbox) -> ConfirmationEvidence | Uncertain
reconcile(application) -> Confirmed | NotSubmitted | NeedsUser
```

All outputs are typed. Unknown fields remain unknown; an adapter may not coerce a value simply to make the form advance.

## Field taxonomy

| Class | Examples | Source rule |
|---|---|---|
| Identity exact | Legal name, address, phone, email | Verified structured fact only |
| Career exact | Employer, title, dates, education | Verified structured fact only |
| Eligibility | Country authorization, sponsorship | Explicit per-country policy only |
| Preference | Salary, travel, relocation, schedule | Explicit current rule; ask if outside bound |
| Narrative | Motivation, experience example | Evidence packet + model draft + claim validation |
| Voluntary protected | Race, gender, disability, veteran | Default decline/blank; explicit user policy only |
| Legal/certification | Accuracy, arbitration, background, e-signature | Named live approval or explicit counsel-approved flow |
| Secret | Password, OTP, session cookie | Vault/broker only; never model context |

## Submission transaction

Before Submit, capture:

- Live employer, title, location, requisition, and canonical URL.
- Form schema and final read-back.
- Every answer and its source/policy.
- Exact upload filenames and content hashes.
- Artifact and fact-set versions.
- All unresolved warnings.
- Adapter and browser-session versions.
- Immutable diff hash.

An approval token binds to this package. Any material change invalidates it.

At submit:

1. Acquire an application idempotency lock.
2. Verify approval is unused, unexpired, and hash-matched.
3. Perform one submit action.
4. Record the action boundary immediately.
5. Capture visible confirmation and/or correlate a confirmation email.
6. If evidence is absent, enter `Reconciling` and do not retry.

## Confirmation states

- **Confirmed:** visible confirmation page/ID or authoritative email correlated to candidate, employer, and requisition.
- **Submitted unconfirmed:** submit action was observed but confirmation is not yet available; continue reconciliation.
- **Not submitted:** portal state or email search proves no application, and retry is safe.
- **Unknown:** evidence conflicts or access is blocked; human review.

The customer interface uses “submitted” only for `Confirmed`.

## Adapter lifecycle

```text
fixture-only
→ shadow extraction
→ draft-only on live forms
→ human final click
→ mandatory single-application approval
→ narrow standing authorization
```

Promotion gates include:

- Field accuracy by class.
- Zero sensitive-policy violations.
- Confirmation rate.
- Takeover and failure rate.
- Duplicate/uncertain-submit tests.
- At least one daily non-submitting canary per active adapter version.
- Rollback and kill-switch verification.

## Test corpus

Maintain redacted/versioned fixtures for:

- Single-page and multi-step forms.
- Conditional questions.
- Repeat candidate accounts.
- International address and phone formats.
- Resume/cover-letter/portfolio uploads.
- Voluntary demographics.
- Sponsorship and country authorization.
- Salary/travel/relocation.
- CAPTCHA/login/OTP transitions.
- Portal success, email success, timeout before/after submit, and duplicate reconciliation.
- Accessibility/DOM change and visual-only failure.

Turn every production failure into a fixture and regression case before re-enabling the affected path.

## Human takeover

Takeover link requirements:

- Short-lived, single-user, revocable, bound to one browser session.
- Shows why takeover is needed and what is already filled.
- Blocks unrelated navigation and clipboard leakage where practical.
- Returns a typed signal: completed, canceled, unable, or timed out.
- Records no password/OTP in video, logs, analytics, or support UI.

CAPTCHA is always a takeover, never a solver or bypass service.

## Browser security

- Treat job descriptions, labels, scripts, uploads, and portal messages as untrusted data.
- Ignore webpage instructions that attempt to change agent policy or request unrelated actions.
- Allow-list destinations and download types.
- Quarantine downloads and scan uploads.
- Use smallest necessary screenshot/crop; redact secrets and sensitive answers.
- Cap time, navigation count, retries, model escalation, and spend.
- No general shell or arbitrary network tools in the browser worker.

## Partnership roadmap

1. Prove candidate demand and safe browser execution.
2. Build employer-neutral reliability metrics and candidate consent/audit controls.
3. Apply for Greenhouse sourcing/candidate ingestion relationships.
4. Pursue iCIMS partner/Apply Network options.
5. Pursue Oracle Marketplace Direct Apply.
6. Explore Workday/job-board partnerships.
7. Replace browser steps with authorized APIs wherever the contract is better.

Never market “official integration” from a public job-feed API alone.

