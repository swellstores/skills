# Reading and Writing App Data

Apps extend a store in two shapes. Visibility depends on the model declaration and the public key the storefront actually uses.

## App-defined collections

`/apps/<app_id>/<collection>` and `/apps/<app_id>/<collection>/<id>`, via the generic `swell.get/put/post/delete` methods. The model must declare `public_permissions`; without them every verb fails with `You do not have permission to perform this action on '<model>'`. What the model declares is what the storefront gets — the gateway reads `fields`, `query`, `expands`, `input.fields` and `scope` off the model, and nothing else.

- `fields` — the read whitelist. Anything outside it is absent from responses.
- `query` — a pinned filter (`where`, `limit`, `sort`) the caller cannot widen.
- `input.fields` — required before any write succeeds; fields outside the list are rejected rather than ignored.
- `scope: 'account'` — makes records customer-owned.

## Choosing the write path

**Public writes need an owner.** Declaring `input.fields` opens the collection's write verbs to storefront callers generally, not just to the form you had in mind, and an app model cannot restrict which verbs are allowed — `methods` is a property of the API key's own permissions, not something a model can declare. Two supported ways to keep writes safe:

- **`scope: 'account'`** — reads are auto-filtered to the logged-in account (do **not** add your own `account_id` filter), creates are stamped with it, and updates and deletes re-fetch the record scoped to the caller, 404ing when it belongs to someone else. Scope is only picked up when `public_permissions.input` is also present, so a read-only scoped collection does not establish private ownership. The carried-forward guidance reports that anonymous creates can produce ownerless records; this behavior still needs verification during API-skill revision. A browser check with `swell.account.get()` only controls the UI. Do not treat it as protection against direct API requests or claim account scope alone enforces login.
- **An authenticated server write path** — omit public `input` entirely and authenticate before writing with app credentials. An app route function checks `req.session?.account_id` (§VIII). In an existing app frontend, an `/app-api` handler can use the supplied Storefront client to identify the customer, then validate inputs and scope Backend writes itself; follow `swell-app/references/frontend.md` and `frontend-storefront.md` for viewer and origin checks. Choose this path when login must be enforced and anonymous rejection by the model is not established, or when submissions need moderation and server-owned fields.

Read-only public data — a published reviews list, a store locator — is the case where a bare `fields` + `query` declaration with no `input` is exactly right.

## App extension fields on standard models

With a store's own public key, `$app.<app_id>.*` on a standard model such as `products` is absent from the default Frontend API field allowlist, regardless of a field's `public` declaration. An installed app's key is a different access context; do not infer its visibility from a store-key test, or the reverse. The app skill's `references/data-models.md`, "Storefront exposure", owns the declaration and key-specific guidance. Verify through the client and key the storefront will actually use.

For portable storefront-visible ratings, use an app-defined collection with explicit public reads or a route function. Do not depend on a standard-model extension field being published merely because a Backend read returns it.
