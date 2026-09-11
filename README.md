# Google Docs MCP

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets MCP-compatible AI clients (Claude Desktop, Claude Code, VS Code, Cursor and others) work with your Google Docs. It can create, read, edit, format, organize and search documents through the official Google Docs API and Google Drive API.

You sign in once with Google OAuth 2.0. After that, you can say things like _"Create a document called FYP Proposal and add the following content…"_, and the AI client calls this server's tools to do it. You don't have to open the Google Docs UI.

It is written in strict TypeScript on Node.js and uses the official MCP TypeScript SDK (v2) over the stdio transport.

---

## Features

- **Google OAuth 2.0 sign-in.** Uses the authorization-code flow with PKCE (S256), a CSRF `state` check and a loopback redirect. Access tokens refresh automatically. Tokens are stored locally in a file only you can read, and re-authentication is guided when needed.
- **Document management.** Create, read, list, copy and delete documents. Delete moves a document to the Drive trash; nothing is ever permanently deleted.
- **Content editing.** Append, insert at an index, find-and-replace, and delete a range. A delete can include an optional `expectedText` safety check.
- **Formatting.** Bold, italic, underline, strikethrough, font size and family, text and highlight colors, named paragraph styles (Title, Subtitle, Heading 1–6), and alignment.
- **Structure.** Page breaks, tables, hyperlinks, and bulleted, numbered or checkbox lists.
- **Search.** Find Docs by file name and/or full-text content (`search_documents`), or get exact indexes of a phrase inside a document (`find_text`).
- **MCP resources.** `google-docs://document/{documentId}` exposes a document's plain text.
- **MCP prompts.** `summarize_document`, `rewrite_document`, `format_document`, `create_meeting_notes`.
- **Predictable results.** Every tool returns JSON `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "retryable" } }`. Error codes are stable.
- **Friendly inputs.** Every tool accepts either a document ID or a full Google Docs URL.
- **Secure by default.** Least-privilege scope option, strict input validation, redaction of secrets in logs and errors, and index validation before any write.

## Architecture

```text
MCP Client (Claude Desktop, Claude Code, VS Code, Cursor, ...)
    │
    │  MCP (JSON-RPC over stdio)
    ▼
MCP Server  ── McpServer from @modelcontextprotocol/server v2, served with serveStdio
    │
    ├── Authentication        src/auth
    │     ├── GoogleAuthManager   OAuth 2.0 + PKCE, loopback redirect, token refresh
    │     └── TokenManager        tokens.json (0600, atomic writes)
    │
    ├── MCP Tools / Resources / Prompts   src/tools, src/resources, src/prompts
    │     │   (zod-validated input, uniform { success, data | error } results)
    │     ▼
    │   Services (business logic)         src/services
    │     │   index validation, Drive query building, document parsing
    │     ▼
    └── Google API Clients                src/google (DocsClient, DriveClient)
             │
       ┌─────┴─────┐
       ▼           ▼
 Google Docs   Google Drive
```

- **Tools** only declare schemas and descriptions, then delegate to services.
- **Services** hold the business logic and depend on small `DocsClient` / `DriveClient` interfaces. This lets unit tests replace Google entirely.
- **Google API clients** are thin wrappers around `@googleapis/docs` and `@googleapis/drive`. They get an authorized OAuth2 client from the auth layer for every call.
- **stdout is reserved for the MCP protocol.** All logs go to stderr as JSON lines.

## Requirements

