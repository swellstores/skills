# Frontend

Optional `./frontend/` directory: a web app connected to the store where the app is installed. `swell app push` deploys it. With the default managed hosting, Swell builds and hosts it and no Cloudflare account is needed. Hosting the frontend in the developer's own Cloudflare account retains the same Swell connection and app lifecycle — see "Self-hosting on Cloudflare".

This reference covers what every frontend shares: the template, the connection to Swell, endpoints, local development, deployment and hosting. Read it first, then the reference for what is being built:

| Building | App type | Viewers | Then read |
| --- | --- | --- | --- |
| Pages for store users, shown inside the Swell dashboard | `admin` or `integration` | Store users | `references/frontend-dashboard.md` |
| The store's own site | `storefront` | Shoppers | `references/frontend-storefront.md` |

The frontend is separate from `components/`, which holds checkout UI for payment extensions. An integration app may ship both.

## Scaffold from a template

Start from a Swell template. It carries the hosting profile, the connection helpers and a working example of each pattern these references describe.

| `--frontend` | What it is | Use for |
| --- | --- | --- |
| `swell-vinext` | Vinext — the Next.js App Router API on Vite: server and client components, route handlers, server actions | **The default**, for dashboard and storefront apps |
| `swell-react` | React + Vite rendered in the browser, plus a small Worker for server endpoints. No server rendering, no router | A dashboard app that is a browser app from end to end |

```bash
swell create app <id> -t admin --frontend swell-vinext -y   # new app with a frontend; -t storefront for a storefront
swell create frontend --frontend swell-vinext -y            # add a frontend to the app in the current directory
```

Always pass `--frontend` together with `-y`.

The scaffold writes `frontend/`, makes the app root a package workspace that includes it, and sets `"frontend": { "hosting": "managed" }` in `swell.json`. Dependencies install from the app root, so installed packages and their READMEs are in the app root's `node_modules`.

- **The home page is a demonstration.** Replace it and keep the helpers.
- **Vinext is not the `next` package.** `next/*` imports come from Vinext; do not install `next`. `params` and `searchParams` are promises to `await`. `redirect()`, `notFound()`, `next/link`, `router.refresh()`, route handlers and server actions work as in Next.js. Pages render on each request: response caching, prerendering and image optimization are off.
- **The other `--frontend` values** (`nextjs`, `astro`, `nuxt`, `react`, `hono`, `angular`) are plain Cloudflare starters with none of this — see "Self-hosting on Cloudflare".

## How the frontend connects to Swell

Swell sends a signed context with every request it routes to the frontend: the store, the environment, the app's credentials and who is viewing. `@swell/apps-sdk` verifies it on the server and provides the API clients; `swell-js` is the browser client.

Before changing the frontend, read `frontend/README.md` and the example code it points to. Reuse the scaffold's connection helpers and follow its patterns for server-side reads, browser interactions and protected endpoints. Do not recreate header parsing, session validation or client initialization. For SDK capabilities beyond the examples, read `node_modules/@swell/apps-sdk/README.md` in the app root.

There are two clients. The **Storefront client** works on the viewer's own session — catalog, cart, account — on the server and in the browser. The **Backend client** runs on the server only and acts as the app.

The rules that hold for every template and every app type:

- **The context is server-only.** Never expose the full context or its credentials to the browser, or log them. Initialize the browser client with the SDK's public configuration, as the scaffold does. `@swell/apps-sdk` itself is a server library: importing it from browser code fails the build.
- **Verify once per request, through the scaffold's helper.** The signed context is valid for about a minute, so verifying it again late in a slow request fails. Keep the context and the clients inside the request: no module-level client. For managed hosting, leave the helper file as scaffolded (`lib/swell.ts` in Vinext, `worker/swell.ts` in React). For self-hosting, apply the context-verification options described under "Self-hosting on Cloudflare"; keep the helper's per-request lifecycle.
- **No context and a bad context are different things.** A missing context means the frontend is not connected to Swell. An invalid or expired context is a verification failure — surface the error instead of continuing as a visitor.
- **The Backend client acts as the app, not as the viewer.** It uses the app's access token, scoped by `swell.json` `permissions`, and returns the same data whoever asks. Every address of the frontend is public, so a page or endpoint that returns Backend data without checking who is asking is open to the internet. Authorize first; let the server choose the endpoint and query, and take from the browser only the inputs the operation needs.
- **Find out who is viewing from Swell, never from what the browser sends.** Swell identifies two kinds of viewer and each has its own rules: a store user, in `context.storeUser` (`references/frontend-dashboard.md`, "Authorize store users"), and a customer, in the Storefront client's session (`references/frontend-storefront.md`, "Who is viewing"). Everyone else is a visitor. An id in a path, query or body is input anyone can type.
- **Server code changes data only in POST/PUT/DELETE handlers or server actions, never in GET handlers or page renders.** Another site can make a viewer's browser send a `GET` with their identity attached, and a page render cannot save cookies. Changes the browser client makes on the viewer's session are a separate matter, covered in the storefront reference.
- **Backend failures throw.** The Backend client rejects with a `SwellError` (`status`, `code`, `body`), including on a write that fails validation — not the `result.errors` object swell-node returns. A read of an id that does not exist is not a failure: it resolves empty, so test `if (!record)`.
- **Endpoints live under `/app-api`.** Swell answers `/api`, `/graphql`, `/playground`, `/checkout/` and `/functions/` itself on every address it routes to the frontend, so declare no page or handler under them. Push warns about Vinext route files under `/api`, and cannot see routes declared any other way.
- **Swell sets the caching, framing and cross-origin headers.** Every response of a managed frontend goes out as `Cache-Control: private, no-store`, except the build's content-hashed assets, and with Swell's own `Access-Control-Allow-Origin` and frame policy in place of the app's. Do not design around response caching, and do not rely on headers of that kind set in app code. The `Cache-Control: private, no-store` that the scaffold's examples send is harmless; keep it.
- **Runtime configuration comes from app settings.** Managed hosting does not provision custom runtime variables or bindings. Local environment files are not a deployment configuration mechanism, but build tools can embed environment values into compiled output. The CLI explicitly excludes `.dev.vars*` from uploads; `.env*` exclusion relies on the scaffold's `.gitignore`. Read merchant configuration with the Backend client's `settings()`. Settings are not a secret store (`references/settings.md`), and the read needs the `read_settings` scope once `permissions` is non-empty (`references/permissions.md`).

