---
name: swell-themes
description: "Use this skill to build, restyle or migrate a Swell storefront theme, and to rebuild an existing website's design on Swell. Covers Wave themes (React sections and blocks on @swell/wave-theme-core and ui-kit; swell theme create, check and build; templates, section groups, design settings and fonts, Store text, menus), Proxima / Liquid themes (swell theme pull, dev and push), theme apps (type theme, theme.storefront.app, required apps in theme.apps), client themes and the Theme Store, and moving a site's look, pages, menus and catalog from another platform such as Shopify. Asks how close a rebuild should be before building it. Pair with swell-storefront-extensions when a theme needs an app's data, forms, widgets or pages, with swell-app for that app, and with swell-backend-api for catalog imports. Excludes storefronts written in code in a storefront app's frontend/ (swell-app) and headless sites on the Frontend API (swell-frontend-api)."
allowed-tools: Read, Grep, Glob, Bash
---

# Swell themes

A theme gives a storefront its look and its page layouts, and merchants change it in the storefront app's editor. The storefront app runs the theme: it serves the pages, and it decides how its themes are built. A theme is itself a Swell app, with `"type": "theme"` in `swell.json` and `theme.storefront.app` naming the storefront app it is built for.

## Which storefront app

| Storefront app | Its themes are | Read |
| --- | --- | --- |
| **Wave** (`"app": "wave"`) | React and TypeScript sections and blocks, built on `@swell/wave-theme-core` and Wave's ui-kit and rendered on the server. Merchants edit them in Wave's visual editor or with its AI agent. Wave runs every storefront extension: apps' blocks, data, forms, pages and ratings. | `references/wave.md` |
| **Proxima** | Liquid themes in the structure of Shopify's Online Store 2.0 themes, run as they are. No storefront extensions, no `swell theme check`. | `references/proxima.md` |

Wave is Swell's own storefront app and the one Swell recommends. Build on Wave unless the user wants to keep running an existing Liquid theme unchanged; Wave can also import a Shopify theme and rebuild it (see "Rebuilding an existing site").

Not themes, and not this skill: a storefront written in code in the `frontend/` of a `storefront` app is the `swell-app` skill's; a headless site on the Frontend API, such as one started from the Origin or Horizon kits, is the `swell-frontend-api` skill's.

## Rebuilding an existing site: ask first

When the user wants to move, copy, rebuild or match an existing website, **ask before building**, and ask in these terms. Wave's own rebuild asks the same questions.

1. **How close should it be?**
   - **Recreate it closely**: the same layout, sections, words, photos, logo, menus and products. Only for the user's own site, or one they have the rights to: confirm it.
   - **Take its look and feel**: its colors, fonts, spacing and layout ideas, with the user's own words and photos.
   - **Start from a theme**: one of Swell's themes, restyled to the brand.
2. **In code, or in Wave's editor?**
   - **In code** (this skill): a theme app in a repo that a developer keeps, versions, hands to a client or sells, with sections of its own for whatever the source site does that Swell's sections don't.
   - **In Wave's editor**, with no code: **Redesign this storefront…** in an empty agent chat, or **Rebuild a website** on a new storefront's start screen, takes the site's address and offers **Recreate it closely** or **Just take its look and feel**; **Upload theme** in the dashboard rebuilds a Shopify theme zip or a plain HTML site as a Wave storefront. All are billed as AI usage, and they change one storefront's files instead of producing a reusable theme.
3. **What data comes over, and from where?** Products, categories, images, menus, content pages and policies; which platform; and whether the user has admin access to it (for Shopify, an Admin API token) or only the public site.
4. **What do the site's features need?** For each feature beyond display (loyalty, reviews, a store finder, chat, bookings): which service runs it today, what data must move with it (balances, reviews, locations), and whether an app in the Swell App Store already does it.

Then say what the chosen route covers and what it doesn't, before starting.

**A close recreation can be done, so never let a shortcut read as a platform limit.** A user who sees a simplified page assumes Swell can't do better.

- Swell's core sections change only through design tokens and their own settings, and the settings go further than they look: the core header has a `centered` layout with the menu on its own row, an over-the-hero mode and its own colors; the core product details take delivery promises and detail rows. Where the brand needs more than that (a header with quick links and a large search, a mega menu with images, a large price box), build a section of your own from ui-kit pieces and use it in the template instead. That is how a close copy is made; see `references/wave.md`.
- When you simplify something or leave it out, say so in the result, with what an exact match would take: "The product page uses the core product details. A buy-box section of our own would match the source's price box."
- Before saying something can't be done, read `references/capabilities.md`. Most "Wave can't" answers have a section or app route.
- Sort each feature of the source site that does more than display: built into Swell (sale prices, subscriptions, customer groups, gift cards), a theme section, a required app that adds it to the storefront (`swell-storefront-extensions`), or an outside service. Tell the user which, and how it would be built.

The step-by-step for a rebuild in code is `references/wave-migration.md`.

## A Wave theme in brief

Needs the Swell CLI 2.9.41 or later (`npm install -g @swell/cli`) and Node.js 22 or later. Older CLIs list only `dev`, `init`, `pull` and `push` under `swell theme --help`, with no hint to upgrade. The store needs Wave installed (without it the first push stops with "No compatible storefront apps found for this theme."), and products, categories, content pages and blog posts so every page type has data.

```sh
swell theme create my-theme -y   # Tide starter: folder my-theme/, id my_theme, name "My Theme"
cd my-theme
swell theme check                 # "file: message (rule)", then the fix; --json for tools; exit 1 on an error
swell theme build                 # writes app/ only when there are no errors; never edit app/
cd app && swell app push          # first push creates a storefront in the test environment and prints its preview address
cd .. && cp app/.swellrc .        # after the first push: keeps the theme's app id for later builds
```

- A name with spaces makes a folder with spaces: use a hyphenated name.
- Before writing sections, read `node_modules/@swell/wave-theme-core/AGENTS.md`, the rules `swell theme check` enforces with their fixes, and `node_modules/@swell/wave-theme-core/types/ui-kit.d.ts`, the components and the store data a section gets.
- `swell theme check` is the inner loop: fix every error it names, then build and push. Wave checks again when it receives the files, rendering each section with sample data and with an empty store.

## Theme apps

- `swell.json`: `"type": "theme"`, a semver `version`, `theme.storefront.app`, and a `description` of at most 70 characters (`swell app push` refuses a longer one).
- **Features beyond display live in apps.** Anything that keeps records, runs server logic, calls an outside service or checks who the customer is belongs in an ordinary app that adds it to the storefront, and the theme's sections read the app's data and post to its forms. A theme whose pages are built around the app names it in `theme.apps` as a required app; one whose sections only add to a page when the app is there doesn't need to. The app side is the `swell-storefront-extensions` skill's; the theme side is in `references/wave.md`, "Required apps".
- `swell app push` reaches the store's test environment. Versions and releases are the `swell-app` skill's `references/app-publishing.md`.
- A theme for one client is a private theme app in the client's store; a theme for many stores is sold in the Theme Store: `references/theme-store.md`.

## References

| File | Read when |
| --- | --- |
| `references/wave.md` | Writing or changing anything in a Wave theme |
| `references/wave-migration.md` | Rebuilding an existing site as a Wave theme in code: capture, catalog import, menus, design, sections, checking against the source |
| `references/capabilities.md` | Asked whether a storefront feature can be built, or sorting a source site's features |
| `references/proxima.md` | A Liquid theme |
| `references/theme-store.md` | Building a theme for a client, or selling one |
