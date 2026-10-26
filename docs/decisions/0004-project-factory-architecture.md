# 0004. Run Project factory as a remote MCP server on Cloudflare Workers

- **Status:** accepted (Diadem, Oct 26, 2026)
- **Date:** 2026-10-26
- **Linear:** [DIDI-841](https://linear.app/didi-build/issue/DIDI-841) (this ADR), epic [DIDI-838](https://linear.app/didi-build/issue/DIDI-838); builds on it: [DIDI-844](https://linear.app/didi-build/issue/DIDI-844), [DIDI-845](https://linear.app/didi-build/issue/DIDI-845), [DIDI-846](https://linear.app/didi-build/issue/DIDI-846), [DIDI-847](https://linear.app/didi-build/issue/DIDI-847)
- **Related:** [0001 Template bootstrap](./0001-template-bootstrap.md), [0003 Nodrift in Launchpad](./0003-nodrift-in-launchpad.md); Launchpad `0004-component-gallery` (one Worker per repo, `pr-<n>` previews); we-met [0007](https://github.com/didi-build/we-met/blob/main/docs/decisions/0007-production-deploy-manual.md), [0017](https://github.com/didi-build/we-met/blob/main/docs/decisions/0017-cloudflare-api-credentials.md), [0019](https://github.com/didi-build/we-met/blob/main/docs/decisions/0019-pr-preview-github-action.md)

> File path note: DIDI-841 asked for `docs/adr/0001-project-factory-architecture.md`. This repo (from Launchpad) keeps ADRs in `docs/decisions/` and already uses 0001 to 0003, so this is `docs/decisions/0004-project-factory-architecture.md`.

## Context

### Product direction (quoted from the epic's locked block, verbatim)

This ADR does not change the locked block. Diadem's words below are copied exactly from DIDI-838.

**Diadem, Oct 25, 2026, 1:16 PM ET (verbatim):**

> "As I talk to people, I realize there's lots of ideas people want to make and I want to make it for them. So this ties into the flagship project idea that we were tracking. I think an interesting way to view it would be like software as a service, as a service, like creating SaaS. Like, for example, I, there's a ticket on the board about Someone I was talking to wanted a apartment hunting tool. I easily logged the idea, but everything's on pause because I need to create the repository, I need to create... There, there are things that, like, I needed to do that blocked actually building it and just having it up. Basically, I want a way to, like, have an idea, and then it just be created. so I need to build a tooling around that so it's possible. So this feels like it's towards a flagship idea, like I need to figure out the infrastructure around it. Or have like a proof of concept part first. Like I think creating a tool or an API call or a connector that fills the gap of like creating the GitHub repository for me or something like that, that will make everything else easier."

**Diadem, Oct 25, 2026, 1:17 PM ET (verbatim), answering CTO's three-step Project factory proposal:**

> "Yes, plan all three steps"

**Diadem, Oct 25, 2026, 1:23 PM ET (verbatim):**

> "Yes, add Issues write and Secrets write to DIDI-840"

**Product direction addition (Diadem, Oct 25, 2026, 5:26 PM ET, verbatim, epic comment):**

> "well moving forward, due to the project-factory, the goal is not for me to need to run any of this on my laptop moving forward"

The locked block's **Access rules**, verbatim:

> - The service is a remote MCP server on Cloudflare Workers (TypeScript). Bots call it as an MCP connector, authenticated with a bearer secret.
> - The GitHub App private key and all other credentials live only as secrets of the deployed service. Never in a bot, never in chat or Linear, never reachable by PR-branch code (same rule as: no token reachable by PR-branch code gets D1 Edit or R2 Edit).
> - No bot creates the GitHub repo or App for this project; Diadem does (see the Ready for maintainer tickets).

The locked **What the factory does** table (steps 1 to 3, the access each needs, and that Diadem sets up access) is the source of truth for scope. Out of scope per the epic: per-project D1 and R2, custom domains and DNS, any UI.

### Facts as of 2026-10-26

- `didi-build/project-factory` exists (public, from Launchpad, DIDI-839 Done). `src/` is empty.
- GitHub App `didi-project-factory` exists and is installed on didi-build, All repositories (DIDI-840 Done). App ID `5471521`, installation ID `175254357` (recorded on DIDI-840, Oct 25, 2026, 5:10 PM ET; not secret). Repository permissions: Administration, Contents, Workflows, Issues, Secrets Read and write, **Environments Read and write** (section 10, Q2; add on the App via maintainer ticket); Metadata Read. No webhook. The private key `.pem` is on Diadem's laptop until it is stored (tracked on DIDI-844).
- DIDI-842 (Linear key) and DIDI-843 (Cloudflare token) are waiting for a place to put the secret.
- Standing constraints: secrets never go in chat or Linear. Diadem hands secret values over through the bot's in-chat secure form, or pastes them straight into GitHub or Cloudflare. No token reachable by PR-branch code gets D1 Edit or R2 Edit. D1 ids are never printed. Production deploy approvals stay with Diadem on GitHub. DNS changes need his individual approval. He has no password manager such as 1Password.
- Launchpad today: Bootstrap (`bootstrap.yml`, org secret `BOOTSTRAP_TOKEN`) runs `init-project` and `repo-settings` on a new repo's first push. Newer Launchpad adds `wrangler.jsonc` (Worker renamed to the slug at init) and `preview.yml` (`wrangler preview --name pr-<n>` with repo secrets `CLOUDFLARE_API_TOKEN_PREVIEW` and `CLOUDFLARE_ACCOUNT_ID`). Launchpad has **no production deploy workflow** yet.

## Decision

### 1. Runtime: one Worker, stateless MCP over streamable HTTP

- **Where it runs:** a single Cloudflare Worker named **`project-factory`** (TypeScript), deployed from this repo by GitHub Actions. It is the only place the factory's credentials exist.
- **Endpoint:** `POST /mcp` on `https://project-factory.<account-subdomain>.workers.dev` (MCP streamable HTTP transport). No custom domain, so no DNS change. `GET /health` returns `200 {"ok":true}` without auth and without revealing which secrets are set.
- **SDK:** Cloudflare `agents` package `createMcpHandler` (stateless; no Durable Object), with tools defined through `@modelcontextprotocol/sdk` and inputs validated with `zod`. If `createMcpHandler` does not fit, use the MCP SDK's streamable HTTP server transport directly. Do not use the stateful `McpAgent` (Durable Object) for the proof of concept.
- **No Cloudflare Workflows, KV, D1, R2 or Durable Objects in the proof of concept.** Each tool is a short converge function (a few API calls, seconds). Durable orchestration is deferred (see Alternatives).
- **Non-secret config** lives in `wrangler.jsonc` `vars`: `PROJECT_FACTORY_GH_APP_ID = "5471521"`, `PROJECT_FACTORY_GH_INSTALLATION_ID = "175254357"`, `PROJECT_FACTORY_GH_ORG = "didi-build"`, `PROJECT_FACTORY_TEMPLATE_REPO = "didi-build/launchpad"`, `PROJECT_FACTORY_LINEAR_TEAM = "Didi Build"`. The Cloudflare account id is not stored; the Worker reads it from `GET /client/v4/accounts` with its token and requires exactly one account.

### 2. Auth for bots

- Every request except `/health` needs `Authorization: Bearer <token>`, compared in constant time (SHA-256 both sides, then `crypto.subtle.timingSafeEqual`). Wrong or missing token: `401`, no body detail.
- **One shared secret for the proof of concept:** `PROJECT_FACTORY_BEARER_TOKEN`. Only CTO calls the factory. Callers send `X-Factory-Caller: <bot name>`, recorded in the audit log (self-asserted, for traceability, not security).
- **Rotation:** the Worker also accepts `PROJECT_FACTORY_BEARER_TOKEN_NEXT` when set. Rotate by setting `_NEXT`, switching the bot connector, moving the value to `PROJECT_FACTORY_BEARER_TOKEN`, then deleting `_NEXT`.
- Per-bot tokens wait until a second bot needs the factory.

### 3. Where each secret lives, who can reach it, minimum scope

All factory credentials are **Worker secrets on Worker `project-factory`**. No GitHub repo, bot, chat, Linear ticket or PR-branch workflow can read them. Only the deployed production code of `project-factory` can, and that code changes only through a reviewed merge to `main` plus Diadem's approval of the GitHub `production` environment (section 8).

| Secret (exact name)                    | Where                                                                                                              | Value                                                                  | Minimum scope                                                                                                                                                                                                                                                                                             | Who can reach it                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `PROJECT_FACTORY_GH_PRIVATE_KEY`       | Worker secret, Worker `project-factory`                                                                            | Full `.pem` of App `didi-project-factory`                              | The App's approved permissions (above). The Worker mints 1-hour installation tokens per call and never stores them. Install stays All repositories, because the App must configure the repos it creates.                                                                                                  | Production Worker code only                    |
| `PROJECT_FACTORY_LINEAR_API_KEY`       | Worker secret, Worker `project-factory`                                                                            | Linear personal API key labelled "Project factory" (DIDI-842 option A) | **Write** (not Admin), team access **Didi Build** only if Linear offers it                                                                                                                                                                                                                                | Production Worker code only                    |
| `PROJECT_FACTORY_CLOUDFLARE_API_TOKEN` | Worker secret, Worker `project-factory`                                                                            | Account API token `project-factory` (DIDI-843)                         | Account › **Workers Scripts › Edit** and Account › **Account API Tokens › Edit**, Didi Build account only. No D1, R2, DNS or zone permissions on this token. Used to manage Workers and to mint per-project deploy tokens (section 10, Q1).                                                               | Production Worker code only                    |
| `PROJECT_FACTORY_BEARER_TOKEN`         | Worker secret, Worker `project-factory`, plus the bot's MCP connector config (handed over through the secure form) | Random, at least 32 characters                                         | n/a                                                                                                                                                                                                                                                                                                       | Production Worker code and the calling bot     |
| `CLOUDFLARE_API_TOKEN_PRODUCTION`      | GitHub **`production` environment** secret on `didi-build/project-factory`                                         | Account API token `project-factory-ci-production`                      | Workers **Editor scoped to Worker `project-factory` only** (the Worker-scoped option we-met uses, ADR 0017). If the dashboard offers only account-wide scope, use Account › Workers Scripts › Edit; that is acceptable **only** because the environment is limited to `main` and needs Diadem's approval. | Approved production deploy jobs on `main` only |
| `CLOUDFLARE_ACCOUNT_ID`                | GitHub repository secret on `didi-build/project-factory`                                                           | Didi Build account id                                                  | Not a credential                                                                                                                                                                                                                                                                                          | CI                                             |

**Handling rules for the code (DIDI-844):**

- The private key is pasted as-is. The Worker normalizes it: it strips the BEGIN/END lines and all whitespace, so line breaks lost in a paste don't matter, and it accepts GitHub's PKCS#1 (`BEGIN RSA PRIVATE KEY`) key by wrapping it to PKCS#8 in code for WebCrypto. **Diadem never runs `openssl` or any command.**
- **Fail closed:** a tool whose secret is missing returns `missing_secret` with the secret **name** only. `/health` and every response leak no value, length or prefix.
- Secret values, installation tokens and D1 ids are never logged, returned, committed or posted. Errors from upstream APIs are trimmed to status code plus API error code.
- The factory never runs PR-branch code and never checks out a new repo's code.

**Per-project deploy tokens (minted by the factory, section 10 Q1):**

- For each factory-owned repo, the factory mints two Cloudflare API tokens. Each is a **Workers Editor** token scoped to a single Worker only: `<name>` for production, and `<name>` or `<name>-preview` for preview (never both Workers on one token).
- Minted tokens never include D1, R2, DNS, zone or token-management permissions.
- Every mint is logged (Workers Logs and audit) with token **name and id only**, never the value.
- The factory writes `CLOUDFLARE_API_TOKEN_PREVIEW` (minted Worker-scoped Editor token) and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, and `CLOUDFLARE_API_TOKEN_PRODUCTION` (minted Worker-scoped Editor token for `<name>`) as the `production` environment secret (section 10, Q2). It never copies `PROJECT_FACTORY_CLOUDFLARE_API_TOKEN` into any repo.

### 4. How a project goes from idea to running

Precondition (product call, unchanged from DIDI-847): Diadem's **yes** and the **project name** are recorded verbatim on a Linear ticket. Every tool requires `approval_ref` (the URL of that comment) and writes it into the audit entry. Tools default to `dry_run: true`; callers pass `dry_run: false` explicitly.

1. **`create_project_repo`** (Step 1, DIDI-844), as the App installation:
   1. Validate `name` (section 6). If `didi-build/<name>` exists **without** the factory marker, stop with `conflict_not_factory_owned`. The factory never adopts or changes a repo it didn't create.
   2. `POST /repos/didi-build/launchpad/generate` with owner `didi-build`, `name`, the required `description` (Bootstrap fails without it) and `private: false` (public by default, section 10 Q3). Then set topic `project-factory` (the ownership marker). Public repos must never contain a secret, seed, sender address or D1 id in committed files; making a repo private later is Diadem's call per project and needs GitHub Team to keep the production environment reviewer gate.
   3. Launchpad **Bootstrap** runs on the first push with the org `BOOTSTRAP_TOKEN`: init, nodrift scaffolding (personal-data default `true`, because the App has no Variables permission to set `LAUNCHPAD_COLLECTS_PERSONAL_DATA` before Bootstrap starts), branch protection, squash-only, the Dependabot label.
   4. **Verify state, not the run** (the App has no Actions permission): `README.md` has no `{{` placeholders, `wrangler.jsonc` `name` equals `<name>`, `main` protection requires PRs and status check `check`, blocks force pushes and blocks deletion. If Bootstrap hasn't finished after about 60 seconds, return `pending_bootstrap`; the caller runs the same call again later.
   5. Repair what's missing: re-apply branch protection, and create labels `privileged-change-reviewed` and `delegatable` (and the Dependabot label if it's missing).
2. **`create_linear_project`** (Step 2, DIDI-845), with the Linear key:
   1. Create or find project label **`didi-build/<name>`** in the existing single-select label group **`repo`** (current convention, for example `didi-build/we-met`). Creating the label first acts as the lock: a second concurrent call finds it and converges, rather than duplicating.
   2. Create or find a project on team **Didi Build** named `display_name`, with that label, a link to `https://github.com/didi-build/<name>`, and the marker `<!-- project-factory:<name> -->` in its description.
   3. Create or find the kickoff epic `<display_name>: kickoff` with the locked "Product direction" template, left empty for Diadem's verbatim words, in status **Ready for CTO breakdown**, related to `idea_issue` when given. **It never changes `idea_issue`'s status.**
3. **`provision_cloudflare`** (Step 3, DIDI-846), with the Cloudflare token and the App:
   1. Create or find Worker **`<name>`** (placeholder script, tag `project-factory`, workers.dev on) so the URL responds. No D1, R2, KV, routes or custom domains. Preview deploys for the new repo use Launchpad `preview.yml` with a minted Worker-scoped Editor token (not in the factory's first-slice scope; see section 8).
   2. On factory-owned repos only, create GitHub environments `preview` (no protection) and `production` (required reviewer Diadem, deployment branches limited to `main`) using App **Environments: Read and write** (section 10, Q2). The factory never reads or changes environments on repos it did not create.
   3. Mint the two per-project deploy tokens (section 3) and set `CLOUDFLARE_API_TOKEN_PREVIEW`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN_PRODUCTION` on `production` as described there.
4. **CI:** comes from the template (`ci.yml`, `preview.yml`, Dependabot). A production deploy workflow (`deploy.yml`, job `environment: production`, secret `CLOUDFLARE_API_TOKEN_PRODUCTION`) belongs in **Launchpad**, not in each repo by the factory. That needs a Launchpad ticket before DIDI-846 (see Consequences).
5. A read-only **`project_status({ name })`** tool reports what exists in GitHub, Linear and Cloudflare, so a bot can check before and after without writes.

### 5. Tool signatures

All tools return `request_id`, `status`, `steps[]` (each `{ id, status: "done" | "skipped" | "planned" | "failed", detail }`) and `warnings[]`. Errors return `{ error: { code, message, step?, retryable } }` with codes `unauthorized`, `invalid_name`, `reserved_name`, `conflict_not_factory_owned`, `missing_secret`, `permission_denied` (names the missing permission), `upstream_error` and `rate_limited`.

```ts
create_project_repo(input: {
  name: string;            // section 6
  description: string;     // required, 1..350 chars, becomes the GitHub description Bootstrap needs
  private?: boolean;       // default false (public, section 10 Q3)
  approval_ref: string;    // URL of Diadem's verbatim yes
  dry_run?: boolean;       // default true
}): { status: "planned" | "created" | "exists" | "repaired" | "pending_bootstrap";
      repo_url: string; default_branch: "main"; labels: string[]; protection_ok: boolean; ... }

create_linear_project(input: {
  name: string; display_name: string; summary: string;
  idea_issue?: string;     // e.g. "DIDI-830"
  approval_ref: string; dry_run?: boolean;
}): { status: "planned" | "created" | "exists" | "repaired";
      project_url: string; project_label: string;  // "didi-build/<name>"
      kickoff_epic: { identifier: string; url: string }; ... }

provision_cloudflare(input: {
  name: string;            // must be a factory-owned repo
  approval_ref: string; dry_run?: boolean;
}): { status: "planned" | "created" | "exists" | "repaired" | "blocked";
      worker: { name: string; url: string }; preview_name_pattern: "pr-<n>";
      repo_secrets_set: string[]; environment_secrets_set: string[];  // names only
      ... }

project_status(input: { name: string }): { github: ...; linear: ...; cloudflare: ... }  // read-only
```

### 6. Naming rules

- `name` matches `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, 3 to 40 characters (it must fit `pr-<n>-<name>` within the 63-character workers.dev label).
- Reserved: existing didi-build repos without the factory marker, and `launchpad`, `project-factory`, `nodrift`, `we-met`, `quorum`, `autopilot`, `web`, `portfolio`, `github`, `api`, `www`, `admin`, `app`, `test`, `staging`, `preview`. Rejected: the prefix `pr-`, and suffixes `-preview`, `-staging` and `-prod`.
- Derived names: repo `didi-build/<name>`; Linear project label `didi-build/<name>` (group `repo`); Linear project `display_name`; kickoff epic `<display_name>: kickoff`; Worker `<name>`; previews `pr-<n>`.

### 7. Idempotency, dry run and failure handling

- **Converge, don't create:** each tool reads current state, builds the plan, applies only missing steps, verifies, and returns. Re-running with the same input is always safe and reports `exists` or `repaired`.
- **Ownership markers:** GitHub topic `project-factory`, a Linear description marker, and the Cloudflare Worker tag `project-factory`. A resource with the right name but no marker is never changed.
- **`dry_run: true`** (the default) makes only GET calls and returns the full plan.
- **Partial failure:** no rollback, and the factory **never deletes** anything (repos, projects, Workers, secrets). It returns `status` of the last good state, the failed step, and `retryable`. Running the call again resumes. Test repos from DIDI-844 are listed for Diadem to delete.
- **Retries:** at most 3 tries with backoff on 5xx and 429, honouring `Retry-After` and GitHub's rate-limit headers. No retries on 4xx. A 403 becomes `permission_denied` naming the permission. **Nobody widens the App or tokens on their own:** a missing permission becomes an Urgent Ready for maintainer ticket.
- **Concurrency:** GitHub returns 422 for an existing repo name, and the tool then converges. The Linear label works as a lock (step 2.1). The proof of concept assumes one caller (CTO).
- **Audit:** one structured Workers Logs entry per call (`observability.enabled`): `{ event: "factory_call", request_id, caller, tool, dry_run, input (name and display fields only), approval_ref, status, resources (URLs), duration_ms }`. Token mints add `{ event: "token_mint", token_name, token_id }` only. No secret values, installation tokens or D1 ids. The durable trail is the objects themselves plus a run comment that Step 2 and later steps post on the kickoff epic. If retention turns out too short, a factory-owned KV or D1 store is created by hand under the D1/R2 rule (follow-up, not the proof of concept).

### 8. The factory's own deploys and previews

- **Production:** a merge to `main` runs `deploy.yml`, whose job uses GitHub environment **`production`** (required reviewer **Diadem**, deployment branches `main` only) and secret `CLOUDFLARE_API_TOKEN_PRODUCTION`. Nothing reaches Worker `project-factory` without Diadem's approval click (same as we-met 0007).
- **Previews:** **none for the factory's first slice.** A preview of Worker `project-factory` would sit next to its secrets, and a separate preview Worker needs another PR-reachable token. PR confidence for `project-factory` comes from CI (`npm run check`) with mocked GitHub, Linear and Cloudflare APIs (see Consequences). Factory-made repos get a minted **Worker-scoped Editor** preview token in `CLOUDFLARE_API_TOKEN_PREVIEW` when `provision_cloudflare` runs. If previews are wanted later for `project-factory` itself, they use a separate Worker `project-factory-preview` with no secrets, forced `dry_run`, and a Worker-scoped Editor token for that Worker only, never an account-wide one.

### 9. Steps that need Diadem's approval

| Step                                                                     | Why                     | Where he approves                                         |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------- |
| Starting any new project (yes + name)                                    | Product call (DIDI-847) | Chat, quoted verbatim on Linear, passed as `approval_ref` |
| Any production deploy of the factory or of a factory-made project        | Standing rule           | GitHub `production` environment approval                  |
| Any change to App permissions, token scopes, or what the factory creates | Locked block            | Urgent Ready for maintainer ticket                        |
| D1 or R2 for any project                                                 | D1/R2 rule              | Manual, outside the factory                               |
| DNS or custom domains                                                    | Individual approval     | Outside the factory                                       |
| Merging factory PRs                                                      | AGENTS.md               | GitHub review                                             |
| Deleting test repos                                                      | Factory never deletes   | Diadem, by hand                                           |

### 10. Product decisions (Diadem, Oct 26, 2026)

**Diadem, Oct 26, 2026, 3:16 PM ET (verbatim), Q1 (who creates each new project's Cloudflare deploy tokens):**

> "Let the factory create the Cloudflare tokens from the start"

The factory Cloudflare token (`PROJECT_FACTORY_CLOUDFLARE_API_TOKEN`, DIDI-843) gets Account › Account API Tokens › Edit, limited to the Didi Build account, in addition to Workers Scripts › Edit. Guardrails: the factory only mints Workers Editor tokens scoped to the single Worker `<name>` (or `<name>-preview`). It never grants D1, R2, DNS, zone or token-management permissions to a minted token. It logs every mint by token name and id only, never the value.

**Diadem, Oct 26, 2026, 3:18 PM ET (verbatim), Q2 (GitHub App Environments permission):**

> "Yes, add Environments read and write to the GitHub App"

The GitHub App gets repository permission **Environments: Read and write**. The factory creates the `production` environment on repos it created (required reviewer Diadem, deployments from `main` only) and writes the minted production token there as `CLOUDFLARE_API_TOKEN_PRODUCTION`. It never reads or changes environments on existing repos.

**Diadem, Oct 26, 2026, 3:19 PM ET (verbatim), Q3 (default repo visibility):**

> "New repos should be public by default"

Repos are public so the free-plan required-reviewer gate works. Because of that, no secret, seed, sender address or D1 id is ever committed. Making a repo private later is Diadem's call per project and needs GitHub Team to keep the gate.

### 11. One sitting for DIDI-842, DIDI-843 and DIDI-844 (dashboards only, no commands)

The Worker doesn't need to be deployed first: Diadem creates the empty Worker himself, and later deploys keep its secrets (`wrangler deploy` does not remove secrets).

1. **Cloudflare › Workers & Pages › Create › Start with Hello World**, name **`project-factory`**, Deploy. (A placeholder; DIDI-844's first approved deploy replaces the code.)
2. **Cloudflare › Manage account › Account API Tokens › Create Token › Custom token**
   - a. **`project-factory`** (DIDI-843): Account › Workers Scripts › Edit and Account › Account API Tokens › Edit; account resources: Didi Build only. Copy the value.
   - b. **`project-factory-ci-production`**: Workers Editor scoped to Worker **`project-factory`** (or Account › Workers Scripts › Edit if Worker scoping isn't offered). Copy the value.
3. **Linear › Settings › Account › Security & access › Personal API keys › New API key** (DIDI-842): label **Project factory**, permission **Write**, team access **Didi Build** if offered. Copy the value.
4. **Cloudflare › Workers & Pages › project-factory › Settings › Variables and Secrets › Add**, type **Secret**, one each, then Deploy:
   - `PROJECT_FACTORY_GH_PRIVATE_KEY`: open the `.pem` in a text editor and paste everything, including the BEGIN and END lines (DIDI-844)
   - `PROJECT_FACTORY_LINEAR_API_KEY`: value from step 3 (DIDI-842)
   - `PROJECT_FACTORY_CLOUDFLARE_API_TOKEN`: value from step 2a (DIDI-843)
   - `PROJECT_FACTORY_BEARER_TOKEN`: a new random value of at least 32 characters (the browser's password generator works). Paste the same value into the bot's secure form when the Project factory connector is added.
5. **GitHub › didi-build/project-factory › Settings › Environments › New environment `production`**: Required reviewers: Diadem. Deployment branches and tags: Selected, `main`. **Add environment secret** `CLOUDFLARE_API_TOKEN_PRODUCTION` = value from step 2b.
6. **GitHub › didi-build/project-factory › Settings › Secrets and variables › Actions › New repository secret** `CLOUDFLARE_ACCOUNT_ID` = the account id (Workers & Pages overview, right sidebar).
7. Delete the local `.pem`. Values are entered only in those dashboards (or the secure form), never in chat or Linear.

`PROJECT_FACTORY_GH_APP_ID` and `PROJECT_FACTORY_GH_INSTALLATION_ID` are **not** entered by Diadem: they are `vars` in `wrangler.jsonc` (DIDI-844 comment, Oct 25, 2026).

## Reasons

- **Worker plus MCP** is the locked direction. It keeps credentials in one place that only Diadem-approved code can read, and bots get a real connector instead of shelling out.
- **Stateless converge functions** keep each tool small and safe to re-run, without a state store under the D1/R2 rule. The systems themselves (GitHub, Linear, Cloudflare) are the source of truth.
- **Default dry run plus `approval_ref`** keeps Diadem's yes visible on every write.
- **Diadem creates the Worker himself** (dashboard), so the secrets and the Worker-scoped CI token can all be done in one sitting before any code exists, with no `wrangler secret put` and no laptop.
- **No factory previews in the first slice** means no PR-reachable Cloudflare token exists for Worker `project-factory` at all. Per-project preview tokens are Worker-scoped Editor tokens minted by the factory.
- **Factory-minted deploy tokens** keep Diadem out of per-project Cloudflare dashboards while scoping each token to one Worker and logging mints without storing values.

## Alternatives considered

- **GitHub Actions in `project-factory` as the runtime** (`workflow_dispatch` per tool). Rejected: secrets become GitHub secrets that a workflow edit in a PR can reach, unless every run waits on an environment approval. Bots would need their own GitHub dispatch token. There is no MCP interface, runs are slower, and it contradicts the locked direction.
- **Worker plus Cloudflare Workflows** (one durable `create_project` that waits for Bootstrap and retries steps). Deferred: three short idempotent tools don't need durable state yet, and Workflows add a binding plus possible token scope. Revisit when one call runs all three steps end to end.
- **Stateful `McpAgent` (Durable Object).** Rejected for the proof of concept: there is no session state to keep.
- **Org PAT (like `BOOTSTRAP_TOKEN`) instead of the App.** Rejected: it is tied to a user and readable by any workflow it's shared with. The App exists and its tokens last 1 hour.
- **Linear OAuth app** (actions show as "Project factory"). Later. The personal key is fine for the proof of concept (DIDI-842 option A).
- **Cloudflare Workers Builds** for new repos (no Cloudflare token in GitHub). Rejected: production would deploy on merge without Diadem's GitHub environment approval.
- **Factory writes deploy workflows into each repo.** Rejected: workflows belong in Launchpad so all repos stay the same and the factory only verifies them.
- **Bots holding credentials directly.** Rejected by the locked access rules.

## Consequences

- DIDI-844 builds sections 1 to 3 and 5 to 8 for `create_project_repo`, plus `project_status`. Its "README with `wrangler secret put` commands" item becomes the dashboard sitting in section 11. Drop "Worker deploys to preview on PR" from the first-slice acceptance criteria; use CI with mocked APIs and no factory preview (CTO to update the ticket text, which is not a product change).
- DIDI-842 and DIDI-843 can be done in the section 11 sitting today. DIDI-843 must include Account API Tokens Edit (section 10, Q1). The Worker doesn't have to be deployed first.
- DIDI-840 needs **Environments: Read and write** on the App (section 10, Q2; maintainer ticket).
- DIDI-846 implements `provision_cloudflare` including minting Worker-scoped Editor deploy tokens and writing GitHub secrets and the `production` environment secret (sections 3 and 10).
- **New Launchpad ticket needed before DIDI-846:** add `deploy.yml` (production environment, Diadem approval, `CLOUDFLARE_API_TOKEN_PRODUCTION`). Also change the "Workers Scripts Edit only" wording in `preview.yml` and `0004-component-gallery` to **Worker-scoped Editor on `<name>` only** (preview token is a Worker-scoped Editor token). Any account-wide Workers Edit token in a repo-level secret lets a PR overwrite Worker `project-factory` and read its secrets.
- New repos get nodrift scaffolding by default (personal data `true`), because the App can't set repo variables before Bootstrap.
- No Linear `repo` label exists yet for `didi-build/project-factory`. Add `didi-build/project-factory` to the `repo` group by hand (CTO).
- Existing risk, unchanged here: org secret `BOOTSTRAP_TOKEN` (a PAT with Administration, Contents and Issues write) is readable by any workflow in repos it's shared with. Replacing it with App installation tokens is a later candidate.