## Frontend endpoint or app function

Both run server code for the app. They are different runtimes with different jobs:

| | `/app-api` handler in `frontend/` | Function in `functions/` |
| --- | --- | --- |
| Runs when | a page or external caller requests its URL | a model event or hook fires, on a schedule, on a dashboard action, or on a call to its route, including a provider callback |
| Knows the viewer | A store user or shopper when present | Not the frontend's viewer |
| Reaches Swell through | the SDK clients | `req.swell` |
| Logs | the `swell app dev` terminal; a deployed managed frontend's logs are not available, and are not in `swell logs` | `swell logs` |

- **Put background work in a function**: reacting to store events, schedules and dashboard actions. A route function also receives external calls, including a provider's callback with the public key in its address (`references/functions-routes.md`). See `references/functions-*.md` and `references/actions.md`.
- **A provider callback goes to a route function first.** Use an `/app-api` handler only for a sender a route cannot take (`references/functions-routes.md` says which); do not add a frontend to an app just to receive callbacks a route can take. When a handler is needed, it can be the frontend's only feature, with no custom UI. No viewer is attached. Verify Swell's context first; if signature verification needs a merchant-provided secret, read only the app settings needed for that check. Authenticate the provider and validate the payload before reading or changing business records. This credential lookup does not authorize business operations. Developer-owned secrets follow `references/settings.md`.
- **Put work in a handler when it only serves the frontend's own pages.** A handler already has the Backend client; do not route a page's request through a function to reach the Backend API.
- **Calling a function from a handler.** `backend.functions.call(context.appId, '<name>', data)` runs the function with the app's authority. Nothing about the viewer is forwarded: authorize in the handler first and pass what the function needs as data. The call resolves with the function's return value, and a function that fails rejects it with a `SwellError` carrying the function's status; the `swell-backend-api` skill's `references/clients.md` has the call's full contract.

## Local development

Run from the app root, not from `frontend/`:

```bash
swell app dev
```

`swell app dev` pushes the app's configs, starts the frontend's own dev server (`npm run dev` on the first free port in 4000–4100; pin it with `--frontend-port`), and routes it through Swell so requests carry a real context. It prints `View it at https://<storeId>--<id>--local.swell.store`, where the id is the CLI session's for a dashboard app and the storefront's for a storefront app. Edits reload in place, and the frontend's output appears in the same terminal. Use this command also where the scaffold's own output suggests `swell app frontend dev`.

- **The preview opens as a visitor.** Previewing as a store user (`--store-user`, dashboard apps only) and the storefront preview are covered in the two specialized references.
- **Do not share the preview address.** Anyone who has it sees what the session shows, for as long as it runs.
- **The session serves only its preview address.** The dashboard and the deployed addresses keep serving the last push.
- Running `npm run dev` inside `frontend/` starts the frontend without Swell. The scaffold's home page then says "Not connected to a store" and helpers that need a store throw — expected; use `swell app dev`.
- `frontend/.dev.vars` holds local-only variables, including the `SWELL_VERIFY_HEADERS` switch for signature verification; the file documents it. It is never deployed, and deployed frontends always verify.

Everything `swell app dev` does to functions still applies while it runs — see the Local Development notes in `references/cli.md`.

## Deploy

```bash
npm run check     # in frontend/: the template's checks and a build
swell app push    # from the app root: build and deploy; the command has no -y flag
```

`swell app push` uploads the app's files, then builds the frontend locally, packages the Worker and its assets, and hands the package to Swell, which deploys it. The lines that prove it:

```
Building managed <framework> frontend...
Deployed managed frontend package <digest>.
```

