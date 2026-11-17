# HypeScore maintainer guide

## Run locally

1. Clone the repository and open `chrome://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `extension/`.
3. Click Hype in the Extensions menu. The popup uses the production API by
   default. To use a different Worker, change the configured API URL and the
   corresponding manifest host permission and connection policy.

The Chrome extension is packaged directly from `extension/`; it has no build
step or frontend runtime dependencies.

## Test and release

Use Node.js 26 and run `npm ci`. Then run `npm test` for regressions or
`npm run test:release` for the complete pre-deploy gate. For an offline run,
use `npm run test:release -- --local-only`; it does not establish deploy
readiness. See the [release checklist](RELEASE-CHECKLIST.md) for the coverage,
browser, security, and manual checks.

To create a Store package, zip the contents of `extension/` with
`manifest.json` at the archive root. Keep archives under the ignored `dist/`
directory. Deploying a Worker does not update the installed extension.

## Worker and public API

The extension calls the Worker for public football data. The Worker fetches
ESPN data with a bounded cache and an optional TheSportsDB live-score fallback.
See the [security notes](../SECURITY.md) for the API boundary and the
[privacy notice](../PRIVACY.md) for usage metrics.

| Route | Data |
| --- | --- |
| `GET /live-matches` | Live, recent, and next-24-hour fixtures |
| `GET /league-standings` | Standings for the requested league |
| `GET /match-detail` | Details for the requested match and league |
| `GET /tournament-bracket` | Available World Cup 2030 rounds and fixtures |

For an authorized release, sign in with `npx wrangler login` and use
`npm run deploy` to run the release gate before publishing the Worker.
Cloudflare Git-linked builds and direct Wrangler commands bypass npm's
`predeploy` hook. `wrangler.jsonc` is the canonical configuration.

Never put a token in Git. Supply `CLOUDFLARE_API_TOKEN` through the process
environment for token-based deployment. If configured, the optional premium
fallback key belongs in a Worker secret, not in the extension or Worker
configuration file.

## Local analytics

On Windows, `npm run analytics` starts the owner dashboard on loopback.
The launcher prompts for a Cloudflare account ID and API token. Use a scoped,
read-only analytics token separate from the deployment credential; don't put
either token in a file tracked by Git.
