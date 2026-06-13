# web-performance-mcp

MCP server for compact web performance analysis with the official Google APIs:

- PageSpeed Insights API v5
- Chrome UX Report API

It does not run Lighthouse locally and does not use Puppeteer, Playwright, Chrome DevTools Protocol, or a local browser.

## Quick Start With npx

After the package is published to npm:

```bash
npx -y web-performance-mcp
```

The server reads `GOOGLE_API_KEY` from the environment. It also loads a `.env` file from the current working directory, so MCP clients can keep secrets in the project they are analyzing.

Create `.env` in your project:

```bash
GOOGLE_API_KEY=your-google-api-key-here
```

## Codex MCP Configuration

Use `npx` directly:

```toml
[mcp_servers.webPerformance]
command = "npx"
args = ["-y", "web-performance-mcp"]
cwd = "/path/to/project-with-env"
startup_timeout_sec = 30
tool_timeout_sec = 180
```

`cwd` should point to the project that contains `.env`.

You can also pass the key through MCP env config:

```toml
[mcp_servers.webPerformance.env]
GOOGLE_API_KEY = "your-google-api-key-here"
```

Prefer `.env` or shell environment variables for local use so secrets do not end up in shared config.

## Required Google APIs

Create a Google Cloud API key and enable:

- PageSpeed Insights API
- Chrome UX Report API

Restrict the API key to only these APIs.

## Tools

### `analyze_pagespeed`

Analyze one URL with PageSpeed Insights.

```json
{
  "url": "https://www.example.com/",
  "strategy": "mobile",
  "categories": ["performance"]
}
```

Returns:

- performance score;
- lab metrics: FCP, LCP, Speed Index, TBT, CLS, TTI, TTFB;
- high-impact audits;
- compact diagnostics for render-blocking resources, unused JS/CSS, image optimization, and main-thread work;
- recommendations.

### `analyze_pagespeed_batch`

Analyze up to 10 URLs with concurrency control.

```json
{
  "urls": [
    "https://www.example.com/",
    "https://www.example.com/blog/"
  ],
  "strategy": "mobile",
  "categories": ["performance"],
  "concurrency": 2
}
```

### `get_crux_url`

Query Chrome UX Report data for a URL.

```json
{
  "url": "https://www.example.com/"
}
```

Returns LCP, INP, CLS p75 and good/needs improvement/poor distributions when CrUX has enough real-user data.

### `get_crux_origin`

Query Chrome UX Report data for an origin.

```json
{
  "origin": "https://www.example.com"
}
```

### `compare_web_performance`

Combine PageSpeed and CrUX for several URLs and prioritize likely problems.

```json
{
  "urls": [
    "https://www.example.com/",
    "https://www.example.com/blog/"
  ],
  "strategy": "mobile",
  "categories": ["performance"],
  "concurrency": 2
}
```

## Response Shape

Responses are intentionally compact. The server does not send the raw PageSpeed or CrUX API payload back to the model.

CrUX tools return `available: false` when Google has no field data for the URL or origin.

API errors are returned as compact MCP errors for timeout, quota, permissions, invalid URLs, and incomplete API responses.

## Local Development

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm build
pnpm test
pnpm start
```

Use the local checkout in Codex:

```toml
[mcp_servers.webPerformance]
command = "node"
args = ["/Users/teles/dev/web-performance-mcp/dist/index.js"]
cwd = "/path/to/project-with-env"
startup_timeout_sec = 30
tool_timeout_sec = 180
```

## Publishing to npm

The npm package name is:

```text
web-performance-mcp
```

The name is currently available if `npm view web-performance-mcp` returns `404 Not Found`. During `npm publish`, however, a `404 Not Found` usually means the workflow cannot create or access that package name with the current npm authentication.

### One-Time npm Setup

1. Create or log in to your npm account.
2. Publish the package once with an npm account that can create unscoped public packages, or configure npm Trusted Publishing for the GitHub repository before the automated release runs.
3. For Trusted Publishing, configure this package on npmjs.com with:

```text
Provider: GitHub Actions
Organization or user: teles
Repository: web-performance-mcp
Workflow filename: release.yml
Allowed action: npm publish
```

4. Keep the GitHub Actions workflow permissions:

```yaml
permissions:
  contents: write
  id-token: write
```

Trusted Publishing requires npm CLI 11.5.1+ and Node.js 22.14.0+. The release workflow uses Node 24.

If the release workflow fails while publishing with `npm error 404 Not Found - PUT https://registry.npmjs.org/web-performance-mcp`, confirm that the package exists under your npm account or that Trusted Publishing is configured for exactly `teles/web-performance-mcp` and workflow filename `release.yml`.

### Release Flow

This repository uses `zero-release`.

Commits should follow Conventional Commits:

```text
feat: add new tool
fix: handle CrUX permission errors
docs: improve npx setup
```

Preview the next release locally:

```bash
pnpm release:dry-run
```

Check release readiness:

```bash
pnpm release:doctor
```

Push to `main` to publish:

```bash
git push origin main
```

The workflow runs tests, builds the package, updates `CHANGELOG.md` and `package.json`, creates a GitHub release, and publishes to npm with the `npm` plugin.

### Manual Publish Fallback

If you do not want to use Trusted Publishing yet:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm build
npm login
npm publish --access public
```

Use zero-release for normal releases once npm Trusted Publishing is configured.

## Security

- Never commit `.env` or real credentials.
- Restrict `GOOGLE_API_KEY` to PageSpeed Insights API and Chrome UX Report API.
- The API key is never printed by the server.
- The server does not execute browser automation.

## License

MIT
