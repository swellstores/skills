# App Permissions

`swell.json`'s `permissions` array scopes the API credentials the platform issues to the installed app: `req.swell` in functions and workflows, and the Backend client in a frontend. `swell create app` writes `"permissions": []`, and **an empty or absent array means full access** — entries only ever subtract capability.

**Always declare `permissions` on every app.** The scaffold's empty array is a placeholder, not a decision: leave it and the app ships with full read and write access to the whole store, which merchants see at install time and which turns any bug or leaked credential into store-wide exposure. List the scopes the app actually uses and nothing more.

## Scope names

**When the app needs no scopes:** an app that uses only exempt operations or the Storefront client still gets full Backend access from `[]`. A supported way to express no Backend access has not been established in this skill. Do not invent a dummy scope or add unrelated permissions to make the array non-empty. State this limitation when proposing such an app; an empty array is not evidence of least privilege.

Entries are `read_<collection>` / `write_<collection>` against the **top-level collection**: `read_products`, `write_orders`. `write_x` implies `read_x`. Child collections collapse to their parent, so `/products:variants` and `/products:apps.<app_id>.<name>` are both covered by `products`.

The CLI validates only that the value is an array — there is no enum, so a typo like `products_read` deploys clean and grants nothing. A call outside the declared scopes fails with 403 `The client does not have the required permissions`.

## What needs no scope

- **The app's own collections.**
- **The app's own functions.** An app can call its own functions, as `backend.functions.call(context.appId, …)` does from a frontend, whatever its scopes.
- `/:details` and `/:logs`.

## Scopes that are easy to miss

| The app does | Declare |
| --- | --- |
| `await req.swell.settings()`, or the Backend client's `settings()` — its own settings included | `read_settings` |
| reads who a store user is from `/:users/<id>` (a dashboard frontend, an action's `$action.user_id`) | `read_:users`, colon included |
| `req.swell.transaction([...])` | `write_:transaction`, plus the scope of every operation inside |
| `POST /:batch` | `write_:batch` — also for a batch of reads — plus the scope of every operation inside |

- **Settings are all or nothing.** The app's own settings are exempt only when addressed by the app's 24-character record id, and `settings()` sends the app's slug, so the call is checked as `read_settings`. That scope also opens every other app's settings (`references/settings.md`).
- **The wrapper scope does not cover what is inside.** Each operation of a transaction or batch is checked on its own. In a transaction an operation outside the app's scopes aborts the set with `transaction_op_failed` and status 403; in a batch the call succeeds and that operation's slot holds `{ "$error": "The client does not have the required permissions" }`.

## Changing permissions

- **On a pushed development app, a change takes effect unevenly.** `swell app push` re-syncs permissions in place, and for a while after it the same call can pass and fail from one request to the next. Repeat a check several times before concluding that a scope is missing or that a removed one is still granted.
- **Changing `permissions` between released versions rotates the installed app's keys.** The platform snapshots the previous permissions with the previous `access_token` and `public_key` into `versioned_permissions` and mints a new pair; the old key keeps authenticating with the *old* scope, so a stale key that "still works" may be silently under-scoped. Re-read the app's keys after any permissions change.

## Verify

Narrow permissions as a change of its own, then exercise every path of the app that reaches the store: each function trigger, each workflow, each frontend page and endpoint. Push cannot tell that a scope is missing; only the 403 at run time does. A route function that tries each call and returns what failed is the quickest way to see a whole scope set at once.
