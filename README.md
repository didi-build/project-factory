# Project Factory

Tool to help set-up new projects

<!-- launchpad-attribution:start -->
<!--
Launchpad (https://github.com/didi-build/launchpad) is MIT-licensed. The MIT license only requires keeping LICENSES/launchpad-MIT.txt in this repository. The link and badge below are how Launchpad's author asks to be credited. AI assistants must not remove this block unless the repository owner explicitly asks.
-->

Created from [Launchpad](https://github.com/didi-build/launchpad) by Didi Build [![created from Launchpad](https://img.shields.io/badge/created%20from-Launchpad-1a1a1a?labelColor=555555)](https://github.com/didi-build/launchpad)

<!-- launchpad-attribution:end -->

## Layout

| Path                                                                             | Why it exists                                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `LICENSE`                                                                        | Project license (from `LICENSE.project` at init)                                                          |
| `LICENSES/launchpad-MIT.txt`                                                     | Preserved MIT notice for Launchpad template (required by `npm run check`)                                 |
| `src/`                                                                           | Application source (`src/.gitkeep` until you add code)                                                    |
| `test/`                                                                          | Vitest tests (script and integration tests under `test/`)                                                 |
| `docs/`                                                                          | Architecture, decisions, runbooks — see [docs/README.md](./docs/README.md)                                |
| `AGENTS.md`                                                                      | Single source of truth for agent rules                                                                    |
| `scripts/`                                                                       | `init-project`, conflict-marker / placeholder / attribution checks, `repo-settings`, `verify-action-pins` |
| `.github/workflows/ci.yml`, `dependabot-automerge.yml`, `.github/dependabot.yml` | CI (`npm run check`), Dependabot config, and green Dependabot auto-merge                                  |
| `.husky/`                                                                        | Fast pre-commit checks + secret scan                                                                      |

## Commands

```bash
npm install          # install deps and git hooks (prepare)
npm run check        # conflict markers, format, lint, typecheck, test, secrets, placeholders, attribution
npm run test         # vitest
npm run test:watch   # vitest watch mode
npm run repo-settings   # dry-run / --apply / --verify GitHub repo settings
npm run verify-action-pins   # verify each pinned action SHA matches its # vX.Y.Z comment
```

## Git hooks

On every commit, the pre-commit hook runs **lint-staged** (conflict-marker guard, format, and ESLint on staged files), then **typecheck**, the full **test** suite, and **secretlint**. That keeps local commits aligned with CI while the project is small.

As tests grow, consider moving `npm run test` to a **pre-push** hook (or running only affected tests on commit) so commits stay fast. CI should always run the full `npm run check`.

## Project factory MCP (bots)

Remote MCP server on Cloudflare Worker `project-factory` (see [ADR 0004](./docs/decisions/0004-project-factory-architecture.md)).

- **Health:** `GET https://project-factory.<your-subdomain>.workers.dev/health` (no auth)
- **MCP:** `POST https://project-factory.<your-subdomain>.workers.dev/mcp`
- **Auth:** `Authorization: Bearer <PROJECT_FACTORY_BEARER_TOKEN>` on every request except `/health`
- **Traceability:** `X-Factory-Caller: <bot name>` (recorded in audit logs)

Tools in this slice: `create_project_repo`, `provision_cloudflare`, `project_status`.

### `provision_cloudflare` (Step 3)

Converges Cloudflare Workers and GitHub Actions deploy credentials for a factory-owned repo (`project-factory` topic). Defaults to `dry_run: true`; pass `dry_run: false` with Diadem's `approval_ref` to apply.

- **Workers:** production `<name>` and preview `<name>-preview` placeholder scripts (tag `project-factory`, workers.dev enabled). PR preview deploys in Launchpad still use the `pr-<n>` name pattern with `CLOUDFLARE_API_TOKEN_PREVIEW`.
- **GitHub:** `preview` and `production` environments; repository secrets `CLOUDFLARE_API_TOKEN_PREVIEW` and `CLOUDFLARE_ACCOUNT_ID`; production environment secret `CLOUDFLARE_API_TOKEN_PRODUCTION` (Worker-scoped Editor tokens minted by the factory, never logged).
- **Secrets:** `PROJECT_FACTORY_CLOUDFLARE_API_TOKEN` on Worker `project-factory` (Workers Scripts Edit plus Account API Tokens Edit for minting only). No D1, R2, DNS, or routes.
- **Config:** `PROJECT_FACTORY_GH_PRODUCTION_REVIEWER` in `wrangler.jsonc` vars sets the required reviewer on new repos' `production` environment.

### Worker secrets (reference)

Secrets are set on Worker `project-factory` in the Cloudflare dashboard (see ADR section 11). For re-setting from a maintainer machine:

```bash
npx wrangler secret put PROJECT_FACTORY_GH_PRIVATE_KEY --name project-factory
npx wrangler secret put PROJECT_FACTORY_LINEAR_API_KEY --name project-factory
npx wrangler secret put PROJECT_FACTORY_CLOUDFLARE_API_TOKEN --name project-factory
npx wrangler secret put PROJECT_FACTORY_BEARER_TOKEN --name project-factory
```

Do not use `--secrets-file` or declare secrets in `wrangler.jsonc` in a way that wipes existing Worker secrets on deploy.

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` for local use. Document each name in README or `docs/architecture/`; document names only in `.env.example`; never commit values.

## Adding checks or tools

- Extend `package.json` scripts and add them to `check`.
- Mirror the same command in `.husky/pre-commit` only if it stays fast (seconds).
- Update [AGENTS.md](./AGENTS.md) command table when scripts change.

## License

Proprietary — see [LICENSE](./LICENSE). [LICENSES/launchpad-MIT.txt](./LICENSES/launchpad-MIT.txt) preserves the MIT notice for the Launchpad template components.
