# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-15

### Added

- **Claude Desktop extension.** `manifest.json` (MCPB manifest 0.3), an extension icon, and
  `npm run package`, which builds a self-contained `build/google-docs-mcp.mcpb`.
- `npm run package:check`, which unpacks the bundle, checks its contents for missing runtime files,
  development artifacts and secrets, and launches it with Claude Desktop's configuration logic.
- Extension settings: OAuth Client ID and Client secret (the secret is stored as a sensitive
  value by Claude Desktop), least-privilege Drive access, sign-in callback port and debug logging.
- `create_document` accepts optional `initialContent`.
- Environment variables `GOOGLE_DRIVE_FILE_ONLY`, `GOOGLE_DOCS_MCP_DEBUG` and
  `GOOGLE_DOCS_MCP_LOAD_DOTENV`.
- CI and release GitHub Actions workflows. Pushing a `vX.Y.Z` tag attaches the `.mcpb` to a
  GitHub release.

### Changed

- An invalid configuration no longer stops the server. All tools stay available and report the
  configuration problem, and `get_auth_status` includes `configurationError`.
- Unresolved `${user_config.*}` placeholders in the environment are treated as unset.
- Stored tokens record the OAuth client they were issued to. After switching to a different
  OAuth client, tools ask you to sign in again instead of failing with a Google error.

## [1.0.0] - 2026-09-11

### Added

- Initial release: MCP server for Google Docs over stdio with Google OAuth 2.0 (PKCE, loopback
  redirect, token refresh), 21 tools for documents, content, formatting, structure and search,
  a document resource, four prompts, and unit and integration tests.

[1.1.0]: https://github.com/ammarqaisar11a55/google-docs-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ammarqaisar11a55/google-docs-mcp/releases/tag/v1.0.0
