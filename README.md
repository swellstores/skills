# Swell Skills

Your AI coding agent, now fluent in [Swell Commerce](https://www.swell.is) — every surface of the platform.

Install once and your agent picks up what it needs to work with Swell the way an experienced Swell developer would: the right API for the job, the validate → deploy → verify loops, and the non-obvious rules that aren't guessable from method names.

## What's included

- **`swell-app`** — Build, deploy and publish [Swell Apps](https://developers.swell.is/apps/overview) with the `swell` CLI: admin, integration and code-based storefront apps. Covers data models, dashboard views and actions, settings, permissions, notifications, webhooks, functions and workflows, payment / shipping / tax extensions, and app frontends on managed Swell hosting or self-hosted on Cloudflare.
- **`swell-backend-api`** — [Backend API](https://developers.swell.is/backend-api/introduction) operations: querying and aggregation, write semantics, batch and transactions, events and webhooks, files, coupons, promotions and gift cards, and the commerce lifecycles (orders, payments, refunds, returns, invoices, subscriptions, inventory, accounts). Applies inside an app and to independent integrations using `swell-node`, the Apps SDK or direct HTTP.
- **`swell-frontend-api`** — [Frontend API](https://developers.swell.is/frontend-api/introduction) operations: catalog and content, shopper sessions, cart and checkout, payments, customer accounts, subscriptions, localization and public app data. Applies inside an app frontend and to independently hosted storefronts using `swell-js`.

The skills compose. `swell-app` covers the app around the code — scaffolding, runtime clients, resources, deployment — and the API skills cover what a query, a write, a cart or an order does. An independent integration or storefront uses an API skill on its own.

Claims in these skills are checked against the platform's own source and run on a live store, not just read from the documentation — where the two disagree, the platform wins and the skill says so.

Proxima / Liquid theme authoring is not covered.

## Example

Tell your agent:

> Add product reviews with star ratings. Customers submit from the storefront, admins moderate from the dashboard, and approved reviews update an average rating shown on each product.

The agent picks the right model shape, scaffolds the `review.approved` event, builds the moderation view, writes a hook that recomputes the average rating on the parent product, wires the storefront submission through `swell-js`, and runs the full validate → deploy → verify loop.

## Install

**Claude Code** — full plugin

```
/plugin marketplace add swellstores/skills
/plugin install swell@swell
```

Upgrading from 0.6.0 or earlier: `swell-backend` and `swell-storefront` are replaced by `swell-backend-api` and `swell-frontend-api`.

```
claude plugin marketplace update swell
claude plugin update swell@swell
```

Previously installed `swell-app@swell`? It's now part of the `swell` plugin — run `/plugin uninstall swell-app@swell`, then install `swell@swell`.

**Cursor, Codex, Claude Desktop, and other agents** — skill files only

```
npx skills add swellstores/skills
```

Upgrading from 0.6.0 or earlier: remove the two retired skills, then add the set again. `npx skills update` alone does not install the new skills.

```
npx skills remove swell-backend swell-storefront
npx skills add swellstores/skills
```

## Prerequisites

- A [Swell](https://www.swell.is) store
- For app development: the `swell` CLI installed and authenticated (`npm install -g @swell/cli`)
- Outside an app: a store secret key for Backend API work, a store public key for Frontend API work

## Feedback

Issues welcome at [github.com/swellstores/skills/issues](https://github.com/swellstores/skills/issues).

## License

MIT
