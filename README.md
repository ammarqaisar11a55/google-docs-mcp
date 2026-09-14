# Google Docs MCP

Let Claude work with your Google Docs. Google Docs MCP is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that creates, reads, edits, formats and searches Google Docs through the official Google Docs and Google Drive APIs.

You can use it in two ways:

- **Claude Desktop extension (`.mcpb`).** Install one file, fill in two settings, and sign in with Google. You don't need Node.js, npm or any JSON configuration.
- **Standalone MCP server.** Run it with Node.js from any MCP client, such as Claude Code, VS Code or Cursor.

> Google Docs MCP is an independent open-source project. It is not affiliated with or endorsed by Google.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation (Claude Desktop)](#installation-claude-desktop)
- [Setup](#setup)
- [Available Tools](#available-tools)
- [Usage Examples](#usage-examples)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)
- [Updating and Uninstalling](#updating-and-uninstalling)
- [Standalone MCP Server](#standalone-mcp-server)
- [Development](#development)
- [Architecture](#architecture)
- [Security](#security)
- [License](#license)

## Features

- **Documents:** create a document (optionally with initial text), read it, list your documents, copy one, or move one to the Drive trash.
- **Content:** append text, insert text at a position, replace every occurrence of a phrase, or delete a range. Deletion can first check that the range still contains the text you expect.
- **Formatting:** bold, italic, underline, strikethrough, font family and size, text and highlight colors, Title, Subtitle and Heading 1–6 styles, and alignment.
- **Structure:** page breaks, tables, links, and bulleted, numbered or checkbox lists.
- **Search:** find documents by name or content, and find a phrase inside a document with its exact position.
- **Sign-in:** Google OAuth 2.0 with PKCE. Access tokens refresh automatically, and you can sign in or out by asking Claude.
- **Resource and prompts:** a `google-docs://document/{documentId}` resource with a document's text, plus prompts to summarize, rewrite and format a document or create meeting notes.

## Requirements

- **Claude Desktop** with extension support (macOS or Windows).
- **A Google account.**
- **A Google Cloud OAuth client.** It's free and takes about 10 minutes to create. See [Setup](#setup).

The extension runs on the Node.js runtime built into Claude Desktop and requires Node.js 22 or newer.

**Why do I need my own OAuth client?** Full Google Drive access is a _restricted_ Google scope. An app that shares one OAuth client with the public needs a paid Google security assessment. With your own client, your data only flows between your computer and Google, and you stay in control of the app that accesses your account.

## Installation (Claude Desktop)

1. Download `google-docs-mcp.mcpb` from the [latest release](https://github.com/ammarqaisar11a55/google-docs-mcp/releases/latest), or [build it yourself](#development).
2. Open **Claude Desktop → Settings → Extensions**.
3. Install the file. Either drag `google-docs-mcp.mcpb` into the Extensions window, or use **Advanced settings → Install Extension…** and choose the file. Double-clicking the file also opens the installer. Labels can differ slightly between Claude Desktop versions.
4. Review the extension details and click **Install**.
5. Claude Desktop asks for the extension settings. Complete [Setup](#setup) first to get your Client ID and Client secret.

## Setup

### 1. Create a Google OAuth client (once)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project, for example `google-docs-claude`.
2. Go to **APIs & Services → Library** and enable the **Google Docs API** and the **Google Drive API**.
3. Go to **APIs & Services → OAuth consent screen** (Google Auth Platform) and click **Get started**:
   - **Branding:** enter an app name and your email address.
   - **Audience:** choose **External**, and under **Test users** add the Google account you'll use.
   - **Data access** (optional): add the scopes listed under [Permissions](#permissions).
4. Go to **Clients → Create client** and choose **Application type: Desktop app**. A _Desktop app_ client is required.
5. Copy the **Client ID** and the **Client secret**.

### 2. Configure the extension

In **Settings → Extensions → Google Docs for Claude**, open the configuration and fill in:

| Setting                                      | Required | Description                                                                                                                         |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Google OAuth Client ID                       | yes      | Ends in `.apps.googleusercontent.com`.                                                                                              |
| Google OAuth Client secret                   | yes      | Stored securely by Claude Desktop as a sensitive value.                                                                             |
| Limit Drive access to this extension's files | no       | Least privilege. Drive operations (list, search, copy, trash) only see documents created or opened by this extension. Default: off. |
| Sign-in callback port                        | no       | Local port on `127.0.0.1` that receives the sign-in redirect. Default: `53682`. Change it only if another program uses the port.    |
| Debug logging                                | no       | Detailed diagnostic logs, with secrets always redacted. Default: off.                                                               |

Make sure the extension is **enabled**.

### 3. Sign in with Google

In a new chat, ask Claude:

```text
Sign in to Google.
```

Claude calls the `authenticate` tool, which opens a Google sign-in page in your browser and also shows the link in the chat. Choose your account and approve access.

While your OAuth app is in **Testing** status, Google shows a "Google hasn't verified this app" warning. That's expected for your own app: click **Advanced → Go to _app name_**. Afterwards, ask Claude to check the connection:

```text
Check my Google sign-in status.
```

To disconnect at any time, ask Claude to **sign out of Google**. That revokes access at Google and deletes the stored tokens.

## Available Tools

Every `documentId` parameter also accepts a full Google Docs URL.

| Tool                   | Description                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `get_auth_status`      | Check whether the extension is signed in to Google with the required permissions. Never returns tokens.               |
| `authenticate`         | Start Google sign-in and return the link to approve access.                                                           |
| `sign_out`             | Revoke Google access and delete the locally stored tokens.                                                            |
| `create_document`      | Create a new Google Doc, optionally with initial text (`title`, `initialContent?`).                                   |
| `get_document`         | Read a document's text and structure outline, including exact positions (`includeStructure?`, `maxTextLength?`).      |
| `list_documents`       | List your Google Docs, most recently modified first (`limit?`, `pageToken?`, `search?`).                              |
| `delete_document`      | Move a document to the Google Drive **trash**, where it can be restored for 30 days. Never deletes permanently.       |
| `copy_document`        | Copy a document under a new title (`newTitle`).                                                                       |
| `append_text`          | Append text to the end of a document (`text`, `startNewParagraph?`).                                                  |
| `insert_text`          | Insert text at a position (`index`, `text`).                                                                          |
| `replace_text`         | Replace every occurrence of a phrase (`searchText`, `replacementText`, `matchCase?`).                                 |
| `delete_text`          | Delete a range (`startIndex`, `endIndex`), optionally only if it still contains `expectedText`.                       |
| `format_text`          | Apply `bold`, `italic`, `underline`, `strikethrough`, `fontSize`, `fontFamily`, `foregroundColor`, `backgroundColor`. |
| `set_paragraph_style`  | Apply `NORMAL_TEXT`, `TITLE`, `SUBTITLE` or `HEADING_1` … `HEADING_6`.                                                |
| `set_alignment`        | Align paragraphs: `START`, `CENTER`, `END` or `JUSTIFIED`.                                                            |
| `insert_page_break`    | Insert a page break at a position.                                                                                    |
| `insert_table`         | Insert an empty table (`rows`, `columns`).                                                                            |
| `insert_link`          | Turn existing text into an `http`, `https` or `mailto` link.                                                          |
| `create_bulleted_list` | Turn paragraphs into a `bulleted`, `numbered` or `checkbox` list.                                                     |
| `search_documents`     | Search Google Docs by name, content or both (`query`, `searchIn?`, `limit?`, `pageToken?`).                           |
| `find_text`            | Find a phrase in a document and return the exact start and end position of each match.                                |

Every tool returns `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "retryable" } }`, and failures also set MCP's `isError` flag. The error codes are `NOT_AUTHENTICATED`, `AUTH_EXPIRED`, `INVALID_CREDENTIALS`, `CONFIG_ERROR`, `INVALID_DOCUMENT_ID`, `DOCUMENT_NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_INDEX`, `INVALID_ARGUMENT`, `INVALID_REQUEST`, `RATE_LIMITED`, `NETWORK_ERROR`, `GOOGLE_API_ERROR` and `INTERNAL_ERROR`.

**About positions.** Editing tools use Google Docs indexes: the body starts at index 1, and every insert or delete shifts the text after it. Claude gets exact positions from `get_document` or `find_text`, and applies several edits from the end of the document backwards.

**About search.** Name search matches words in a document's name that _start with_ your query. Content search uses Google Drive's full-text index, which matches words rather than arbitrary fragments and may take a while to include recent edits. Results only include Google Docs that aren't in the trash.

## Usage Examples

```text
Create a Google Doc called "Project Notes" with a short introduction to our Q4 goals.
```

```text
Find my document named "Semester Plan".
```

```text
Add this content to the end of my "Semester Plan" doc: Week 10 — final project presentations.
```

```text
Search my Google Docs for anything that mentions "budget".
```

```text
In "Project Notes", make "Q4 Goals" a Heading 1 and turn the lines under it into a bulleted list.
```

```text
Replace every "2025" with "2026" in my "Roadmap" document.
```

```text
Make every mention of "deadline" in "Semester Plan" bold and red.
```

```text
Summarize my "Meeting Notes 12 Sept" document.
```

```text
Make a copy of "Proposal Template" called "FYP Proposal".
```

```text
Move the "Old Draft" document to the trash.
```

## Permissions

The extension requests exactly two Google OAuth scopes.

| Scope                                                  | When                            | Why it is needed                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/documents`            | always                          | Create documents and read, edit and format their content through the Google Docs API. It applies to Google Docs you can access, which lets you point Claude at any document by URL or ID.                                                                                                                       |
| `https://www.googleapis.com/auth/drive`                | default                         | Drive operations on **all** your existing Docs: list and search (`list_documents`, `search_documents`), copy (`copy_document`), move to trash (`delete_document`), and check that a file is a Google Doc before changing it. Narrower Drive scopes can't list or search documents this extension didn't create. |
| `https://www.googleapis.com/auth/drive.file` (instead) | "Limit Drive access" setting on | Least privilege. The same Drive operations, but only for documents created or opened by this extension.                                                                                                                                                                                                         |

Other scopes were ruled out:

- `drive.readonly` and `drive.metadata.readonly` can't copy or trash documents.
- `drive.file` alone can't find the documents you already have, so it's offered as an option rather than the default.

After changing the "Limit Drive access" setting, sign in again. The extension reports missing permissions until you do.

## Troubleshooting

| Problem                                                         | Solution                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude says it isn't signed in (`NOT_AUTHENTICATED`)            | Ask Claude to "sign in to Google" and approve access. This is also needed after changing the OAuth client or the Drive access setting.                                                                                                |
| `AUTH_EXPIRED` about once a week                                | Google expires sign-ins after 7 days while the OAuth app's publishing status is **Testing**. Sign in again, or set the app to **In production** under Google Auth Platform → Audience. Personal use doesn't need Google verification. |
| `Error 403: access_denied` in the browser                       | Your Google account isn't a **test user** of the OAuth app. Add it under Google Auth Platform → Audience → Test users.                                                                                                                |
| `Error 400: redirect_uri_mismatch`                              | The OAuth client isn't of type **Desktop app**. Create a Desktop app client and update the settings.                                                                                                                                  |
| `INVALID_CREDENTIALS`                                           | The Client ID or Client secret is wrong or missing. Re-enter both in the extension settings.                                                                                                                                          |
| `CONFIG_ERROR: ... API is not enabled`                          | Enable both the **Google Docs API** and the **Google Drive API** in the project that owns your OAuth client, wait a minute, and retry.                                                                                                |
| `CONFIG_ERROR: The OAuth callback port ... is already in use`   | Change **Sign-in callback port** in the extension settings, for example to `53999`. Nothing needs to change in Google Cloud.                                                                                                          |
| The sign-in link doesn't work                                   | Open it on the same computer that runs Claude Desktop, within 5 minutes. Ask Claude to sign in again for a fresh link.                                                                                                                |
| Documents are missing from lists or searches                    | With "Limit Drive access" on, only documents created or opened by this extension are visible. Turn it off and sign in again. Recently edited documents can also take a moment to show up in content search.                           |
| `INVALID_INDEX`                                                 | The document changed since its positions were read. Ask Claude to re-read the document and try again.                                                                                                                                 |
| `RATE_LIMITED`                                                  | Google API quota exceeded. Wait a minute and retry.                                                                                                                                                                                   |
| The extension fails to start or reports Node.js as incompatible | The extension needs Node.js 22 or newer. Update Claude Desktop, or install Node.js 22+ and let Claude Desktop use it instead of its built-in runtime (Settings → Extensions → Advanced settings, where available).                    |
| Where are the logs?                                             | Claude Desktop keeps MCP server logs in its logs folder: `~/Library/Logs/Claude` on macOS, `%APPDATA%\Claude\logs` on Windows. Turn on **Debug logging** for more detail. Tokens and secrets are always redacted.                     |

## Updating and Uninstalling

**Updating.** Download the new `google-docs-mcp.mcpb` and install it the same way; Claude Desktop replaces the existing version. Your Google sign-in is stored outside the extension, so you normally don't need to sign in again.

**Uninstalling.**

1. Optional but recommended: ask Claude to **sign out of Google**. This revokes access and deletes the token file.
2. In **Settings → Extensions**, open **Google Docs for Claude** and choose **Uninstall**.
3. If you didn't sign out first, delete the token file (`~/.config/google-docs-mcp/tokens.json` on macOS and Linux, `%APPDATA%\google-docs-mcp\tokens.json` on Windows) and remove the app's access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## Standalone MCP Server

The same server runs without Claude Desktop, from any MCP client that supports stdio servers.

### Requirements

- Node.js 22.12 or newer.
- The Google OAuth client from [Setup](#1-create-a-google-oauth-client-once).

### Install and build

```bash
git clone https://github.com/ammarqaisar11a55/google-docs-mcp.git
cd google-docs-mcp
npm ci
npm run build
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable                      | Default                                 | Description                                                                                              |
| ----------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`            | –                                       | OAuth client ID (Desktop app). Required.                                                                 |
| `GOOGLE_CLIENT_SECRET`        | –                                       | OAuth client secret. Required.                                                                           |
| `GOOGLE_REDIRECT_URI`         | `http://127.0.0.1:53682/oauth2callback` | Loopback URL (`127.0.0.1`, `localhost` or `[::1]`) with an explicit port.                                |
| `GOOGLE_TOKEN_PATH`           | `~/.config/google-docs-mcp/tokens.json` | Token file location. On Windows the default is `%APPDATA%\google-docs-mcp\tokens.json`.                  |
| `GOOGLE_DRIVE_SCOPE`          | `drive`                                 | `drive` or `drive.file`. See [Permissions](#permissions).                                                |
| `GOOGLE_DRIVE_FILE_ONLY`      | `false`                                 | Boolean form of the same setting (`true` means `drive.file`). `GOOGLE_DRIVE_SCOPE` wins if both are set. |
| `LOG_LEVEL`                   | `info`                                  | `error`, `warn`, `info` or `debug`. Logs go to stderr.                                                   |
| `GOOGLE_DOCS_MCP_DEBUG`       | `false`                                 | `true` is a shortcut for `LOG_LEVEL=debug`.                                                              |
| `GOOGLE_DOCS_MCP_LOAD_DOTENV` | `true`                                  | Set to `false` to ignore `.env` files. The Claude Desktop extension does this.                           |

`.env` is read from the working directory and from the package root, and never overrides variables already set in the environment.

### Sign in and run

```bash
node dist/index.js auth
```

```bash
node dist/index.js status
```

Other commands: `node dist/index.js logout` signs out, `npm start` runs the server, and `npm run dev` runs it with automatic restarts. You can also sign in from the AI client with the `authenticate` tool.

### Connect an MCP client

**Claude Code**

```bash
claude mcp add google-docs -- node /absolute/path/to/google-docs-mcp/dist/index.js
```

**Claude Desktop (manual configuration instead of the extension), Cursor and other clients** that use the `mcpServers` format:

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/absolute/path/to/google-docs-mcp/dist/index.js"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "google-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/google-docs-mcp/dist/index.js"]
    }
  }
}
```

With credentials in `<repo>/.env`, no `env` block is needed. To see every tool interactively, use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Development

```bash
npm ci                  # install dependencies from the lockfile
npm run dev             # run the server from source with automatic restarts
npm test                # unit tests (Google APIs mocked) and the stdio integration test
npm run typecheck       # type-check sources, tests and scripts
npm run lint            # ESLint (strict, type-aware)
npm run format          # Prettier
npm run build           # compile to dist/ (standalone server)
npm run package         # build the Claude Desktop extension: build/google-docs-mcp.mcpb
npm run package:check   # verify the .mcpb: contents, secrets, and a real launch
npm run validate:manifest  # validate manifest.json with the official mcpb CLI
```

`npm run package` does the following:

1. Compiles the server into `build/bundle` without source maps.
2. Installs only the production dependencies from `package-lock.json` (`npm ci --omit=dev --ignore-scripts`).
3. Validates `manifest.json` and packs the folder with Anthropic's official [`@anthropic-ai/mcpb`](https://github.com/anthropics/mcpb) packer.

The result has no development dependencies, sources, tests or secrets, and needs nothing installed on the user's machine.

`npm run package:check` does the following:

1. Unpacks the bundle into a temporary folder.
2. Validates the manifest.
3. Checks that every runtime dependency is present, and rejects source files, source maps, development dependencies, `.env` files, token files and anything that looks like a secret.
4. Starts the bundled server outside the repository, with the same launch configuration Claude Desktop derives from `manifest.json`.
5. Checks the tools, prompts, resources and sign-in state over MCP.

**Optional real-account tests.** These create, edit and trash real documents, so use a test account:

```bash
RUN_GOOGLE_INTEGRATION_TESTS=true npm run test:integration
```

**Releases.** Bump `version` in both `package.json` and `manifest.json` (a unit test enforces that they match), update `CHANGELOG.md`, then push a `vX.Y.Z` tag. The [release workflow](.github/workflows/release.yml) runs every check, builds and verifies the `.mcpb`, and attaches it to the GitHub release. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

```text
Claude Desktop
    │  installs google-docs-mcp.mcpb, stores the settings (client secret as a sensitive value)
    │  and launches: node ${__dirname}/dist/index.js with the settings as environment variables
    ▼
MCP server (stdio, @modelcontextprotocol/server v2)   ← also usable standalone: node dist/index.js
    │
    ├── Tools / Resource / Prompts        src/tools, src/resources, src/prompts
    │        ▼
    ├── Services (validation, business logic)   src/services
    │        ▼
    ├── Google API clients                src/google  (@googleapis/docs, @googleapis/drive)
    │        ▲
    └── Google OAuth 2.0                  src/auth
             │  authorization code + PKCE, loopback redirect on 127.0.0.1
             │  tokens in a local 0600 file, refreshed automatically
             ▼
      Google Docs API  ·  Google Drive API
```

```text
google-docs-mcp/
├── manifest.json          # Claude Desktop extension manifest (MCPB 0.3)
├── assets/icon.png        # Extension icon
├── src/                   # Server source (TypeScript)
├── scripts/               # package-mcpb.ts, verify-mcpb.ts
├── tests/                 # Unit and integration tests
└── .github/workflows/     # CI and release
```

## Security

- **No secrets in the code or the package.** The OAuth Client ID and secret come from the extension settings, where Claude Desktop stores the secret as a sensitive value, or from environment variables in standalone mode. `npm run package:check` fails if a `.env`, token or credentials file, or a token-like string, ends up in the bundle.
- **OAuth 2.0 done properly.**
  - Sign-in uses the authorization-code flow with PKCE (S256) and a random `state` that is checked in constant time.
  - The redirect only goes to a loopback address.
  - The temporary callback server exists only during sign-in (at most 5 minutes).
- **Token storage.**
  - Refresh and access tokens are created at runtime, and MCPB offers no host storage for runtime-generated secrets. So they are stored in a local file (`tokens.json`) with mode `0600` inside a `0700` folder, written atomically.
  - Tokens are only sent to Google, never returned by any tool, and are bound to the OAuth client that issued them.
  - `sign_out` revokes the grant at Google and deletes the file.
- **No token logging.** Logs go to stderr only; stdout is reserved for MCP. Tokens, client secrets, authorization codes and `Authorization` headers are redacted, tool arguments (which may contain document content) are never logged, and library stack traces are never logged or returned.
- **Safe errors.** Tool errors carry a stable code and a readable, actionable message without secrets, stack traces or file paths.
- **Input validation.** Every tool has a strict schema that rejects unknown arguments. Document IDs and URLs must match a strict pattern, positions are checked against the live document before writing, link URLs must be `http`, `https` or `mailto`, and Drive search input is escaped.
- **Safe edits.** `delete_document` only moves Google Docs files to the trash. `delete_text` can verify the text it is about to delete. Writes use `targetRevisionId`, so concurrent edits by collaborators don't shift positions onto the wrong text.
- **Settings isolation.** The extension ignores `.env` files, so a stray file can't change its configuration. An invalid configuration doesn't crash the server: tools report exactly what to fix.
- **Dependencies.** Only five runtime dependencies (the MCP SDK, Google's official API clients and auth library, and zod). The bundle is installed from the lockfile with install scripts disabled, and `npm audit` reports no known vulnerabilities at the time of release.

## License

[MIT](LICENSE) © Muhammad Ammar Qaisar