- A managed frontend is built and deployed on **every** unscoped `swell app push` — there is no "unchanged, skipped" case. A scoped push of `frontend/`, any file or directory under it, or the root `package.json` also rebuilds and deploys the frontend. Pushes scoped to other paths leave the frontend deployment alone. `--no-deploy` uploads sources without building or deploying, so the previous build stays live.
- Push always targets the **test** environment. Releasing to other environments and stores goes through `swell app version` / `install` — see `references/app-publishing.md`.
- **Where it is served.** Every deployed frontend answers at the app address, `https://<storeId>--<installedAppId>--app.swell.store`; the id is the one of the app's installation in that environment, not the `id` in `swell.json`. A dashboard app is opened from the dashboard; a storefront app is opened at its storefront's address. The specialized references say which address to give people.
- **The Worker profile is fixed.** Keep `compatibility_date` and `compatibility_flags` in `frontend/wrangler.jsonc` as scaffolded and add no bindings or `vars` to the ones it has; a changed profile is rejected. Node.js built-ins are available as is.
- The built package (Worker plus assets) is limited to 8 MiB.
- Managed hosting supports Vinext and client-side React + Vite. Next.js with OpenNext is refused with a message pointing to self-hosting.

There is no `swell inspect frontend` resource type — the push output above, then opening the frontend, is the confirmation.

## Gate alignment

Apply the skill's five gates to the requested frontend change. For a new frontend, or changes to identity, sessions, hosting or entry points, exercise the relevant viewer paths end to end. For a narrow edit, reuse checks of unchanged behavior and verify the part affected. The frontend-specific adaptations are:

- **Gate 2 (Schema)** — n/a, no schema-backed manifest. The scaffold's README and the SDK's README are the references.
- **Gate 3 (Author & Validate)** — `npm run check` in `frontend/` must pass.
- **Gate 4 (Deploy & Verify)** — confirm `Deployed managed frontend package <digest>.` in the push output. There is no frontend inspect command; verify the deployed frontend.
- **Gate 5 (Test)** — use the "Preview and verify" checklist of the specialized reference for the affected behavior. Full frontend delivery checks every kind of viewer the app has, first under `swell app dev` and again against the deployed build. Local-only work leaves deployment checks unverified; architecture and read-only reviews do not start dev or push.

## Self-hosting on Cloudflare

The frontend runs as a Worker in the developer's own Cloudflare account. Swell still routes the app's addresses to it and sends the same signed context, so the rules under "How the frontend connects to Swell" apply unchanged. Use it when the user asks for it, and propose it when the app needs what managed hosting refuses: bindings, `vars` or secrets, a different Worker profile, a framework other than Vinext or React + Vite, or a package over 8 MiB. It needs the developer's Cloudflare account, so the choice is theirs. A frontend hosted anywhere else is not an app frontend: Swell does not route to it or send it a context. It is built on the APIs with its own credentials, outside this skill.

**Starting self-hosted.** The other `--frontend` values scaffold plain Cloudflare starters into `frontend/` and set `"hosting": "self-hosted"`. No Swell patterns are included: add the SDK — `npm install @swell/apps-sdk@next swell-js` (the `latest` tag is still the 1.x theme SDK, a different API) — and build the helpers the managed scaffolds have.

**Switching from managed.** Moving a deployed app to self-hosting is a legitimate choice. The scaffold's code stays as it is:

1. Set `"frontend": { "hosting": "self-hosted" }` in `swell.json`. Deleting the block instead is rejected with `Set frontend.hosting to self-hosted explicitly to change hosting.`
2. Give the Worker its own `name` in `frontend/wrangler.jsonc`. The profile is now the developer's to change.
3. Run `npm run build` in `frontend/`. For Vinext and React + Vite the CLI runs no build step of its own before deploying, so build before every push that changes the frontend.
4. Run `swell app push`. The managed build keeps serving until the new address answers; if it does not, the push fails with `Frontend URL check failed; managed frontend remains active`.

Like any other change, the switch reaches other environments and stores with the next version — see `references/app-publishing.md`.

What is different once self-hosted:

- **Deploys go through Wrangler.** `wrangler login` and a `CLOUDFLARE_ACCOUNT_ID` environment variable are required; without them push uploads the sources and then fails at the Wrangler step. The Worker needs its `workers.dev` address enabled: push reads it from Wrangler's output.
- **Unchanged frontends are skipped.** The deploy runs only when the hash of `frontend/**` plus the root `package.json` changed, or with `--force`. Only `Updating frontend deployment...` → `Updated frontend deployment.` confirms a deploy; the `View your … at` line prints either way.
- **Caching is the app's job.** Swell does not force `Cache-Control` on a self-hosted frontend: send `private, no-store` from every page and endpoint whose answer depends on the viewer.
- **Link only to the Swell addresses.** The raw `*.workers.dev` URL receives no context, so the app is not connected to a store there. It is still reachable by anyone: once the Worker holds secrets of its own, pass `appId` to `verifySwellContext` as the SDK README's "Request context options" describes, so that a context issued for another app is refused.
- **`swell app dev` is unchanged.** It runs the frontend's dev server and routes it through Swell in the same way.
