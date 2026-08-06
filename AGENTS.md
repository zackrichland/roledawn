# Repository instructions for humans and LLMs

This repository is the operating context for RoleDawn. Read `README.md`, `docs/00-founder-brief.md`, and `docs/execution/decision-log.md` before changing strategy, product behavior, architecture, brand, or launch copy.

## Evidence discipline

- Label statements as **Verified**, **Inference**, **Recommendation**, **Hypothesis**, or **Open question** when their status is not obvious.
- Put dated external claims and their primary URLs in `docs/research/source-register.md`.
- Do not convert vendor claims, founder claims, scraped client code, reviews, or search snippets into verified independent facts.
- Never invent traction, customer outcomes, company logos, domain availability, pricing validation, security certification, ATS support, or partnerships.
- Say exactly whether an outcome is an application, recruiter response, interview, offer, or hire.
- Treat volatile product details, prices, model names, policies, APIs, and market metrics as stale until rechecked.

## Product safety

- The database and workflow engine are the source of truth. Model memory and chat history are not.
- Use structured, provenance-linked facts for exact answers. Vector retrieval supports narrative evidence only.
- Models may interpret and draft. They may not authorize themselves, mutate policy, infer sensitive answers, bypass CAPTCHA, or decide a side effect occurred.
- Require a single-use approval tied to one named application and one immutable pre-submit diff.
- Reconcile uncertain submission state before any retry.
- Preserve pause, cancel, export, and deletion controls.
- Keep provider-specific IDs behind adapters.

## Writing standard

Apply the no-slop pass to customer-facing copy and generated application materials:

1. Preserve the writer's actual voice and strongest concrete facts.
2. Prefer direct verbs and stable nouns.
3. Remove generic throat-clearing, bloated scene-setting, fake quotations, empty superlatives, excessive fragments, unnecessary summaries, and generic AI language.
4. Do not manufacture opinions, specificity, or evidence to sound human.
5. Read the result aloud; if a sentence sounds like a pitch-deck placeholder, rewrite or delete it.

Do not copy or redistribute third-party skill text. Recreate the behavior as an internal, licensed policy and evaluation suite before product launch.

## Documentation conventions

- Use descriptive Markdown headings and compact tables.
- Use Mermaid for systems, sequences, and state machines; keep the prose authoritative when diagrams are simplified.
- Link related documents with repository-relative links.
- Record consequential changes in `docs/execution/decision-log.md` with date, status, rationale, and reversal trigger.
- Update `last_updated` front matter when changing a document materially.
- Preserve the distinction among MVP, later phase, and explicitly out of scope.

## Review checklist

Before considering a change complete:

- Check every numeric or competitor claim against the source register.
- Search for unsupported guarantees: `guarantee`, `unlimited`, `fully autonomous`, `all ATS`, `zero risk`.
- Confirm no sensitive field can be generated from an embedding or guessed by a model.
- Confirm external side effects have an approval, idempotency, audit, and recovery path.
- Confirm landing proof is gated until real, consented evidence exists.
- Check Markdown links and Mermaid blocks for obvious breakage.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
