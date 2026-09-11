# Build a Production-Ready Google Docs MCP Server

You are an expert **TypeScript/Node.js developer, MCP (Model Context Protocol) engineer, Google APIs engineer, OAuth 2.0 specialist, and software architect**.

Build a production-quality **MCP server for Google Docs** that allows MCP-compatible AI clients to securely interact with a user's Google Docs through natural-language instructions.

The project should be clean, modular, secure, well-documented, and suitable for publishing as an open-source GitHub project.

---

## 1. Project Goal

Create an MCP server named:

**Google Docs MCP**

The server should act as a bridge:

```text
AI Client
   │
   │ MCP
   ▼
Google Docs MCP Server
   │
   │ Google Docs API / Google Drive API
   ▼
Google Docs
```

The AI should be able to perform common Google Docs operations without requiring the user to manually interact with the Google Docs UI.

Example:

> "Create a document called FYP Proposal and add the following content..."

The MCP server should:

1. Authenticate the user with Google OAuth 2.0.
2. Obtain the required Google API permissions.
3. Discover/use the user's Google Docs.
4. Execute MCP tools.
5. Perform the corresponding Google Docs API operations.
6. Return structured, useful results to the AI client.
7. Handle errors safely and clearly.

---

# 2. Technology Stack

Use:

- **Node.js**
- **TypeScript**
- Official MCP TypeScript SDK
- Google Docs API
- Google Drive API
- Google OAuth 2.0
- npm
- ESLint
- Prettier
- Vitest or Jest for testing

Use modern TypeScript with strict type checking.

Do NOT use Python unless absolutely necessary.

Do NOT build the MCP server around Express unless there is a genuine architectural reason to do so. MCP transport should be implemented according to the current official MCP SDK.

Before implementing MCP-specific APIs, verify the current official MCP TypeScript SDK documentation and use the current recommended APIs rather than deprecated examples.

---

# 3. Project Structure

Create a maintainable structure similar to:

```text
google-docs-mcp/
│
├── src/
│   ├── index.ts
│   │
│   ├── config/
│   │   └── config.ts
│   │
│   ├── auth/
│   │   ├── google-auth.ts
│   │   └── token-manager.ts
│   │
│   ├── google/
│   │   ├── docs-client.ts
│   │   └── drive-client.ts
│   │
│   ├── tools/
│   │   ├── documents/
│   │   ├── content/
│   │   ├── formatting/
│   │   └── search/
│   │
│   ├── schemas/
│   │   └── ...
│   │
│   ├── utils/
│   │   ├── errors.ts
│   │   └── validation.ts
│   │
│   └── types/
│       └── ...
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── .env.example
├── .gitignore
├── eslint.config.js
├── prettier.config.js
├── package.json
├── tsconfig.json
└── README.md
```

Keep business logic separate from MCP tool definitions and Google API clients.

---

# 4. Authentication

Implement Google OAuth 2.0 properly.

The server must support authentication for the user's Google account.

Use the minimum practical Google scopes required for the functionality.

Consider scopes such as:

```text
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/drive
```

Do not request excessively broad permissions unnecessarily.

Implement:

- OAuth authorization
- access token handling
- refresh token handling
- token expiration handling
- secure token storage
- authentication errors
- re-authentication when required

Never hard-code:

- client IDs
- client secrets
- access tokens
- refresh tokens

Use environment variables/configuration where appropriate.

Create:

```text
.env.example
```

with placeholders such as:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Clearly explain how the user creates Google OAuth credentials in Google Cloud Console.

---

# 5. MCP Tools

Implement useful MCP tools with strongly typed input schemas.

At minimum implement the following.

## Document Management

### `create_document`

Create a new Google Doc.

Parameters:

```text
title: string
```

Return:

- document ID
- document title
- document URL

---

### `get_document`

Retrieve a document.

Parameters:

```text
documentId: string
```

Return structured information including:

- document ID
- title
- document content
- relevant structural information

Avoid returning unnecessarily huge payloads when possible.

---

### `list_documents`

List Google Docs accessible to the authenticated user.

Parameters should support:

```text
limit
pageToken
search
```

Use Google Drive API where appropriate to find documents.

Return:

- document ID
- name
- URL
- created time
- modified time

---

### `delete_document`

Delete a document by moving it to the user's Google Drive trash.

Parameters:

```text
documentId: string
```

Do not permanently delete files unless explicitly supported and clearly documented.

---

### `copy_document`

Create a copy of an existing Google Doc.

Parameters:

```text
documentId: string
newTitle: string
```

---

# 6. Content Manipulation

Implement:

### `append_text`

Append text to the end of a document.

Parameters:

```text
documentId
text
```

---