- **Node.js 22.12 or newer** (`node --version`).
- **A Google Cloud project** (free) in the [Google Cloud Console](https://console.cloud.google.com/).
- **Google Docs API** enabled in that project.
- **Google Drive API** enabled in that project.
- **An OAuth 2.0 client ID of type "Desktop app"**, with its client secret. See [Google OAuth Setup](#google-oauth-setup).
- An MCP-compatible client.

## Installation

```bash
git clone https://github.com/ammarqaisar11a55/google-docs-mcp.git
cd google-docs-mcp
npm install
npm run build
```

The build writes the compiled server to `dist/index.js`. MCP clients need the absolute path to this file.

## Configuration

The server is configured with environment variables. Copy the example file and fill in your OAuth client:

```bash
cp .env.example .env
```

```env
GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:53682/oauth2callback
# GOOGLE_TOKEN_PATH=
# GOOGLE_DRIVE_SCOPE=drive
# LOG_LEVEL=info
```

| Variable                        | Required | Default                                 | Description                                                                                                                                                                                                                                                                                                |
| ------------------------------- | -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`              | yes      | –                                       | OAuth client ID of your **Desktop app** client.                                                                                                                                                                                                                                                            |
| `GOOGLE_CLIENT_SECRET`          | yes      | –                                       | OAuth client secret of that client.                                                                                                                                                                                                                                                                        |
| `GOOGLE_REDIRECT_URI`           | no       | `http://127.0.0.1:53682/oauth2callback` | Loopback address where the one-time sign-in redirect is received. It must be `http://` on `127.0.0.1`, `localhost` or `[::1]`, with an explicit port. Desktop-app clients accept any loopback port, so you don't need to register it in Google Cloud. Change the port if 53682 is in use.                  |
| `GOOGLE_TOKEN_PATH`             | no       | `~/.config/google-docs-mcp/tokens.json` | Where OAuth tokens are stored. `~` is expanded, and relative paths resolve against the working directory, so prefer absolute paths. Default on Linux/macOS: `$XDG_CONFIG_HOME/google-docs-mcp/tokens.json` (falling back to `~/.config/...`). Default on Windows: `%APPDATA%\google-docs-mcp\tokens.json`. |
| `GOOGLE_DRIVE_SCOPE`            | no       | `drive`                                 | Drive permission level. `drive` gives full Drive access and is needed to list, search, copy and trash **all** your existing Docs. `drive.file` is least privilege: Drive operations only see files created or opened by this app. See [Security](#security).                                               |
| `LOG_LEVEL`                     | no       | `info`                                  | `error`, `warn`, `info` or `debug`. Logs go to stderr, and secrets are always redacted.                                                                                                                                                                                                                    |
| `RUN_GOOGLE_INTEGRATION_TESTS`  | no       | –                                       | Tests only. Set to `true` to enable the optional real-account integration tests.                                                                                                                                                                                                                           |
| `GOOGLE_INTEGRATION_TOKEN_PATH` | no       | –                                       | Tests only. Token file of the Google test account used by the integration tests.                                                                                                                                                                                                                           |

Notes:

- The server reads a `.env` file from the **current working directory** and from the **package root** (the folder that contains `dist/`). Values from `.env` **never override** variables already set in the real environment, for example variables set in your MCP client's `env` block. This means you can keep your credentials in `<repo>/.env` and leave them out of client configs.
- Blank values (`GOOGLE_DRIVE_SCOPE=`) count as unset.
- Invalid values (for example `LOG_LEVEL=verbose`, or a non-loopback redirect URI) stop startup with a `CONFIG_ERROR`. Error messages never include the configured values.
- `.env`, `tokens.json` and `client_secret*.json` are git-ignored. Never commit them.

## Google OAuth Setup

You only do this once. The console labels below match the current Google Cloud Console, where the OAuth consent screen now lives under **Google Auth Platform**.

1. **Create a project.**
   Open the [Google Cloud Console](https://console.cloud.google.com/), click the project picker in the top bar, and choose **New project**. Give it a name (for example `google-docs-mcp`), click **Create**, and make sure the new project is selected.

2. **Enable the APIs.**
   Go to **APIs & Services → Library**. Search for **Google Docs API** and click **Enable**. Then search for **Google Drive API** and click **Enable**. Both are required.

3. **Configure the OAuth consent screen (Google Auth Platform).**
   Go to **APIs & Services → OAuth consent screen** (this opens **Google Auth Platform**) and click **Get started** if prompted.
   - **Branding:** enter an app name (for example `Google Docs MCP`), a user support email and a developer contact email, then save.
   - **Audience:** choose **External**. This is the usual choice for a personal Gmail account; Google Workspace users may choose **Internal**. While the app's publishing status is **Testing**, open **Test users**, click **Add users**, and **add your own Google account**. Only test users can sign in.
   - **Data access:** click **Add or remove scopes** and add:
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/drive`, or `https://www.googleapis.com/auth/drive.file` if you set `GOOGLE_DRIVE_SCOPE=drive.file`

     Then save.

4. **Create the OAuth client ID.**
   Go to **Google Auth Platform → Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**). Click **Create client**, set **Application type** to **Desktop app**, give it a name, and click **Create**.

5. **Copy the credentials.**
   Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your `.env`. Store the secret safely right away: the console may not show it again, and you may have to create a new secret.

Good to know:

- **"Google hasn't verified this app."** While your app is unverified, Google shows this warning during sign-in. Because it is your own app, click **Advanced → Go to _App name_ (unsafe)** and continue. Personal use does not need verification.
- **Refresh tokens expire after 7 days in Testing status.** If the publishing status is **Testing** and you request the scopes above, Google expires the refresh token after 7 days. After that, tools fail with `AUTH_EXPIRED` and you need to sign in again. To avoid weekly re-authentication, switch the app to **In production** under **Audience**. Unverified production apps still show the warning screen and are limited in the number of users, which is fine for personal use.
- A **Desktop app** client is required. A **Web application** client needs every redirect URI registered exactly and causes `redirect_uri_mismatch`.

## Authentication

Sign in once. The server stores a refresh token and renews access tokens automatically.

**From a terminal** (recommended the first time):

```bash
npm run auth                # runs the TypeScript sources through tsx
# or, after `npm run build`:
node dist/index.js auth
```

This prints a Google sign-in URL and tries to open it in your browser. Approve access, and the browser redirects to the local loopback address, which completes the sign-in. The link is valid for 5 minutes.

Other commands:

```bash
node dist/index.js status   # show sign-in status, granted scopes and token expiry (never prints tokens)
node dist/index.js logout   # revoke access at Google and delete the local token file
node dist/index.js --help
```

If you install the package globally or with `npm link`, the same commands are available as `google-docs-mcp auth`, `google-docs-mcp status` and `google-docs-mcp logout`.

**From the AI client:** ask your assistant to sign in to Google. It calls the `authenticate` tool, which returns an `authUrl` (and tries to open it in your browser). Open the URL on **the same computer that runs the server**, approve access, then have the assistant call `get_auth_status` to confirm. The `sign_out` tool revokes access and deletes the stored tokens.

**Where tokens are stored:** in `GOOGLE_TOKEN_PATH`, which defaults to `~/.config/google-docs-mcp/tokens.json` (or `%APPDATA%\google-docs-mcp\tokens.json` on Windows). The file is created with mode `0600` inside a `0700` directory and written atomically. If you change `GOOGLE_DRIVE_SCOPE` from `drive.file` to `drive`, sign in again: tools report `NOT_AUTHENTICATED` with `details.missingScopes` until you do.

## Running

```bash
# Development: run the TypeScript sources with automatic restarts
npm run dev

# Production: compile once, then run the compiled server
npm run build
npm start          # = node dist/index.js
```

The server speaks MCP over **stdio**. It is normally started by your MCP client (see below), not by hand. When you run it manually it waits silently for an MCP client on stdin, and its logs appear on stderr. To explore the tools interactively, you can use the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## MCP Client Configuration

Replace `/abs/path/to/google-docs-mcp` with the absolute path of your clone. On Windows, use forward slashes or escaped backslashes in JSON (`C:/Users/you/google-docs-mcp/dist/index.js`).

If your credentials are in `<repo>/.env`, you can leave out the `env` blocks below: the server loads `.env` from its package root.

### Claude Desktop

Edit `claude_desktop_config.json`. Open it from **Settings → Developer → Edit Config**. It is located at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/abs/path/to/google-docs-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "123456789012-abc123.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "GOCSPX-your-client-secret"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code

```bash
claude mcp add google-docs \
  -e GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com \
  -e GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret \
  -- node /abs/path/to/google-docs-mcp/dist/index.js
```

Add `--scope project` to share the server with your team through a project-level `.mcp.json`, or `--scope user` to make it available in all your projects. You can also write `.mcp.json` in the project root by hand:

```json
{
  "mcpServers": {
    "google-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/google-docs-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "${GOOGLE_CLIENT_ID}",
        "GOOGLE_CLIENT_SECRET": "${GOOGLE_CLIENT_SECRET}"
      }
    }
  }
}
```

`${VAR}` placeholders are expanded from your shell environment, so secrets stay out of the committed file. Check the server with `claude mcp list` or `/mcp` inside Claude Code.

### VS Code (GitHub Copilot agent mode)

Create `.vscode/mcp.json` in your workspace. VS Code uses a top-level **`servers`** key:

```json
{
  "servers": {
    "google-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["/abs/path/to/google-docs-mcp/dist/index.js"],
      "envFile": "/abs/path/to/google-docs-mcp/.env"
    }
  }
}
```

You can use `"env": { ... }` instead of `envFile`, or keep secrets out of the file with VS Code `inputs` (`"type": "promptString", "password": true`).

### Cursor

Edit `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "node",
      "args": ["/abs/path/to/google-docs-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "123456789012-abc123.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "GOCSPX-your-client-secret"
      }
    }
  }
}
```

Any other client that supports stdio MCP servers works the same way: run `node /abs/path/to/google-docs-mcp/dist/index.js`.

## Available Tools

Every `documentId` parameter also accepts a full Google Docs URL (`https://docs.google.com/document/d/<ID>/edit`). Optional parameters are marked with `?`.

| Tool                   | Description                                                                                                                | Key parameters                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_auth_status`      | Report whether the server is signed in and has the required scopes. Never returns tokens.                                  | –                                                                                                                                                              |
| `authenticate`         | Start the Google OAuth sign-in and return the `authUrl` to open. Does nothing if already signed in, unless `force` is set. | `force?`, `openBrowser?`                                                                                                                                       |
| `sign_out`             | Revoke access at Google and delete the stored tokens.                                                                      | –                                                                                                                                                              |
| `create_document`      | Create a new, empty Google Doc and return its ID, title and URL.                                                           | `title`                                                                                                                                                        |
| `get_document`         | Read a document: title, URL, plain text, `bodyEndIndex` and a structure outline with exact indexes.                        | `documentId`, `includeStructure?`, `maxTextLength?`                                                                                                            |
| `list_documents`       | List Google Docs, most recently modified first, optionally filtered by name.                                               | `limit?` (1–100, default 20), `pageToken?`, `search?`                                                                                                          |
| `delete_document`      | Move a document to the Drive **trash** (restorable for 30 days). Only Google Docs files are accepted.                      | `documentId`                                                                                                                                                   |
| `copy_document`        | Copy a document, with its content and formatting, under a new title.                                                       | `documentId`, `newTitle`                                                                                                                                       |
| `append_text`          | Append text to the end of a document.                                                                                      | `documentId`, `text`, `startNewParagraph?`                                                                                                                     |
| `insert_text`          | Insert text at a specific index.                                                                                           | `documentId`, `index`, `text`                                                                                                                                  |
| `replace_text`         | Replace every occurrence of a text in the document.                                                                        | `documentId`, `searchText`, `replacementText`, `matchCase?`                                                                                                    |
| `delete_text`          | Delete the text in `[startIndex, endIndex)`, optionally only if it matches `expectedText`.                                 | `documentId`, `startIndex`, `endIndex`, `expectedText?`                                                                                                        |
| `format_text`          | Apply character formatting to a range. Only the attributes you specify are changed.                                        | `documentId`, `startIndex`, `endIndex`, `bold?`, `italic?`, `underline?`, `strikethrough?`, `fontSize?`, `fontFamily?`, `foregroundColor?`, `backgroundColor?` |
| `set_paragraph_style`  | Apply a named paragraph style to the paragraphs in a range.                                                                | `documentId`, `startIndex`, `endIndex`, `style`: `NORMAL_TEXT` \| `TITLE` \| `SUBTITLE` \| `HEADING_1` … `HEADING_6`                                           |
| `set_alignment`        | Set paragraph alignment for a range.                                                                                       | `documentId`, `startIndex`, `endIndex`, `alignment`: `START` \| `CENTER` \| `END` \| `JUSTIFIED`                                                               |
| `insert_page_break`    | Insert a page break at an index.                                                                                           | `documentId`, `index`                                                                                                                                          |
| `insert_table`         | Insert an empty table at an index.                                                                                         | `documentId`, `index`, `rows`, `columns`                                                                                                                       |
| `insert_link`          | Turn a range of existing text into a hyperlink (`http`, `https` or `mailto` only).                                         | `documentId`, `startIndex`, `endIndex`, `url`                                                                                                                  |
| `create_bulleted_list` | Turn the paragraphs in a range into a list.                                                                                | `documentId`, `startIndex`, `endIndex`, `listType?`: `bulleted` \| `numbered` \| `checkbox`                                                                    |
| `search_documents`     | Search Google Docs by file name, full-text content, or both.                                                               | `query`, `limit?`, `searchIn?`: `name` \| `content` \| `both`, `pageToken?`                                                                                    |
| `find_text`            | Find a phrase inside a document and return the exact start/end index of each match.                                        | `documentId`, `text`, `matchCase?`, `maxResults?`                                                                                                              |

Colors (`foregroundColor`, `backgroundColor`) are hex strings such as `#1A73E8` or `#fff`.

### Results and errors

Successful calls return:

```json
{
  "success": true,
  "data": {
    "documentId": "1AbC…",
    "title": "FYP Proposal",
    "url": "https://docs.google.com/document/d/1AbC…/edit"
  }
}
```

Failed calls set the MCP `isError` flag and return:

```json
{
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The Google Docs document could not be found or you do not have access to it.",
    "retryable": false
  }
}
```

Some errors include a `details` object, for example the valid index range for `INVALID_INDEX`, or `missingScopes`.

| Code                  | Meaning                                                                                                                      | Retryable |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- |
| `NOT_AUTHENTICATED`   | Not signed in, sign-in was cancelled, or the stored grant lacks required scopes. Call `authenticate`.                        | no        |
| `AUTH_EXPIRED`        | The access token or refresh token expired or was revoked (`invalid_grant`). Sign in again.                                   | no        |
| `INVALID_CREDENTIALS` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing, or Google rejected them.                                            | no        |
| `CONFIG_ERROR`        | Invalid configuration, a Google API not enabled in the Cloud project, the callback port in use, or an unreadable token file. | no        |
| `INVALID_DOCUMENT_ID` | The document ID or URL is malformed. It is rejected before any request is sent.                                              | no        |
| `DOCUMENT_NOT_FOUND`  | The document doesn't exist, or you don't have access to it.                                                                  | no        |
| `PERMISSION_DENIED`   | You can't perform this operation on the document, or the granted scopes don't allow it.                                      | no        |
| `INVALID_INDEX`       | An index or range lies outside the document body.                                                                            | no        |
| `INVALID_ARGUMENT`    | Invalid tool arguments: wrong type or range, bad color or URL, not a Google Doc, and so on.                                  | no        |
| `INVALID_REQUEST`     | Google rejected the request (HTTP 400). The message includes Google's explanation.                                           | no        |
| `RATE_LIMITED`        | Google API rate limit or quota exceeded. Wait and retry.                                                                     | yes       |
| `NETWORK_ERROR`       | Google APIs could not be reached, or the request timed out.                                                                  | yes       |
| `GOOGLE_API_ERROR`    | Google returned an unexpected or server-side (5xx) error.                                                                    | yes       |
| `INTERNAL_ERROR`      | An unexpected error inside the server. Details are only in the server logs.                                                  | no        |

## Resources and Prompts

**Resource template**

| URI                                   | Content                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `google-docs://document/{documentId}` | The document's current plain text (`text/plain`). Clients can attach a document as context without calling a tool. |

**Prompts.** These are reusable instructions. The AI does the writing, and the server only provides Google Docs access.

| Prompt                 | Purpose                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `summarize_document`   | Read a document and produce a summary.                                                                     |
| `rewrite_document`     | Rewrite a document's content (for example in a different tone), applying the edits with the content tools. |
| `format_document`      | Give a document a clean structure: headings, lists and consistent alignment.                               |
| `create_meeting_notes` | Create a new meeting-notes document from a template.                                                       |

## Understanding indexes

Index-based tools (`insert_text`, `delete_text`, `format_text`, `set_paragraph_style`, `set_alignment`, `insert_page_break`, `insert_table`, `insert_link`, `create_bulleted_list`) use Google Docs indexes:

- The document body **starts at index 1**. Index 0 is a section break.
- Indexes are **UTF-16 code units**, the same as JavaScript string offsets. Most characters count as 1, but emoji and other astral-plane characters count as 2. Tables, images and other objects also take up index positions.
- Ranges are half-open, `[startIndex, endIndex)`. Valid insertion indexes are `1 … bodyEndIndex - 1`. The final newline of the body can never be deleted.
- **Every insert or delete shifts all indexes after it.** When you make several index-based edits, work **from the end of the document towards the beginning**, or re-read the document between edits.
- Use `get_document` (the `structure` outline and `bodyEndIndex`) or `find_text` to get exact indexes. Don't guess them. `append_text` and `replace_text` don't need indexes at all.
- Indexes are validated against the current document before anything is sent to Google (`INVALID_INDEX`). Writes use the document's `revisionId` as `targetRevisionId`. If a collaborator edits the document at the same moment, Google adjusts the indexes for you instead of applying them to the wrong text.

## Search limitations

Google Drive has two different search modes, and they behave differently:

| Mode                 | Used by                                                              | Behaviour                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name search**      | `list_documents` (`search`), `search_documents` (`searchIn: "name"`) | Drive `name contains '…'`. Case-insensitive and matches the **file name only**. Drive matches from the start of words, so `Proposal` finds "FYP Proposal", but a fragment from the middle of a word may not match.                                              |
| **Full-text search** | `search_documents` (`searchIn: "content"`)                           | Drive `fullText contains '…'`. Searches the indexed **content** (and name) of documents and matches whole words or phrases rather than arbitrary substrings. Results are ordered by relevance. Recently created or edited documents can take a while to appear. |
| **Both**             | `search_documents` (`searchIn: "both"`)                              | Either condition matches.                                                                                                                                                                                                                                       |

- Search results only include **Google Docs** that are **not in the trash**.
- With `GOOGLE_DRIVE_SCOPE=drive.file`, Drive only returns documents created or opened by this app.
- To locate text **inside** a known document, with exact indexes for editing, use `find_text`.

## Security

- **Least-privilege scopes.** The server requests `https://www.googleapis.com/auth/documents` plus one Drive scope. Set `GOOGLE_DRIVE_SCOPE=drive.file` to limit Drive operations (list, search, copy, trash) to files created or opened by this app. The default `drive` scope is only needed to discover and manage **all** your existing documents.
- **Secure token storage.** Tokens live in a local JSON file created with mode `0600` in a `0700` directory. The file is written atomically, never sent anywhere except Google, and deleted by `sign_out` / `logout`, which also revoke the grant at Google.
- **PKCE + state.** Sign-in uses the OAuth 2.0 authorization-code flow with PKCE (S256) and a random `state` value that is compared in constant time. Forged callbacks are rejected.
- **Loopback-only redirect.** The redirect URI must be `http://127.0.0.1`, `localhost` or `[::1]` with an explicit port. The temporary callback server only listens on that address, only for the duration of the sign-in (at most 5 minutes), and shuts down afterwards.
- **No secret logging.** Logs go to stderr only. Sensitive fields (`access_token`, `refresh_token`, `client_secret`, authorization codes, `Authorization` headers and similar) are redacted. Token patterns inside messages are scrubbed too. Stack traces of library errors are never logged.
- **Safe error messages.** Tool errors carry a stable code and a human-readable message. They never include tokens, secrets, stack traces or file-system paths, and Google's messages are redacted before they are returned.
- **Trash, never delete.** `delete_document` only moves Google Docs files to the Drive trash, and refuses other file types. Nothing is permanently deleted.
- **Concurrent-edit safety.** Index-based writes are validated against the current document and sent with `targetRevisionId`.
- **Input validation.** Every tool has a strict zod schema, and unknown arguments are rejected. Document IDs and URLs are checked against a strict pattern, which blocks path or query injection. Drive search input is escaped so it can't break out of the query. Link URLs must be `http`, `https` or `mailto`. Index ranges are checked before writing.
- **No hard-coded credentials.** Client ID and secret come only from the environment or `.env`.

## Testing

```bash
npm test                 # all unit tests (Google APIs are mocked; no credentials or network needed)
npm run test:watch       # watch mode
```

Unit tests replace the Google API clients and the OAuth client with fakes, and run the MCP tools through a real MCP client over an in-memory transport. Test runs point `GOOGLE_TOKEN_PATH` at a non-existent file, so they never touch your real tokens.

**Optional integration tests against a real Google account.** Use a dedicated test account, because these tests create and modify real documents.

```bash
# 1. Sign the test account in and store its tokens in a separate file
GOOGLE_TOKEN_PATH=/abs/path/test-account-tokens.json npm run auth

# 2. Run the integration tests with that token file
RUN_GOOGLE_INTEGRATION_TESTS=true \
GOOGLE_INTEGRATION_TOKEN_PATH=/abs/path/test-account-tokens.json \
npm run test:integration
```

Without `RUN_GOOGLE_INTEGRATION_TESTS=true`, the integration tests are skipped. They also need `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (from the environment or `.env`). If `GOOGLE_INTEGRATION_TOKEN_PATH` is not set, they use the default token path. Every document they create is moved to the Drive trash afterwards.

## Development scripts

| Script                     | What it does                                                |
| -------------------------- | ----------------------------------------------------------- |
| `npm run build`            | Compile TypeScript to `dist/`.                              |
| `npm run dev`              | Run the server from source with `tsx watch` (auto-restart). |
| `npm start`                | Run the compiled server (`node dist/index.js`).             |
| `npm run auth`             | Sign in with Google from the terminal (runs from source).   |
| `npm run typecheck`        | Type-check sources and tests without emitting.              |
| `npm run lint`             | Run ESLint (strict, type-aware rules).                      |
| `npm run lint:fix`         | Run ESLint and fix what it can.                             |
| `npm run format`           | Format the code with Prettier.                              |
| `npm run format:check`     | Check formatting without writing.                           |
| `npm test`                 | Run the unit tests with Vitest.                             |
| `npm run test:watch`       | Run Vitest in watch mode.                                   |
| `npm run test:integration` | Run the optional real-account integration tests.            |

## Troubleshooting

| Problem                                                                                   | Cause and fix                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Error 400: redirect_uri_mismatch`**                                                    | The OAuth client is not a **Desktop app** client (Web clients need exact registered redirect URIs), or `GOOGLE_REDIRECT_URI` is not a loopback URL. Create a Desktop app client and keep the default `http://127.0.0.1:53682/oauth2callback`.                                                                        |
| **`Error 403: access_denied`** / "has not completed the Google verification process"      | Your account is not a **test user** of an app in Testing status. Add it under **Google Auth Platform → Audience → Test users**. If you clicked **Cancel** on the consent screen, run the sign-in again.                                                                                                              |
| **`AUTH_EXPIRED`** / `invalid_grant`                                                      | The refresh token expired or was revoked. In **Testing** status, refresh tokens expire after **7 days**. Changing your password or removing the app's access also revokes them. Run `npm run auth` (or the `authenticate` tool) again. Consider moving the app to **In production** to stop the weekly expiry.       |
| **`CONFIG_ERROR`: "The Google Docs API or Google Drive API is not enabled"**              | Enable **both** APIs in **APIs & Services → Library** for the project that owns your OAuth client, wait a minute or two, and retry.                                                                                                                                                                                  |
| **`CONFIG_ERROR`: "The OAuth callback port 53682 is already in use"**                     | Another process (or another sign-in) is using the port. Close it, or pick another port, for example `GOOGLE_REDIRECT_URI=http://127.0.0.1:53999/oauth2callback`. You don't need to change anything in Google Cloud.                                                                                                  |
| **`INVALID_CREDENTIALS`**                                                                 | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are not visible to the server, for example because the MCP client does not pass them, or Google rejected them. Put them in the client's `env` block or in `<repo>/.env`, and check for copy/paste errors.                                                                |
| **`NOT_AUTHENTICATED` with `missingScopes`**                                              | The stored grant lacks a required scope, for example after switching `GOOGLE_DRIVE_SCOPE` from `drive.file` to `drive`. Sign in again and approve all requested permissions.                                                                                                                                         |
| **Documents are missing or `DOCUMENT_NOT_FOUND` / `PERMISSION_DENIED` with `drive.file`** | With `GOOGLE_DRIVE_SCOPE=drive.file`, Drive only exposes files created or opened by this app, so listing, searching, copying or trashing other documents fails. Use `GOOGLE_DRIVE_SCOPE=drive` and sign in again, or accept the restriction. Also check that the document is shared with your account.               |
| **`INVALID_INDEX`**                                                                       | The index is outside `1 … bodyEndIndex - 1`, or the document changed since the indexes were computed. Re-read with `get_document` or `find_text`, and apply multiple edits from the end of the document backwards.                                                                                                   |
| **`RATE_LIMITED`**                                                                        | Google API quota exceeded (per-minute limits). Read requests are retried automatically with backoff; wait a moment before retrying writes. You can see quotas under **APIs & Services → Quotas**.                                                                                                                    |
| **The client shows "invalid JSON" / the connection drops**                                | stdout is reserved for MCP protocol messages. Don't add `console.log` or anything else that writes to stdout. The server writes all logs (JSON lines) and CLI output to **stderr**. Set `LOG_LEVEL=debug` and check your client's MCP log, for example `~/Library/Logs/Claude/mcp*.log` for Claude Desktop on macOS. |
| **Server doesn't start**                                                                  | Check `node --version` (22.12 or newer is required), that `npm run build` produced `dist/index.js`, and that the path in your client config is absolute. Run `node /abs/path/to/google-docs-mcp/dist/index.js status` in a terminal to see configuration errors.                                                     |
| **The sign-in link doesn't work**                                                         | The `authUrl` must be opened on the machine that runs the server, because Google redirects to `127.0.0.1` there. It also expires after 5 minutes: call `authenticate` again.                                                                                                                                         |

## Project structure

```text
google-docs-mcp/
├── src/
│   ├── index.ts              # CLI entry point: stdio server, `auth`, `status`, `logout`
│   ├── server.ts             # Builds the McpServer and registers tools, resources, prompts
│   ├── config/config.ts      # Environment configuration and validation
│   ├── auth/
│   │   ├── google-auth.ts    # OAuth 2.0 (PKCE, loopback flow, refresh, sign-out)
│   │   └── token-manager.ts  # Secure token file storage
│   ├── google/
│   │   ├── docs-client.ts    # Google Docs API wrapper
│   │   ├── drive-client.ts   # Google Drive API wrapper
│   │   ├── document-parser.ts # Index-accurate document parsing
│   │   └── retry.ts          # Retry policy for idempotent requests
│   ├── services/             # Business logic (documents, content, formatting, structure, search)
│   ├── tools/                # MCP tool definitions (auth, documents, content, formatting, structure, search)
│   ├── resources/            # MCP resources (google-docs://document/{documentId})
│   ├── prompts/              # MCP prompts
│   ├── schemas/              # Shared zod schemas
│   ├── types/                # Shared TypeScript types
│   └── utils/                # Errors, validation, logging, URLs
├── tests/
│   ├── unit/                 # Unit tests (mocked Google APIs)
│   ├── integration/          # Optional real-account tests
│   └── helpers/              # Fakes and the in-memory MCP test harness
├── .env.example
├── eslint.config.js
├── prettier.config.js
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE) © Muhammad Ammar Qaisar
