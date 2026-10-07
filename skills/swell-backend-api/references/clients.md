# Backend clients

Six clients reach the Backend API. They send the same paths, queries and bodies, and they differ in how they are set up, which methods they have, and how a failure reaches the code. This reference covers those differences, calling an app function, and rate limits. Queries are in `references/querying.md`; write, batch and transaction rules are in `references/writes.md`.

## Choose the client

Use the client the runtime supplies. Do not construct a second one beside it.

| Code runs in | Client | Acts as | Environment |
| --- | --- | --- | --- |
| An app function | `req.swell` | The app, within its `permissions` | The one the app is installed in and the call came from |
| An app workflow | `req.swell`, a narrower client | The app | Same |
| An app frontend, server side | The scaffold's Backend helper (`getBackend()` in Vinext), an Apps SDK `SwellBackendAPI` | The app | Same |
| A Node.js server or script outside an app | swell-node | The secret key's holder | The key's |
| Server code outside an app that cannot use swell-node, such as an edge runtime | Apps SDK `SwellBackendAPI` with explicit credentials | The secret key's holder | The key's |
| Any other language | Direct HTTP | The secret key's holder | The key's |
| A terminal, for a one-off read or write | `swell api` | The logged-in CLI user | Test, unless `--live` |

The three app clients are set up by the runtime: `swell-app`'s `references/functions.md`, `references/functions-workflows.md` and `references/frontend.md` say how to obtain them and what else the request carries. None of the clients applies a shopper's session or ownership; shopper-facing operations belong to the `swell-frontend-api` skill.

## What the API answers

Every client sees the same four answers. The sections below say how each client hands them to the code.

- **A record.** A read or write by id answers with the record; a list answers with `{ count, results, page, limit, page_count }`.
- **Nothing.** A `GET` or `DELETE` for an id that does not exist answers with an empty body and no error. A list with no matches is a normal envelope with `count: 0`.
- **A refused write.** A `POST`, `PUT` or `DELETE` that fails field validation is not an HTTP error. The answer is `{ errors: { <field>: { code, message } } }` and nothing was written. Keys are dotted paths for nested fields (`items.0.quantity`). Detail values sit on the entry itself: `MAXVAL` carries `max`, `MINVAL` `min`, `MAXLENGTH` `maxlength`, `MINLENGTH` `minlength`, `ENUM` `values`.
- **An HTTP error.** The body is plain text, or for errors with a code, `{ error: { code, message, status } }`.

| Status | Meaning |
| --- | --- |
| 400 | Malformed request, or a documented limit exceeded |
| 401 | Wrong store id, or a bad or revoked key |
| 402 | The store's plan is canceled or its trial expired |
| 403 | The credentials are not allowed this resource. An app that declares `permissions` gets 403 for any path outside its scopes, including one that does not exist |
| 404 | Nothing at that path |
| 405 | The endpoint does not support the method |
| 429 | Rate limited — see "Rate limits" |

## Function `req.swell`

```typescript
const product = await req.swell.get(`/products/${id}`);
if (!product) throw new SwellError("Unknown product", { status: 404 });

try {
  await req.swell.post("/reviews", input);
} catch (err) {
  // A refused write: status 400 and the fields that failed as the body.
  if (err.status === 400 && err.body && !err.body.error) {
    const fields = Object.fromEntries(Object.entries(err.body).map(([field, e]) => [field, e.message]));
    return new SwellResponse({ fields }, { status: 422 });
  }
  throw err;
}
```

- **Methods.** `get(path, query)`, `post`, `put` and `delete(path, data)`; `settings()`; `transaction(ops, { retry })`; `workflows.create(name, params)`.
- **A missing record resolves empty.** The value is an empty string, not `null`: test `if (!record)`.
- **A refused write throws.** The error has status 400 and the field map as `err.body` — the content of `errors`, without the wrapper. The call never resolves with an `errors` object to check. No other failure has a field map as its body: the rest have `body.error` or no body.
- **An HTTP error throws** with the response's status.
- **Transaction results are the exception.** `transaction()` resolves with one entry per operation, and a refused operation is an `{ errors }` entry in that array, not a throw. `references/writes.md` has the rule.

Every failure is a `SwellError`:

| Property | Holds |
| --- | --- |
| `status` | The HTTP status; 400 for a refused write |
| `body` | The field map for a refused write; `{ error: { code, message, … } }` for a coded error; `undefined` when the API answered in plain text, as it does for 401, 403 and 404 |
| `code` | The platform's code when the error has one (`transaction_conflict`, `workflow_not_found`, `function_not_found`); otherwise `undefined` |
| `isRetryable` | `true` only for `transaction_conflict` and `transaction_throttled` |
| `message` | Text for people, prefixed with the method and path. Do not parse it |

