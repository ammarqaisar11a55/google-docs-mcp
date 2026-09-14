# Contributing

Thanks for helping improve Google Docs MCP.

## Getting started

Node.js 22.12 or newer is required.

```bash
git clone https://github.com/ammarqaisar11a55/google-docs-mcp.git
cd google-docs-mcp
npm ci
npm test
```

Unit tests mock the Google APIs, so no Google account is needed. See the README for running the
server against a real account and for the optional integration tests.

## Before opening a pull request

Run all checks. CI runs the same commands:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run package
npm run package:check
```

- Keep business logic in `src/services`, Google API calls in `src/google`, and MCP tool
  definitions in `src/tools`.
- Add or update tests for every behaviour change. Tests must never need real credentials.
- Tool names are a public API. Don't rename tools or change their meaning; add optional
  parameters instead.
- If you add or remove a tool, update `tools` in `manifest.json` and the README. A unit test
  checks that the manifest and the server agree.
- Never commit `.env` files, OAuth client secrets or token files, and never log tokens.

## Releasing

1. Update the version in both `package.json` and `manifest.json`, and add a `CHANGELOG.md` entry.
2. Commit, then tag the commit with `vX.Y.Z` and push the tag.
3. The release workflow runs all checks, builds the `.mcpb` and attaches it to the GitHub release.
