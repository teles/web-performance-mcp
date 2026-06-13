# web-performance-mcp

Local MCP server for compact web performance analysis using official Google APIs:

- PageSpeed Insights API v5
- Chrome UX Report API

It does **not** use Puppeteer, Playwright, Chrome DevTools Protocol, Lighthouse local runs, or a local browser.

## Tools

- `analyze_pagespeed`
  - Analyze one URL with PageSpeed Insights.
  - Returns performance score, lab metrics, high-impact audits, compact resource diagnostics, and recommendations.

- `analyze_pagespeed_batch`
  - Analyze up to 10 URLs with concurrency control.
  - Returns a compact comparison.

- `get_crux_url`
  - Query Chrome UX Report for a URL.
  - Returns LCP, INP, CLS p75 and good/needs improvement/poor distributions when available.

- `get_crux_origin`
  - Query Chrome UX Report for an origin.

- `compare_web_performance`
  - Combines PageSpeed and CrUX for several URLs and prioritizes likely performance problems.

## Requirements

- Node.js 20+
- `GOOGLE_API_KEY`
- Enabled Google APIs:
  - PageSpeed Insights API
  - Chrome UX Report API

The API key is read from `process.env.GOOGLE_API_KEY`. The server also loads `.env` from the process `cwd` through `dotenv/config`, which is convenient for local MCP clients.

## Install From npm

After the package is published:

```bash
npx -y web-performance-mcp
```

## Local Development

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm build
pnpm test
```

Fill `.env`:

```bash
GOOGLE_API_KEY=your-google-api-key-here
```

Run the server:

```bash
pnpm start
```

## Codex MCP Configuration

Using npm/npx:

```toml
[mcp_servers.webPerformance]
command = "npx"
args = ["-y", "web-performance-mcp"]
cwd = "/path/to/project-with-env"
startup_timeout_sec = 30
tool_timeout_sec = 180
```

Using a local checkout:

```toml
[mcp_servers.webPerformance]
command = "node"
args = ["/Users/teles/dev/web-performance-mcp/dist/index.js"]
cwd = "/Users/teles/dev/gsp-mcp"
startup_timeout_sec = 30
tool_timeout_sec = 180
```

`cwd` is where `.env` is loaded from.

## Example Calls

```json
{
  "url": "https://www.example.com/",
  "strategy": "mobile",
  "categories": ["performance"]
}
```

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

## Release

This repository uses [`zero-release`](https://zero-release.github.io/) for semantic versioning and npm publishing.

Local dry run from this workspace layout:

```bash
pnpm release:dry-run
pnpm release:doctor
```

The release workflow uses:

```text
release-notes,changelog,package-json,git-commit,npm,github-release
```

Publishing is configured for npm Trusted Publishing/OIDC. Configure the package trusted publisher on npmjs.com and keep `id-token: write` enabled in GitHub Actions.

## Security

- Never commit `.env` or real credentials.
- Restrict `GOOGLE_API_KEY` to PageSpeed Insights API and Chrome UX Report API.
- API errors are returned without logging or exposing the key.

## License

MIT
