# Security Policy

CrossStaff is an early alpha and has not completed an independent security audit.

## Supported version

Only the latest commit on `main` is supported with security fixes.

## Report a vulnerability

Please do not open a public issue for an exploitable vulnerability. Contact the maintainer listed on the eventual GitHub repository profile with:

- A concise description.
- Reproduction steps.
- Impact and affected version.
- A suggested mitigation, if known.

Until a dedicated security contact is published, keep the repository private and do not expose the server to untrusted networks.

## Current limitations

- No user authentication or tenant isolation.
- No OS-level sandbox for command agents.
- No encrypted credential vault.
- No trusted-device approval.
- SSE and HTTP APIs are designed for localhost use.
- Agent output and repository content may contain prompt injection.

Do not use this version for production secrets, multi-tenant hosting, or unattended high-impact actions.