### `insert_text`

Insert text at a specific document index.

Parameters:

```text
documentId
index
text
```

Validate indexes carefully.

---

### `replace_text`

Replace occurrences of text.

Parameters:

```text
documentId
searchText
replacementText
matchCase
```

Use the appropriate Google Docs batch update functionality.

---

### `delete_text`

Delete a range of text.

Parameters:

```text
documentId
startIndex
endIndex
```

Validate that indexes are valid before sending requests to Google.

---

# 7. Formatting

Implement useful formatting tools.

At minimum:

### `format_text`

Parameters:

```text
documentId
startIndex
endIndex

bold?
italic?
underline?
fontSize?
fontFamily?
foregroundColor?
backgroundColor?
```

Only send formatting fields that were actually specified.

---

### `set_paragraph_style`

Support:

- NORMAL_TEXT
- TITLE
- SUBTITLE
- HEADING_1
- HEADING_2
- HEADING_3
- HEADING_4
- HEADING_5
- HEADING_6

Parameters:

```text
documentId
startIndex
endIndex
style
```

---

### `set_alignment`

Support:

- START
- CENTER
- END
- JUSTIFIED

---

# 8. Document Structure

Implement useful structural operations where supported by the Google Docs API.

Examples:

### `insert_page_break`

```text
documentId
index
```

### `insert_table`

```text
documentId
index
rows
columns
```

### `insert_link`

```text
documentId
startIndex
endIndex
url
```

### `create_bulleted_list`

```text
documentId
startIndex
endIndex
```

Use the Google Docs API correctly rather than attempting to emulate Google Docs formatting manually.

---

# 9. Search

Create a tool such as:

### `search_documents`

Search the user's Google Drive for Google Docs.

Parameters:

```text
query
limit
```

Support useful searches such as:

> Find documents containing "FYP"

Use Google Drive search capabilities appropriately.

Clearly document that Drive filename search and full-text content search have different capabilities/limitations.

---

# 10. Tool Design Principles

Every MCP tool should have:

1. Clear name
2. Description
3. Strict input schema
4. Useful validation
5. Predictable output
6. Proper error handling

Example conceptual structure:

```text
Tool
 ├── name
 ├── description
 ├── inputSchema
 └── handler
```

Descriptions should be written so that an AI agent can understand **when and how to use the tool**.

Avoid vague descriptions like:

```text
"Does something with documents"
```

Prefer:

```text
"Create a new Google Docs document with the specified title and return its document ID and URL."
```

---

# 11. Error Handling

Handle errors gracefully.

Potential errors include:

- Not authenticated
- Invalid OAuth credentials
- Expired credentials
- Invalid document ID
- Document not found
- Permission denied
- Invalid index
- Invalid formatting request
- Google API rate limits
- Network failures
- Invalid MCP arguments

Return errors that are understandable to an AI agent.

Example:

```json
{
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "The Google Docs document could not be found or you do not have access to it."
  }
}
```

Do not expose:

- OAuth secrets
- access tokens
- refresh tokens
- internal stack traces
- sensitive filesystem information

---

# 12. Security

Treat security as a first-class requirement.

Implement:

- OAuth 2.0
- least-privilege scopes
- secure credential handling
- environment variables
- input validation
- safe error messages
- no secret logging
- no token logging
- protection against malicious document IDs or malformed input

Never log:

```text
access_token
refresh_token
client_secret
authorization_code
```

---

# 13. Idempotency and Safety

Where practical, make operations predictable and safe.

For destructive operations such as:

```text
delete_document
delete_text
replace_text
```

ensure the tool description clearly communicates what will happen.

Do not silently perform destructive operations when the requested operation is ambiguous.

---

# 14. MCP Resources

If useful and supported by the current MCP specification, expose Google Docs as MCP resources.

For example:

```text
google-docs://document/{documentId}
```

A resource could expose a document's current content to the AI without requiring a tool call for every read.

Use resources only where they genuinely improve the architecture.

---

# 15. MCP Prompts

If useful, implement reusable MCP prompts such as:

### `summarize_document`

### `rewrite_document`

### `format_document`

### `create_meeting_notes`

However, do not put AI functionality inside the server unnecessarily.

The MCP server's primary responsibility is providing reliable Google Docs capabilities.

---

# 16. URL Generation

For every created or retrieved document, provide a usable Google Docs URL:

```text
https://docs.google.com/document/d/{DOCUMENT_ID}/edit
```

Do not invent document IDs.

---

# 17. Testing

Create comprehensive tests.

Test:

### Authentication

- valid credentials
- expired token
- missing credentials

### Document operations

- create
- retrieve
- list
- copy
- delete

### Content operations

