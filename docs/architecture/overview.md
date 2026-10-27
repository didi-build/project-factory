# Architecture overview — Project Factory

Replace this file with your system’s architecture. Keep it short; link to deeper docs as the project grows.

## Purpose

Tool to help set-up new projects

## Boundaries

- **In scope:** What this repository owns.
- **Out of scope:** What lives in other repos, vendors, or platforms.

## Interfaces

- **Inbound:** Remote MCP over `POST /mcp` on Worker `project-factory`, with bearer auth (`PROJECT_FACTORY_BEARER_TOKEN`) and `X-Factory-Caller` for audit.
- **Outbound:** GitHub App installation API (repo creation), Linear GraphQL API (`PROJECT_FACTORY_LINEAR_API_KEY`), Cloudflare account API (Workers scripts and account token minting). See [ADR 0004](../decisions/0004-project-factory-architecture.md).

Factory tools: `create_project_repo`, `create_linear_project`, `provision_cloudflare`, and read-only `project_status`. All write tools default to `dry_run: true` and require `approval_ref`.

## Environments

| Environment | Purpose            | Notes                      |
| ----------- | ------------------ | -------------------------- |
| local       | Developer machines | `.env` from `.env.example` |
| staging     | Pre-production     | Fill in when you have one  |
| production  | Live               | Fill in when you have one  |

## Data flow

Describe the main paths (request → logic → storage → response). A simple diagram or bullet flow is enough for v1.

## Open questions

List unknowns explicitly. Resolve them via `docs/decisions/` before building the affected feature.
