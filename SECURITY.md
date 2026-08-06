# Security policy

RoleDawn is currently an architecture and interface prototype. It is not connected to candidate accounts, messaging providers, browser sessions, employer systems, or production data.

## Reporting a concern

Do not disclose a suspected vulnerability in a public issue. Use GitHub's private vulnerability reporting for this repository when available, or contact the repository owner through the private contact method listed on the owner's GitHub profile.

Include:

- The affected file, route, or proposed service boundary.
- Reproduction steps or the unsafe state transition.
- The candidate data, authority, or external side effect at risk.
- Whether the issue could expose credentials, infer sensitive answers, reuse approval, duplicate a submission, or fabricate confirmation.

Do not include real candidate credentials, resumes, government identifiers, or employer-login material in a report.

## Security posture of this repository

- Prototype data is local and illustrative.
- No production secrets are required to build or inspect the interface.
- Production security controls in `docs/architecture` are design requirements, not completed certifications or audit results.
- No SOC 2, penetration-test, regulatory, privacy, or platform-compliance claim is made.

The canonical threat model and trust boundaries are documented in [`docs/architecture/data-security-and-trust.md`](docs/architecture/data-security-and-trust.md).
