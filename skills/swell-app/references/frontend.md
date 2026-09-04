# Frontend

Optional `./frontend/` directory that bundles into a Cloudflare Worker, deployed as part of `swell app push` and embedded as an iframe inside the Swell dashboard. Scope of this reference: `admin` and `integration` apps that need custom UI beyond content-model views. **Storefront apps may scaffold the same folder, but route through a different platform contract (visual editor, locales, publishing) that is not covered here.**

## When to use

Pick a frontend over content-model views when:

- The UI cannot be expressed as `list`/`edit`/`new` views — multi-step flows, embedded third-party widgets, custom dashboards.
- The app needs a colocated server endpoint for the same UI (Hono routes alongside HTML/SPA assets).

Otherwise prefer content-model views: cheaper to build, free admin chrome, no separate deploy pipeline.

The frontend is **orthogonal to `components/`**, not an alternative. Integration apps may ship both — `components/` for checkout-context Preact, `frontend/` for dashboard-context admin UI managing the same data.

## Bootstrap

Scaffold with the CLI:

```bash
swell create frontend --frontend hono -p npm -y
```

`--frontend` accepts `nextjs | astro | nuxt | react | hono | angular`; `-p` accepts `npm | yarn | pnpm | bun`. The scaffold writes a working starter (entry file, `wrangler.toml`, framework config, dependencies) — read the generated files for the layout. Examples in this reference use Hono, but the auth and API-calling contracts below are framework-agnostic.

## Lifecycle

`swell.json` has no `frontend` block — registration is automatic. `swell app push` does four things in order:

1. Uploads `frontend/*` source files to the platform as configs (alongside `swell.json`, models, etc.).
2. **Only when the frontend deployment hash changed** (or `--force`): runs the framework's build command — `npx opennextjs-cloudflare build` (Next.js), `npx astro build`, `npx nuxt build`, `npx ng build`. Hono and React declare no build command and go straight to deploy.
3. Same condition: runs `npx wrangler deploy` — `bunx wrangler deploy` only when the detected package manager is bun — against the **developer's** Cloudflare account (not Swell's), then writes the resulting Worker URL into the app record's `frontend.url`, always scoped to the **test** environment. Prints `Updating frontend deployment...` → `Updated frontend deployment.`
4. Unconditionally prints `View your app at <admin-proxy URL>`.

**`View your app at …` is not evidence of a deploy.** It prints whether or not anything shipped. The deployment hash covers `frontend/**` plus the root `package.json`; when it matches the stored `frontend.deployment_hash`, the build, the Wrangler deploy, and the `frontend.url` write are all skipped and the previous Worker keeps serving. Only `Updating frontend deployment...` confirms the URL was (re)registered. Redeploy an unchanged frontend with `swell app push --force`.

**Hard prerequisites for the deploy phase**: Node 22+ in `PATH`, `wrangler login` completed, and `CLOUDFLARE_ACCOUNT_ID` env var set. Without these, push completes the upload phase and fails at Wrangler. Use `swell app push --no-deploy` to skip build and deploy and only upload sources — `frontend.url` is not updated, so any existing deployment continues serving.

There is no `swell inspect frontend` resource type — the push output above is the only confirmation available.

## Local development

`swell app dev` does **not** run `wrangler dev`. It starts the detected framework's own dev command — Hono and React `npm run dev -- --port <port>`, Next.js `npx next dev --turbopack --port <port>`, Astro `npx astro dev --port <port>`, Nuxt `npx nuxt dev --port <port>`, Angular `npx ng serve --port <port>` — on the first free port in 4000–4100. Pin the port with `--frontend-port`.

The CLI tunnels that server through the admin proxy and prints `View it at https://<storeId>--<sessionId>--local.swell.store`. The deployed equivalent is `https://<storeId>--<installedAppId>--app.swell.store`. (`http://…--local.swell.test:4001` appears only when the CLI is pointed at a local Swell platform — never on a normal install.) Requests to the proxy URL go through the same pipeline as production — the `Swell-*` headers, cookie behavior, and CSP all apply, so auth code paths are exercised in dev.

## Iframe routing and `frontend://` links

The dashboard renders the worker inside an iframe at `/app/<app_id>/...`. Two entry points:

1. **Initial iframe load.** The admin client builds an iframe URL with `?_swell_session=<adminSessionId>`. The proxy validates that session against the platform, sets a `_swell_admin_session` cookie (non-HttpOnly, `SameSite=Lax`), and 302-redirects to a clean URL. Subsequent requests inside the iframe carry the cookie automatically — but the cookie is set **only** on this redirect path.

2. **Content-model nav and actions.** Use `frontend://path/{id}` in `nav.link` and `actions[].link`. The admin translates `frontend://path` to `/app/<app_id>/path` for non-blank `target` (default), or to the full Worker URL with `?_swell_session=...` appended for `target: "blank"`. `{id}` and other placeholders expand against the current record before the link fires.

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

Two cookie-name details to keep straight: the **query parameter** is `_swell_session` (the admin session id, passed once on entry), the **cookie** the worker sees is `_swell_admin_session` (set by the proxy after validating that query param).

## Auth contract

