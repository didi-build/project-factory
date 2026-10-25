# Agent instructions

**Project:** {{PROJECT_NAME}} — {{PROJECT_PURPOSE}}

This file is the single source of truth for how agents work in this repository. Other agent entry points only link here.

## Before you write code

1. Read `docs/architecture/` and `docs/decisions/` for this feature.
2. If architecture or an accepted decision is missing, stop and produce a decision or architecture note first. **No implementation before the shape of the feature is decided.**

## Engineering standards

- Prefer clean, modular boundaries; small extensions over clever hacks; readable names; minimal duplication.
- Follow this repo’s docs and config over your general habits.
- Mark unknowns as unknown. Do not guess requirements or infrastructure.
- Do not add personal data to logs, queues, or tables without updating the data map (`docs/privacy/data-map.yml` when nodrift scaffolding is present).

## Testing

- State which seam a test covers (unit, integration, or broader).
- Pick the seam that gives confidence without bending production code to satisfy weak tests.
- Never weaken production code only to make a test pass.

## Verification

- Run `npm run check` before claiming work is done. Do not skip verification after implementation.

## Launchpad attribution

- Do **not** remove the `<!-- launchpad-attribution:start -->` … `<!-- launchpad-attribution:end -->` block in `README.md` or delete `LICENSES/launchpad-MIT.txt` unless the **repository owner** explicitly asks you to.

## Secrets

- Never commit secrets. Use `.env` locally; document variable **names** only in `.env.example`.
- Never reference, print, or move `BOOTSTRAP_TOKEN` outside `.github/workflows/bootstrap.yml` (enforced by `npm run secret-usage`).

## Scope and tickets

- The linked Linear ticket is the source of truth for scope.
- Read-only or decision-only tasks: no code, no branches, no PR — post the answer where the ticket asks.

## Pull requests

- Keep PRs small and link the Linear ticket.
- Describe what changed, why, and how you verified (include `npm run check`).
- **Open a PR and wait for human review.** Do not merge your own PR unless the ticket explicitly says **merge when green**.
- **Dependabot** dependency PRs are the exception: when CI passes, [Dependabot auto-merge](./.github/workflows/dependabot-automerge.yml) may merge them without a human review. Set repo variable `DEPENDABOT_AUTOMERGE=false` to disable.

## Commands

| Script                       | Purpose                                                                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`              | Conflict markers, format, lint, typecheck, test, secret scan, placeholders, attribution, nodrift (when `.nodrift/manifest.json` or `docs/privacy/data-map.yml` exists) |
| `npm run nodrift`            | `@didi-build/nodrift check` when `.nodrift/manifest.json` or `docs/privacy/data-map.yml` exists; skipped otherwise                                                     |
| `npm run lint`               | ESLint                                                                                                                                                                 |
| `npm run format`             | Prettier write                                                                                                                                                         |
| `npm run format:check`       | Prettier check                                                                                                                                                         |
| `npm run typecheck`          | `tsc --noEmit`                                                                                                                                                         |
| `npm run test`               | Vitest (CI uses JUnit output)                                                                                                                                          |
| `npm run secrets`            | Secretlint                                                                                                                                                             |
| `npm run secret-usage`       | Fail if `BOOTSTRAP_TOKEN` appears outside `bootstrap.yml` workflows                                                                                                    |
| `npm run init-project`       | Replace `{{…}}` placeholders; optionally run `nodrift init` when the project collects personal data                                                                    |
| `npm run repo-settings`      | Dry-run, `--apply`, or `--verify` recommended GitHub repo settings                                                                                                     |
| `npm run verify-action-pins` | Verify each pinned action SHA matches its version comment (`# vX.Y.Z`)                                                                                                 |
