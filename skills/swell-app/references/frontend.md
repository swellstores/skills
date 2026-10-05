# Frontend

Optional `./frontend/` directory: a web app that Swell builds, hosts, and connects to the store where the app is installed. `swell app push` deploys it and the Swell dashboard embeds it for `admin` and `integration` apps. No Cloudflare account or separate hosting is involved.

Scope of this reference: `admin` and `integration` apps that need custom UI beyond content-model views. A `storefront` app uses the same folder and templates for the storefront itself; building a storefront is not covered here.

## When to use

Pick a frontend over content-model views when:

- The UI cannot be expressed as `list`/`edit`/`new` views — multi-step flows, embedded third-party widgets, custom dashboards.
- The app needs its own server endpoints next to that UI.

Otherwise prefer content-model views: cheaper to build, free admin chrome, no build step.

The frontend is **orthogonal to `components/`**, not an alternative. Integration apps may ship both — `components/` for checkout-context Preact, `frontend/` for dashboard-context admin UI managing the same data.

## Scaffold from a template

For a new frontend, scaffold from a Swell template. The Swell templates carry the hosting profile, the connection helpers, and a working example of every pattern this reference describes.

| `--frontend` | What it is | Choose it when |
|---|---|---|
| `swell-vinext` | Vinext — the Next.js App Router API on Vite: server and client components, route handlers, `next/*` imports | **Default.** Use it unless there is a reason not to. |
| `swell-react` | React + Vite rendered in the browser, plus a small Worker for server endpoints. No server rendering, no router. | The app is a client-side tool and the user prefers plain React. |

```bash
swell create frontend --frontend swell-vinext -y            # add a frontend to the app in the current directory
swell create app <id> -t admin --frontend swell-vinext -y   # new app with a frontend
```

