# Swell Skills

Your AI coding agent, now fluent in [Swell Commerce](https://www.swell.is) development.

Install once and your agent picks up everything it needs to build, validate, and ship a [Swell App](https://developers.swell.is/apps): the file system contract, the `swell` CLI, the validate → deploy → verify cycle, and the non-obvious rules for payment, shipping, and tax integrations.

Swell Apps package data models, admin content views, settings, notifications, webhooks, edge functions, and integration extensions into a single store extension.

## Example

Tell your agent:

> Add product reviews with star ratings. Customers submit from the storefront, admins moderate from the dashboard, and approved reviews update an average rating shown on each product.

The agent picks the right model shape, scaffolds the `review.approved` event, builds the moderation view, writes a hook that recomputes the average rating on the parent product, and runs the full validate → deploy → verify loop.

## Install

**Claude Code** — full plugin

```
/plugin marketplace add swellstores/skills
/plugin install swell-app@swell
```

**Cursor, Codex, Claude Desktop, and other agents** — skill files only

```
npx skills add swellstores/skills
```

## Prerequisites

- A [Swell](https://www.swell.is) store
- The `swell` CLI installed and authenticated: `npm install -g @swell/cli`

## What's included

- **`swell-app`** — Build and modify Swell Apps: data models, content views, settings, notifications, webhooks, edge functions, payment / shipping / tax integration extensions, and the version → install → release publishing lifecycle.

This is the first piece of a broader effort to make Swell development AI-native. More skills are in active work.

## Feedback

Issues welcome at [github.com/swellstores/skills/issues](https://github.com/swellstores/skills/issues).

## License

MIT
