# Contributing

CrossStaff is in early alpha. The most useful contributions are focused bug fixes, adapter experiments, security analysis, and tests around workflow state transitions.

## Before opening a pull request

1. Run `npm test`.
2. Run `npm run check`.
3. Add or update tests for behavior changes.
4. Document security-sensitive changes and tradeoffs.
5. Keep provider integrations behind adapters; avoid coupling core workflow code to one vendor.

## Provider integrations

- Use official APIs, SDKs, or CLIs only.
- Do not add browser-cookie import, password storage, automatic account rotation, or rate-limit evasion.
- Do not commit credentials, local database files, private repository content, or captured model conversations.
- State clearly whether an adapter is read-only, sandboxed, or able to modify the workspace.

## Commit style

Use short imperative commit messages, for example:

```text
Add reviewer handoff audit fields
Fix SSE reconnect loop
Document command adapter threat model
```

## Security issues

Do not report exploitable security issues in a public issue. Follow [SECURITY.md](SECURITY.md).