- append
- insert
- replace
- delete

### Formatting

- bold
- italic
- underline
- headings
- alignment

### Error handling

- invalid document ID
- invalid index
- permission errors
- API failures

Mock Google APIs for unit tests.

Add integration tests that can optionally run against a real Google test account.

Do NOT require real Google credentials for ordinary unit tests.

---

# 18. README

Create a professional README containing:

## Google Docs MCP

A short explanation of the project.

### Features

List all supported capabilities.

### Architecture

Include an architecture diagram:

```text
MCP Client
    │
    ▼
MCP Server
    │
    ├── Authentication
    │
    ├── MCP Tools
    │
    └── Google API Clients
             │
       ┌─────┴─────┐
       ▼           ▼
 Google Docs   Google Drive
```

### Requirements

Explain:

- Node.js version
- Google Cloud project
- Google Docs API
- Google Drive API
- OAuth credentials

### Installation

Provide exact commands.

### Configuration

Explain `.env`.

### Google OAuth Setup

Give step-by-step instructions for creating OAuth credentials.

### Running

Explain development and production commands.

### MCP Client Configuration

Provide example configuration for compatible MCP clients.

Use the current MCP configuration format rather than outdated examples.

### Available Tools

Create a table:

| Tool | Description |
|---|---|
| create_document | Create a Google Doc |
| get_document | Read a Google Doc |
| list_documents | List Docs |
| append_text | Append content |
| insert_text | Insert content |
| replace_text | Replace text |
| format_text | Format text |
| ... | ... |

### Security

Document how credentials and tokens are handled.

### Troubleshooting

Include common OAuth and Google API problems.

### License

Use a reasonable open-source license such as MIT unless there is a reason to choose another.

---

# 19. Developer Experience

The project should work with:

```bash
npm install
npm run build
npm run dev
npm test
npm run lint
npm run format
```

Configure appropriate npm scripts.

Use:

```text
strict: true
```

in TypeScript.

Avoid:

```text
any
```

unless there is a compelling reason.

Use meaningful types and interfaces.

---

# 20. Code Quality

Follow these principles:

- Clean architecture
- SOLID principles where appropriate
- DRY
- Strong typing
- Small focused modules
- Clear naming
- No unnecessary abstraction
- No duplicated Google API logic
- No hard-coded secrets
- No unnecessary dependencies

Do not over-engineer the initial implementation.

---

# 21. Important MCP Requirement

Before writing MCP-related code:

1. Check the latest official MCP documentation.
2. Check the latest official TypeScript MCP SDK.
3. Determine the currently recommended transport.
4. Use current APIs rather than deprecated examples.
5. Verify that the resulting server can actually be connected to by a current MCP-compatible client.

Do not assume an old tutorial's MCP API is still correct.

---

# 22. Implementation Strategy

Work incrementally.

### Phase 1

Set up:

- TypeScript
- Node.js
- MCP SDK
- project structure
- configuration
- Google API clients

### Phase 2

Implement OAuth.

### Phase 3

Implement:

- create_document
- get_document
- list_documents

### Phase 4

Implement content manipulation.

### Phase 5

Implement formatting.

### Phase 6

Implement tables, links, lists, and page breaks.

### Phase 7

Implement search.

### Phase 8

Add tests.

### Phase 9

Improve error handling and security.

### Phase 10

Write complete README and client configuration examples.

---

# 23. Agent Workflow

Do NOT simply generate all files blindly.

First:

1. Inspect the current repository.
2. Determine whether an existing project exists.
3. Inspect package.json and configuration.
4. Identify the current Node.js/TypeScript setup.
5. Create an implementation plan.
6. Then implement the project.

When modifying existing files, preserve existing functionality unless it conflicts with this project.

After implementation:

```text
1. Install dependencies
2. Type-check
3. Build
4. Run lint
5. Run tests
6. Fix all errors
7. Verify MCP server startup
8. Verify tool registration
9. Verify Google API integration
10. Update README
```

Do not declare the project complete until the build and tests pass.

---

# 24. Final Deliverable

The final repository should contain a fully functional Google Docs MCP server that allows an MCP-compatible AI client to:

```text
Authenticate
     ↓
Discover Google Docs
     ↓
Read documents
     ↓
Create documents
     ↓
Modify content
     ↓
Format content
     ↓
Manage document structure
     ↓
Return structured results
```

The implementation should be **real and executable**, not pseudocode or a conceptual demonstration.

At the end, provide:

1. What was implemented
2. Project structure
3. Available MCP tools
4. Setup instructions
5. Required Google Cloud configuration
6. How to connect the MCP server to an MCP client
7. Tests performed
8. Any remaining limitations
9. Suggested future improvements