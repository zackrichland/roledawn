# Application writing policies

These original RoleDawn policies are the writing skills behind every résumé, cover letter, and short answer. They contain no candidate biography. The drafting adapter reads the five files for every generation and records the release, combined SHA-256 digest, and each file's digest in the saved packet manifest. Release 4 adds company research and a needs brief, interview stories as proof, per-segment sources, a locked résumé template, and the style linter (`src/domain/writing-lint.ts`).

| File | Change here |
| --- | --- |
| `evidence.md` | Source kinds, the requirement map, choosing proof, numbers and scope |
| `resume.md` | Headline, summary, bullets, selection, skills, tailoring modes |
| `cover-letter.md` | Telegraphing the need, letter shapes, paragraph plan, length |
| `voice.md` | Candidate voice profile, sentence variety, banned phrases |
| `quality.md` | The self-check the writer runs before returning |
| `manifest.json` | The owned guidance release; the five file names and their order are fixed |

Edit the prose, run the policy, drafting, quality, and renderer tests, then rebuild and deploy the web and worker services. Local edits take effect on the next generation in a running source checkout; deployed containers and bundles need a new deployment. Existing packets retain their original provenance and are not rewritten. Advance the manifest release for an intentional policy revision; hashes also identify changes within a release.

Markdown guides drafting. It does not change hard validation or grant execution authority. Source eligibility, exact-fact boundaries, response schemas, word bounds, evidence validation, and quality gates remain in the TypeScript domain and server code. PDF extraction, required artifact variants, and page limits remain in the renderer and database. Those rules require code changes and tests. The combined application PDF places the cover letter first and starts the resume on a new page; the separate PDF and DOCX files remain available.

The loader rejects missing, empty, oversized, malformed, or directory-escaping files. The README is explanatory and is not sent to the model or included in the five-document digest.