- **Always pass `--frontend` together with `-y`.** `swell create frontend -y` without it errors; `swell create app … -y` without it creates the app with no frontend.
- `-p npm|yarn|pnpm|bun` picks the package manager (default: the app's lockfile, else npm). Requires Node.js 22.22.2 or newer.
- The scaffold writes `frontend/`, makes the app root a package workspace that includes it (dependencies install from the app root), and sets `"frontend": { "hosting": "managed" }` in `swell.json`.

The home page is a demonstration: replace it, keep the helpers. In the Vinext template, `next/*` imports come from Vinext — do not install the `next` package.

The remaining `--frontend` values (`nextjs`, `astro`, `nuxt`, `react`, `hono`, `angular`) are self-hosted starters without any of this. Use one only when the user explicitly asks for it — see "Self-hosted frontends" at the end.

## How the frontend connects to Swell

Swell supplies request context containing store configuration, app credentials, and viewer identity. `@swell/apps-sdk` verifies the context and provides server-side API clients.

Before changing the frontend, read `frontend/README.md` and the relevant example code it points to. Reuse the scaffold's connection helpers and follow its existing patterns for server-side reads, browser interactions, and protected endpoints. Do not recreate header parsing, session validation, or client initialization.

For SDK capabilities beyond the examples, consult the installed `@swell/apps-sdk` README.

The rules that hold whichever template is used:

- **The context is server-only.** Never expose the full context or its credentials to the browser, or log them. Initialize the browser client with the SDK's public configuration; expose other fields only when intentionally needed by the UI. `@swell/apps-sdk` itself is a server library: importing it from browser code fails the build.
- **Verify once per request and reuse the result.** Keep server context and clients scoped to that request. Use the scaffold's helpers to share the verified context throughout the request.
- **No context and a bad context are different things.** Missing context means the frontend is not connected to Swell. Invalid or expired context is a verification failure — surface the error instead of continuing as a visitor.
- **The Backend client acts as the app, not as the viewer.** It uses the app's access token, scoped by `swell.json` `permissions`, and it works the same for an anonymous visitor as for the store owner. The frontend's address is public, so an endpoint or page that returns Backend data without checking who is asking is open to the internet. Authorize first; let the server choose the endpoint and query, and take from the browser only the inputs the operation needs.
- **Backend write-validation failures throw.** `SwellBackendAPI` throws on write-validation failures; follow the SDK's error handling rather than swell-node's `result.errors` pattern.
- **Store users.** `context.storeUser` is `{ userId, storeId }` when the viewer is signed in to the store's dashboard and `null` for a visitor. `requireStoreUser` returns it or throws a `SwellError` with status 401 and code `store_user_required`. Anyone with dashboard access counts — including partners and Swell support, who may not appear in the store's own user list. Swell only answers "is this a store user"; which store user may do what is the app's decision.
- **Writes go in POST/PUT/DELETE handlers or server actions, never in GET handlers or page renders.** Swell withholds the store user's identity on any cross-origin request that is not `GET`/`HEAD`/`OPTIONS`, which is what protects a store-user-only write from being triggered by another site. A `GET` that changes data has no such protection. Start every store-user-only write with `requireStoreUser`, then validate input, then apply the app's own permissions.
- **Endpoints live under `/app-api`.** Swell owns `/api` and `/functions` on the frontend's address: a handler declared there is never reached. Push warns about Vinext route files under `/api`, but cannot see routes declared any other way.
- **Runtime configuration comes from app settings.** Managed hosting does not provision custom runtime variables or bindings. Local environment files are not a deployment configuration mechanism, but build tools can embed environment values into compiled output. The CLI explicitly excludes `.dev.vars*` from uploads; `.env*` exclusion relies on the scaffold's `.gitignore`. Read merchant configuration with the Backend client's `settings()`; what SKILL.md says under "Settings" (not a secret store) and "App Permissions" (`read_settings` once `permissions` is non-empty) applies here too.
- **Responses that depend on the viewer are never cached.** Send `Cache-Control: private, no-store` from endpoints, as the scaffold's examples do.

## Local development

Run from the app root, not from `frontend/`:

```bash
swell app dev                # preview as a visitor
swell app dev --store-user   # preview as the store user logged in to the CLI
```

`swell app dev` pushes the app's configs, starts the frontend's own dev server (`npm run dev` on the first free port in 4000–4100; pin it with `--frontend-port`), and routes it through Swell so requests carry a real context. It prints `View it at https://<storeId>--<sessionId>--local.swell.store` followed by `Visitor preview.` or `Store-user preview.` Edits reload in place.

- **The default preview is a visitor.** `context.storeUser` is `null` and store-user-only endpoints answer 401 — that is the expected result, not a bug.
- **`--store-user` is how a dashboard app is previewed.** Requests are signed as the store user logged in to the CLI. Anyone who has the preview address gets the same access while the session runs, so do not share it. Not available for storefront apps.
- **The dashboard shows the deployed build**, not the dev session. To see the app inside the dashboard, `swell app push` first.
- Running `npm run dev` inside `frontend/` starts the frontend without Swell. The scaffold's home page then says "Not connected to a store" and helpers that need a store throw — expected; use `swell app dev`.
- `frontend/.dev.vars` holds local-only variables, including the `SWELL_VERIFY_HEADERS` switch for signature verification; the file documents it. It is never deployed, and deployed frontends always verify.

Everything `swell app dev` does to functions still applies while it runs — see the Local Development notes in `references/cli.md`.

## Deploy

```bash
npm run check     # in frontend/: typecheck (and lint) and build
swell app push    # from the app root: build and deploy
```

`swell app push` uploads the app's files, then builds the frontend locally, packages the Worker and its assets, and hands the package to Swell, which deploys it. The lines that prove it:

```
Building managed <framework> frontend...
Deployed managed frontend package <digest>.
View the <app name> app in your dashboard at <url>.
```

- A managed frontend is built and deployed on **every** unscoped `swell app push` — there is no "unchanged, skipped" case. A scoped push of `frontend/`, any file or directory under it, or the root `package.json` also rebuilds and deploys the frontend. Pushes scoped to other paths leave the frontend deployment alone. `--no-deploy` uploads sources without building or deploying, so the previous build stays live.
- Push always targets the **test** environment. Releasing to other environments and stores goes through `swell app version` / `install` — see `references/app-publishing.md`.
- The deployed frontend is served at `https://<storeId>--<installedAppId>--app.swell.store` and, for store users, inside the dashboard.
- **The Worker profile is fixed.** Keep `compatibility_date` and `compatibility_flags` in `frontend/wrangler.jsonc` as scaffolded and add no bindings or `vars`; a changed profile is rejected. Node.js built-ins are available as is.
- The built package (Worker plus assets) is limited to 8 MiB.
- Managed hosting supports Vinext and client-side React + Vite. Next.js with OpenNext is refused with a message pointing to self-hosting.

There is no `swell inspect frontend` resource type — the push output above, then opening the app, is the confirmation.

`swell.json`'s `frontend.hosting` selects this pipeline. Moving a deployed app to self-hosting later is a legitimate choice, made by setting `"hosting": "self-hosted"` explicitly — deleting the block instead is rejected with `Set frontend.hosting to self-hosted explicitly to change hosting.`

## In the dashboard

The dashboard renders the frontend in a frame at `/app/<app_id>/...` and signs the store user in to it; the app implements nothing for this and sees the result as `context.storeUser`.

There is no automatic navigation entry. Link to the frontend from content models with `frontend://path/{id}` in `nav.link` and `actions[].link`. By default the link opens inside the dashboard; with `target: "blank"` it opens the frontend's own address in a new tab. `{id}` and other placeholders expand against the current record before the link fires.

```json
{
  "views": [
    {
      "id": "edit",
      "actions": [
        "save",
        { "id": "open-app", "label": "Open in app", "link": "frontend://records/{id}/edit" }
      ]
    }
  ]
}
```

A non-empty `actions` array **replaces** the view's default actions — it does not append. Record views default to `actions: ["save"]` with `extra_actions: ["delete"]`; list views default to `actions: ["new"]`, and `extra_actions` replaces the same way. Declaring only `open-app` on an edit view ships a record the merchant can open in your app but can no longer save, so re-declare every default you still want.

## Gate alignment

The skill's five-gate dev cycle applies with these deviations:

- **Gate 2 (Schema)** — n/a, no schema-backed manifest. The scaffold's README and the SDK's README are the references.
- **Gate 3 (Author & Validate)** — `npm run check` in `frontend/` must pass.
- **Gate 4 (Deploy & Verify)** — confirm `Deployed managed frontend package <digest>.` in the push output. There is no frontend inspect command; verify the deployed app.
- **Gate 5 (Test)** — exercise both viewers:
  1. `swell app dev`, open the printed address: public pages render, store-user-only UI shows its visitor state, and store-user-only endpoints answer 401.
  2. `swell app dev --store-user`: the same pages and endpoints now work.
  3. After `swell app push`, open the app from the dashboard and repeat the store-user checks against the deployed build.
  4. Open the deployed frontend's own address in a private browser session without dashboard authentication: public pages render, store-user-only UI shows its visitor state, and store-user-only endpoints answer 401.

  Test store-user-only writes from the page itself. A bare `curl -X POST` has no `Origin` header, so Swell treats it as cross-origin and withholds the store user — it returns 401 even under `--store-user`. To script it, send `-H "Origin: https://<the preview host>"`.

## Self-hosted frontends

Use only on explicit request. The self-hosted `--frontend` values scaffold plain Cloudflare starters into `frontend/` and set `"hosting": "self-hosted"`. What changes:

- **No Swell patterns are included.** Add the SDK yourself — `npm install @swell/apps-sdk@next swell-js` (the `latest` tag is still the 1.x theme SDK, a different API) — and follow the same rules as above: verify the context, keep it on the server, check the store user, serve endpoints under `/app-api`.
- **Deploys go to the developer's own Cloudflare account** through Wrangler. `wrangler login` and a `CLOUDFLARE_ACCOUNT_ID` environment variable are required; without them push uploads the sources and then fails at the Wrangler step.
- **Unchanged frontends are skipped.** Build and deploy run only when the hash of `frontend/**` plus the root `package.json` changed, or with `--force`. Only `Updating frontend deployment...` → `Updated frontend deployment.` confirms a deploy; `View your app at …` prints either way.
- **Link only to the Swell addresses.** The raw `*.workers.dev` URL receives no context, so the app is not connected to a store there.