## Workflow `req.swell`

Inside a workflow `req.swell` is a different client with fewer methods and paths; `swell-app`'s `references/functions-workflows.md` lists them. Its failures also arrive differently:

- **A missing record resolves empty**, as in a function.
- **A refused write resolves with `{ errors }`. It does not throw.** Check `result.errors` after every write in a step, or the step records a success that wrote nothing.
- **A request the API refuses (4xx) throws an error that carries only a `message`** — no `status`, `code` or `body`. The step fails at once, without the retries it declares.
- **A 429 or a server error (5xx) throws an error with `status`, `code` and `retryable: true`**, and the step retries under its own retry settings.

## Apps SDK Backend client

`SwellBackendAPI` from `@swell/apps-sdk`. Inside an app frontend the scaffold's helper builds it from the request's verified context; keep that helper. Outside an app, pass credentials:

```typescript
import { SwellBackendAPI, SwellError } from "@swell/apps-sdk";

const backend = new SwellBackendAPI({
  storeId: "my-store",
  secretKey: process.env.SWELL_SECRET_KEY,
  apiHost: "https://api.swell.store",
});
```

Use one form or the other: a context together with explicit credentials throws. Install the SDK as `@swell/apps-sdk@next`; the `latest` tag is the 1.x theme SDK, a different API.

Methods are those of a function's `req.swell`, plus `functions.call` (see "Calling an app function"). `settings()` reads the settings of the app the client was built for and needs an app id as its argument when the client was built without one. A path must be a path: an absolute URL is rejected.

**Failures arrive exactly as in a function**: a missing record resolves empty, a refused write throws with status 400 and the field map as `body`, an HTTP error throws, and the error is a `SwellError` with the properties in the table above. Two kinds of failure are not a `SwellError`: a network failure keeps the runtime's own error, and invalid arguments (a bad constructor option, a bad path) throw a plain `Error`.

## swell-node

A Node.js client for a server or script that holds a secret key. Version 6 or later.

```js
const { swell } = require('swell-node');

swell.init('my-store', process.env.SWELL_SECRET_KEY); // optional third argument: { url, timeout, headers, retries }
const products = await swell.get('/products', { limit: 25, active: true });
```

- **Methods.** `get`, `post`, `put` and `delete(path, data)` resolve with the response body itself: the record or the list envelope, with no wrapper to unpack. Query data goes out as a JSON body, on `GET` too, so a nested `where` needs no URL encoding. There are no helpers for settings, transactions or workflows: call the paths (`/settings/<app_id>`, `/:transaction`).
- **Several stores in one process.** `swell.createClient(storeId, key, options)` returns an independent client.
- **A missing record resolves empty**: test `if (!record)`.
- **A refused write resolves with `{ errors }`. It does not throw.** Check `result.errors` after every write. A script that skips the check reports success while writing nothing.
- **An HTTP error throws.** Branch on `err.status`. `err.code` is the HTTP status text (`NOT_FOUND`, `CONFLICT`), not the platform's code, and `err.message` is not readable when the API answers with a coded error. The API's own body is at `err.cause.response.data`, so the platform's code is `err.cause.response.data.error.code`.
- **No response at all** — refused, reset or timed-out connection — throws with `err.code` `NO_RESPONSE` and no `status`.

## Direct HTTP

`https://api.swell.store`, HTTP Basic authentication with the store id as the user name and a secret key as the password, JSON bodies. A query goes in the URL in bracket notation (`?where[active]=true&limit=25`) or as a JSON body on the `GET`.

Nothing interprets the answer for you. After every call check three things in order: the status, then an empty body (no such record), then an `errors` key in a 200 answer to a write.

## `swell api`

For a one-off look or change from a terminal. It runs as the logged-in CLI user, not with a key.

```bash
swell api get '/products?limit=5&where[active]=true'
swell api put '/products/<id>' --body '{"active": false}'
swell api post '/functions/<app_id>/<function name>' --body '{"sku": "abc"}'
```

- **It targets the test environment unless `--live` is passed.** A command that looks like it read or changed the live store did neither.
- `--body` takes inline JSON or a file path, on `post` and `put` only. `--api frontend` sends the request to the Frontend API with a public key instead.
- **Failures exit with status 1.** A missing record prints `Not found`; a refused write and an HTTP error print the error as JSON.
- **A function call prints an envelope** — `status`, `headers`, and the function's payload under `response` — and exits 0 even when the function answered with an error status. Read `status`.

