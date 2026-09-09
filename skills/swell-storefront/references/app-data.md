# Reading and Writing App Data

Apps extend a store in two shapes, and only one of them is reachable from a storefront by default.

## App-defined collections

`/apps/<app_id>/<collection>` and `/apps/<app_id>/<collection>/<id>`, via the generic `swell.get/put/post/delete` methods. The model must declare `public_permissions`; without them every verb fails with `You do not have permission to perform this action on '<model>'`. What the model declares is what the storefront gets — the gateway reads `fields`, `query`, `expands`, `input.fields` and `scope` off the model, and nothing else.

- `fields` — the read whitelist. Anything outside it is absent from responses.
- `query` — a pinned filter (`where`, `limit`, `sort`) the caller cannot widen.
- `input.fields` — required before any write succeeds; fields outside the list are rejected rather than ignored.
- `scope: 'account'` — makes records customer-owned.

## Choosing the write path

**Public writes need an owner.** Declaring `input.fields` opens the collection's write verbs to storefront callers generally, not just to the form you had in mind, and an app model cannot restrict which verbs are allowed — `methods` is a property of the API key's own permissions, not something a model can declare. Two supported ways to keep writes safe:

- **`scope: 'account'`** — reads are auto-filtered to the logged-in account (do **not** add your own `account_id` filter), creates are stamped with it, and updates and deletes re-fetch the record scoped to the caller, 404ing when it belongs to someone else. Two things to know: scope is only picked up when `public_permissions.input` is also present, so a read-only scoped collection stays world-readable; and anonymous creates are not blocked by the scope gate, so a logged-out visitor can create a record with no owner. Gate submission on `swell.account.get()` in the storefront, and treat `scope` as ownership enforcement, not as authentication.
- **A route function** — omit `input` entirely and take submissions through the app's own HTTP route, which can check `req.session?.account_id` and apply whatever validation it likes before writing with app credentials (§VIII). This is the right default for anything a customer submits: moderation flags, rate limiting, and field sanitation all live in code you control.

Read-only public data — a published reviews list, a store locator — is the case where a bare `fields` + `query` declaration with no `input` is exactly right.

## App extension fields on standard models

`$app.<app_id>.*` written onto a standard model such as `products` is **not** reachable from the Frontend API. The storefront's field allowlist is fixed server-side and contains no `$app` entry; it is widened only by the public key record's own permissions, which is store configuration rather than something an app can declare.

So a rating an app computes onto a product is invisible to `swell.products.get()` no matter what the field declares. Surface it through an app-defined collection or a route function instead, and treat the `$app` field as backend state.
