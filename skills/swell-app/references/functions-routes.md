# HTTP Route Triggers

Routes expose a function as a custom API endpoint at the fixed path `/functions/<app_id>/<function_name>`. There is no URL path parameter routing — pass identifiers via query (`?id=…`) or request body.

## Configuration

```typescript
export const config: SwellConfig = {
  description: "Submit review from storefront",
  route: {
    methods: ["post"],                // 'get' | 'post' | 'put' | 'delete'
    public: true,                     // false requires secret key auth
    cache: { timeout: 5000 },         // ms, GET only, gateway-only; defaults to 5000 — set 0 to disable
    headers: ["x-custom-token"],      // allow-list of incoming header names; omit to forward all
  },
};
```

## Handler dispatch

The runtime resolves the handler in this order: (1) named export matching the request method, (2) default function export, (3) method on the default-exported object.

**Named exports** — one per method; idiomatic for routes:

```typescript
export async function get(req: SwellRequest)  { /* ... */ }
export async function post(req: SwellRequest) { /* ... */ }
```

`delete` is a reserved keyword in strict mode and cannot be used as a function name. Use the default-object form for DELETE handlers.

**Default function** — runs for any method. Standard form for model, schedule, and cron triggers, which always arrive as POST:

```typescript
export default async function (req: SwellRequest) { /* ... */ }
```

**Default object** — supports all methods including `delete`:

```typescript
export default {
  post(req: SwellRequest)   { /* ... */ },
  delete(req: SwellRequest) { /* ... */ },
};
```

## `req.body`, `req.query`, `req.rawBody`

`req.data` on a route is the parsed body merged with the query params, with **query keys overwriting body keys**. When that precedence matters (security-sensitive handlers, conflicting names), use the layer-specific accessors:

- `req.body` — parsed JSON object, or the raw text string when the body isn't JSON.
- `req.query` — URL parameters as `{ [key]: string }`.
- `req.rawBody` — untouched body text. Use for HMAC and webhook signature verification — re-stringifying `body` won't byte-match the original.

## Authentication

`route.public: true` exposes the endpoint without auth. `public: false` (or omitted) requires the store's secret key in the request.

`req.session` carries the storefront customer session, but only the storefront gateway attaches it (`Swell-Session` header). On every other invocation path it is `null` — see Local testing caveat. Storefront routes typically gate on `req.session?.account_id`.

## Calling routes from outside Swell (hosted gateway)

External callers (storefronts, third-party webhooks) reach routes through the storefront gateway at `https://<store>.swell.store/functions/<app_id>/<function_name>`. Two behaviors differ from direct invocation (`swell api`, `swell app dev`):

- **A public key is required even for `public: true` routes** — send it in the `Authorization` header. Any valid public key for the environment where the app is installed works: the store's storefront public key (`pk_…`, what `swell-js` sends) or the app's own `app_pk_…` key. The key selects the environment (`…_test_…` routes to test) and populates the gateway's installed-app list; the slug in the URL is resolved against that list, not against the key's app identity. Without a resolvable key the gateway returns 404 `Function app.<slug>.<name> not found` — a key/environment-resolution symptom, not a deployment problem. Non-public routes additionally require the store's secret key.
- **Query parameters are forwarded only when the request body is empty** — the gateway sends `$call.data = body || query`, so a non-empty body drops the query string entirely. On a **GET** the platform re-materializes that data as real URL query parameters, so `req.query` and `req.data` are both populated and `req.body` is an empty string. On **non-GET** methods the data goes out as the JSON body and `req.query` is always empty. For externally-called non-GET routes, read inputs from `req.data` / `req.body` and put everything in the body.

## Headers

By default, all incoming headers are forwarded to `req.headers` (a standard `Headers` object). Set `route.headers` to an allow-list to restrict which headers reach the function.

For local testing, forward caller headers via repeatable `-H 'Name: value'` on `swell api`. Header forwarding applies to `/functions/*` paths only.

## Cache

`route.cache.timeout` caches GET responses stale-while-revalidate, and only at the storefront gateway (`https://<store>.swell.store/functions/…`). Defaults to 5000 ms when `cache` is omitted; set `0` to disable; non-GET methods are never cached.

Direct invocation — `swell api`, or any backend `PUT /:functions/{id}` with `$call` — bypasses the cache entirely, so local testing never reproduces the storefront's stale-response window.

## Return values

- Plain object → JSON 200.
- String → `text/plain` 200.
- `new SwellResponse(data, { status, headers })` for custom status/headers (preferred over native `Response`).
- Throw `SwellError(msg, { status })` to return an error response.

The platform's HTTP client stops reading a function response at 75,000 bytes mid-stream. The chunk-boundary fragment then fails to JSON-parse and reaches the caller as a raw truncated string instead of an object, with no error raised. Paginate large collections rather than returning them.

## Signature verification (HMAC, third-party webhooks)

When verifying a third-party webhook signature, hash `req.rawBody` — re-stringifying `req.body` won't byte-match the original payload and signatures will never match.

Functions run on Cloudflare Workers **without** Node compatibility: use the Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.verify`), not Node's `crypto` module. Rely on `subtle.verify` for the comparison — it runs in constant time. Never compare signatures with `===`, which leaks timing information.

## Local testing caveat

Under `swell api` — and on model-hook, schedule, and cron invocations — no `Swell-Session` header is sent, so `req.session` is `null`. It is never a CLI admin session. Only the storefront gateway attaches a session, and only when the caller's storefront request carries one.

The trap: a `if (!req.session) throw new SwellError('unauthorized', { status: 401 })` gate rejects every local call while passing in production, and `req.session?.account_id` is always `undefined` locally. Verify customer-scoped auth paths through a real storefront request.