## Side by side

| | Missing record | Refused write | HTTP error | Read |
| --- | --- | --- | --- | --- |
| Function `req.swell` | Resolves empty | **Throws**, status 400 | Throws | `err.status`, `err.code`, `err.body` |
| Workflow `req.swell` | Resolves empty | **Resolves** `{ errors }` | Throws | `err.message`; `err.status` and `err.code` on 429 and 5xx only |
| Apps SDK Backend client | Resolves empty | **Throws**, status 400 | Throws | `err.status`, `err.code`, `err.body` |
| swell-node | Resolves empty | **Resolves** `{ errors }` | Throws | `err.status`, `err.cause.response.data` |
| Direct HTTP | 200, empty body | 200, `{ errors }` | The status | The body |
| `swell api` | `Not found`, exit 1 | Error JSON, exit 1 | Error JSON, exit 1 | The output |

## Calling an app function

From an app frontend's server code, the SDK client runs one of the app's functions:

```typescript
const result = await backend.functions.call(context.appId, "sync-order", { order_id: id });
const status = await backend.functions.call(context.appId, "sync-status", { order_id: id }, { method: "get" });
```

- **Arguments.** The app id from the request context, the function's name, the data, and the method of the handler to run (`post` by default; `get`, `put` or `delete`). The function receives the data as `req.data`. A route function with `public: false` can be called this way. Data for a `get` must be flat strings, numbers and booleans, and reaches the function as strings.
- **Result.** The function's return value: an object, a string, or `null`. The status and headers of its response are not returned.
- **The function runs as the app, and learns nothing about the caller.** No header, cookie or session of the request being handled is forwarded, and `req.session` is `null` in the function. Authorize the viewer in the handler before the call, and pass what the function needs as data.
- **Failures throw a `SwellError`** with the function's status.

| The function | `status` | `body` |
| --- | --- | --- |
| throws `SwellError("…", { status })` | That status | `{ error: "<message>" }` |
| throws anything else | 500 | `{ error: "<message>" }` |
| returns a `SwellResponse` with a status outside 2xx | That status | The response's payload |
| has no handler for the method | 500 | `{ error: "Function does not export…" }` |
| does not exist | 404, `code` `function_not_found` | `{ error: { code, message } }` |

`err.code` holds only codes set by the platform. To give a failure a code of its own, the function returns a `SwellResponse` with the error status and a payload such as `{ code, message }`, and the caller reads it from `err.body`.

`req.swell` has no `functions.call`. Functions of one app share code through modules under `functions/lib/`, and a function starts a workflow with `workflows.create`. From a terminal, `swell api` calls a function by `/functions/<app_id>/<name>`. A caller outside Swell reaches a route function at its address — `swell-app`'s `references/functions-routes.md`.

## Retries

No client repeats a request that the API answered with an error. What each one does on its own:

- **swell-node** — `retries` (default 0) repeats a request only when no response came back, 20–100 ms apart. An HTTP error is never repeated.
- **`transaction(ops, { retry })`** on a function's `req.swell` and on the SDK client — off by default. `retry: true` repeats the transaction up to 3 more times, only on `transaction_conflict` and `transaction_throttled`, with a delay that doubles from 100 ms up to 5 s. Tune with `retry: { limit, base, max, jitter }`.
- **A workflow step** — repeats under its own retry settings when a request failed with 429 or 5xx, and not when the API refused it.

Everywhere else, retry in your own code: on 429 and on a transaction's 409, with increasing delays. Do not retry a 400, 401, 403 or 404.

## Rate limits

Limits apply per store and per environment, to both throughput and concurrency. The figures depend on the plan and are not published; a test environment always has the lower tier.

- **Requests over the limit are queued, not rejected.** A burst takes longer to clear. A 429 means a request waited more than 60 seconds: the load is sustained, not a spike. Back off with increasing delays, spread bulk work over time, and make each request lighter. There are no rate-limit response headers to read.
- **What a request weighs.** 1, plus 1 for every two expanded fields (a dotted path counts each level, so `items.product` is two), plus 1 for each `include` and that include's own weight, plus 1 for each `$lookup` stage of an aggregation. The first 3 points of expand and include are free, so an ordinary read weighs 1. A batch weighs the sum of its operations; a transaction its operations plus 1.
- **Light catalog and cart reads have their own pool.** `GET` on products, variants, categories, attributes, accounts, carts, purchase links and content pages and blogs, and `PUT /carts`, are metered apart from back-office traffic while the request weighs less than 3. A heavily expanded catalog read falls back into the main pool.
