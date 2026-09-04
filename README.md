# Swell Skills

Your AI coding agent, now fluent in [Swell Commerce](https://www.swell.is) — every surface of the platform.

Install once and your agent picks up what it needs to work with Swell the way an experienced Swell developer would: the right API for the job, the validate → deploy → verify loops, and the non-obvious rules that aren't guessable from method names.

## What's included

- **`swell-app`** — Build and modify [Swell Apps](https://developers.swell.is/apps/overview): data models, content views, settings, notifications, webhooks, edge functions, payment / shipping / tax integration extensions, and the version → install → release publishing lifecycle.
- **`swell-backend`** — Server-side integration with the [Backend API](https://developers.swell.is/backend-api/introduction): querying and write semantics, batch and transactions, events and webhooks, and the commerce lifecycles (orders, payments, subscriptions, inventory) via `swell-node` or direct HTTP.
- **`swell-storefront`** — Headless storefronts on the [Frontend API](https://developers.swell.is/frontend-api/introduction) with `swell-js`: catalog, cart and checkout, customer accounts, payments, subscriptions, and localization.

More surfaces are in active work — themes and hosted storefront apps are next.

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

Previously installed `swell-app@swell`? It's now part of the `swell` plugin — run `/plugin uninstall swell-app@swell`, then install `swell@swell`.

**Cursor, Codex, Claude Desktop, and other agents** — skill files only

```
npx skills add swellstores/skills
```

## Prerequisites

- A [Swell](https://www.swell.is) store
- For app development: the `swell` CLI installed and authenticated (`npm install -g @swell/cli`)
- For backend work: a store secret key; for storefront work: a store public key

## Feedback

Issues welcome at [github.com/swellstores/skills/issues](https://github.com/swellstores/skills/issues).

## License

MIT