The proxy injects request headers on **every** call that reaches the worker through the proxy URL — even when the visitor never went through the iframe entry path. The injected access token grants full app-scoped backend permissions, so a worker route that calls Swell APIs without checking the cookie is exposed to anonymous internet visitors.

**Always-injected headers:**

| Header | Purpose |
|--------|---------|
| `Swell-Access-Token` | Backend API key (full app permissions) |
| `Swell-Public-Key` | Storefront API key |
| `Swell-Store-Id` | Store id (also the basic-auth username for callbacks — see below) |
| `Swell-Environment-Id` | `test` / `live` / branch id |
| `Swell-App-Id` | App id in per-store slug form — same value as `swell.json.id` in the developing store, and the key to use for `record.$app[<app_id>]` and `/apps/<app_id>/…` paths |
| `Swell-API-Host` | Backend API origin to call back |
| `Swell-Admin-Url` | Admin URL for redirects/links shown in UI; not a callback target |

**Cookie set only when iframe-loaded:**

- `_swell_admin_session: <sessionId>` — present only when the request reached the worker through the dashboard iframe path. Absent ⇒ treat as anonymous.

**Required gating pattern.** Validate the cookie against the platform before any route that returns or mutates store data:

```typescript
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";

async function getAdminSession(c: Context) {
  const sessionId = getCookie(c, "_swell_admin_session");
  if (!sessionId) return null;

  const apiHost = c.req.header("swell-api-host");
  const storeId = c.req.header("swell-store-id");
  const accessToken = c.req.header("swell-access-token");
  if (!apiHost || !storeId || !accessToken) return null; // proxy didn't inject headers

  const r = await fetch(`${apiHost}/:sessions/${sessionId}`, {
    headers: { authorization: `Basic ${btoa(`${storeId}:${accessToken}`)}` },
  });
  if (!r.ok) return null;
  // Empty body parses as null — the platform returns 200 with empty body for invalid ids.
  const session = await r.text().then((t) => (t ? JSON.parse(t) : null));
  if (!session?.user_id || session.client_id !== storeId) return null;
  return session;
}

const app = new Hono();

app.get("/api/protected", async (c) => {
  const session = await getAdminSession(c);
  if (!session) return c.text("Unauthorized", 401);
  // Safe to call Swell APIs here.
});
```

Do **not** trust the cookie alone — it is non-HttpOnly and forwarded by the proxy verbatim, so any caller can set any value if validation is skipped.

Follow REST conventions — do not mutate state on `GET`. The cookie is `SameSite=Lax`, which blocks cross-site form `POST`s but lets top-level `GET` navigations carry the cookie, so a mutating `GET` handler is reachable cross-origin.

## Calling Swell APIs from the worker

The proxy headers carry credentials but the Swell API expects them in standard auth format:

```typescript
const auth = `Basic ${btoa(`${storeId}:${accessToken}`)}`;
const products = await fetch(`${apiHost}/products?limit=20`, {
  headers: { authorization: auth },
}).then((r) => r.json());
```

`Swell-Store-Id` is the basic-auth **username**, not implicit context — sending only the access token returns `401 Invalid access token`. `Bearer ${storeId}:${accessToken}` works as an alternative form. Use `Swell-Public-Key` (same scheme) when you intentionally want storefront-scoped access. App-scoped collections live at `/apps/<app_id>/<collection>`, with `<app_id>` taken from the `Swell-App-Id` header.

## Iframe constraints

- **Same-origin iframe only.** The proxy stamps `X-Frame-Options: SAMEORIGIN` and `Content-Security-Policy: frame-ancestors 'self' *.swell.store *.swell.test:*` on every response. Custom domains for the worker break the embed.
- **The admin-proxy URL is the canonical entry point.** Do not link directly to `<worker>.workers.dev`; the credentials and cookie pipeline only run when traffic flows through the proxy.

## Gate alignment

The skill's five-gate dev cycle applies with two deviations:

- **Gate 2 (Schema)** — n/a, no schema-backed manifest.
- **Gate 4 (Deploy & Verify)** — no `swell inspect frontend`. After `swell app push`, `Updating frontend deployment...` / `Updated frontend deployment.` is the source of truth. `View your app at <url>` prints even when the frontend hash was unchanged and nothing was built or deployed.

**Gate 5 (Test)** — run `swell app dev` and exercise the local tunnel through the dashboard:

1. Open the tunnel URL via the dashboard's iframe path; confirm gated routes resolve under the validated cookie.
2. Hit the tunnel URL directly (no iframe entry) without the cookie; gated routes must return 401.

Repeat against the deployed proxy URL after `swell app push` for the same checks in the test environment.

## Common mistakes

- **Trusting the cookie without validating it.** Non-HttpOnly cookies are spoofable. Validation against `/:sessions/{id}` is the only real gate.
- **Calling Swell with the access token alone.** `Authorization: Bearer <token>` returns `401 Invalid access token` — the store id must be the basic-auth username (`Basic base64(storeId:token)`) or `Bearer storeId:token`.
- **Linking outside the proxy.** The raw `*.workers.dev` URL has none of the headers and cookie behavior; treat it as if it didn't exist.
- **Conflating with storefront frontends.** Storefront apps' `frontend/` runs under a different platform contract (public visitors, `Swell-Public-Key` as primary credential, visual-editor integration). The admin/integration auth contract above does not apply.
