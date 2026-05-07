# HTTP Route Triggers

Routes expose a function as a custom API endpoint at the fixed path `/functions/<app_id>/<function_name>`. There is no URL path parameter routing — pass identifiers via query (`?id=…`) or request body.

## Configuration

```typescript
export const config: SwellConfig = {
  description: "Submit review from storefront",
  route: {
    methods: ["post"],                // 'get' | 'post' | 'put' | 'delete'
    public: true,                     // false requires secret key auth
    cache: { timeout: 5000 },         // ms, GET only; defaults to 5000 — set 0 to disable
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

`req.session` carries the authenticated user when present. Storefront routes typically gate on `req.session?.account_id`.

## Headers

By default, all incoming headers are forwarded to `req.headers` (a standard `Headers` object). Set `route.headers` to an allow-list to restrict which headers reach the function.

For local testing, forward caller headers via repeatable `-H 'Name: value'` on `swell api`. Header forwarding applies to `/functions/*` paths only.

## Cache

`route.cache.timeout` controls response caching for GET routes. Defaults to 5000 ms when `cache` is omitted; set to `0` to disable. Has no effect on non-GET methods.

## Return values

- Plain object → JSON 200.
- String → `text/plain` 200.
- `new SwellResponse(data, { status, headers })` for custom status/headers (preferred over native `Response`).
- Throw `SwellError(msg, { status })` to return an error response.

Response bodies above 75 KB are silently dropped by the platform — paginate large collections rather than returning them. The truncated payload reaches the caller as an unparseable string.

## Signature verification (HMAC, third-party webhooks)

When verifying a third-party webhook signature, hash `req.rawBody` — re-stringifying `req.body` won't byte-match the original payload and signatures will never match.

Functions run on Cloudflare Workers **without** Node compatibility: use the Web Crypto API (`crypto.subtle.importKey` + `crypto.subtle.verify`), not Node's `crypto` module. Rely on `subtle.verify` for the comparison — it runs in constant time. Never compare signatures with `===`, which leaks timing information.

## Local testing caveat

Under `swell api`, `req.session` is the CLI admin session — not a storefront customer session. Customer-scoped auth gates (`session?.account_id`) won't behave the same locally as in production. Verify those paths through integration tests against actual storefront auth.
