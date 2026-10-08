# Swell Skills

Skills that teach AI coding agents to build on [Swell](https://www.swell.is): Swell Apps, the Backend API and the Frontend API.

They give an agent what the API reference does not: which API fits the job, how to build, deploy and check an app, and the rules you only find by running the code. The skills were checked against the platform's source and tested by building real apps on a live store.

## Skills

| Skill | Covers |
| --- | --- |
| `swell-app` | Building, deploying and publishing [Swell Apps](https://developers.swell.is/apps/overview) with the `swell` CLI: data models, dashboard views and actions, settings, permissions, functions and workflows, webhooks, notifications, payment, shipping and tax extensions, and app frontends, including storefronts. |
| `swell-backend-api` | Server-side work with the [Backend API](https://developers.swell.is/backend-api/introduction): queries, writes, batches and transactions, events and webhooks, files, orders, payments, subscriptions, products and inventory, accounts, coupons and promotions. |
| `swell-frontend-api` | Storefront work with the [Frontend API](https://developers.swell.is/frontend-api/introduction): catalog and content, shopper sessions, cart and checkout, payments, customer accounts and subscriptions. |

The agent loads the skills it needs for the task:

| You are building | Skills used |
| --- | --- |
| A Swell App | `swell-app`, with either API skill as needed |
| An integration on your own server | `swell-backend-api` |
| A storefront you host yourself | `swell-frontend-api` |

Liquid themes (Proxima) are not covered.

## Example

> Add product reviews with star ratings. Customers submit from the storefront, admins moderate from the dashboard, and approved reviews update an average rating shown on each product.

The agent designs the review model, adds a dashboard list with approve and reject actions, writes the function that recalculates each product's rating, deploys the app to your test environment and checks that it works there.

## Install

### Claude Code

```
claude plugin marketplace add swellstores/skills
claude plugin install swell@swell
```

Or, inside Claude Code: `/plugin marketplace add swellstores/skills`, then `/plugin install swell@swell`.

### Cursor, Codex and other agents

```
npx skills add swellstores/skills
```

The command asks which agents to install for, and whether to install in the current project or globally.

## Upgrade

Version 0.7.0 renamed two skills. The old names no longer exist.

| Old name | New name |
| --- | --- |
| `swell-backend` | `swell-backend-api` |
| `swell-storefront` | `swell-frontend-api` |

If your project's `AGENTS.md` or `CLAUDE.md` mentions the old names, change them there too.

### Claude Code

```
claude plugin marketplace update swell
claude plugin update swell@swell
```

Run both, in this order: the first fetches the new release, and without it the second finds nothing to update. Then restart Claude Code. `claude plugin list` shows the installed version.

**If `claude plugin list` shows `swell-app@swell`**, you have a version from before the plugin was renamed to `swell`. Replace it:

```
claude plugin marketplace update swell
claude plugin uninstall swell-app@swell
claude plugin install swell@swell
```

### Cursor, Codex and other agents

From 0.7.0 on, `npx skills update` is enough. From an earlier version, run these instead, because `update` does not install the renamed skills:

```
npx skills add swellstores/skills
npx skills remove swell-backend swell-storefront
```

If you installed the skills globally, add `-g` to each command. Afterwards `npx skills list` shows `swell-app`, `swell-backend-api` and `swell-frontend-api`.

## Requirements

- A [Swell](https://www.swell.is) store.
- For app development: the `swell` CLI, installed (`npm install -g @swell/cli`) and logged in (`swell login`).
- For API work outside an app: the store's secret key (Backend API) or public key (Frontend API).

## Changelog

[CHANGELOG.md](CHANGELOG.md) lists what changed in each release.

## Feedback

Issues are welcome at [github.com/swellstores/skills/issues](https://github.com/swellstores/skills/issues).

## License

MIT
