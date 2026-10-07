# Data Models

Data models define the database schema in `./models/*.json`, where the filename matches the collection (`products.json`). Deployed models can be inspected with `swell inspect models /products` (standard) or `/apps/<app_id>/<collection>` (app). Consult `swell schema model --format=dts` for structure, field options, and condition syntax; this reference covers the decisions and the traps.

Data models hold data logic: types, events, permissions, formulas. How a collection looks in the dashboard is a content model's job — `references/content-models.md`.

## Extend, create, or nest

- **Extend a standard model** when data logically belongs to an existing entity: review scores on products, loyalty tiers on accounts, fulfillment metadata on orders. Name the file after the standard collection (`models/products.json`). Fields merge into the record under `$app.<app_id>.*` and are queryable on the standard list endpoints (`where` on `$app.<app_id>.<field>` paths, including inside `$and`/`$or`). Benefits: seamless admin integration, no new API surface, automatic association with platform workflows.

- **Create a new app model** when data requires an independent lifecycle, dedicated events, distinct public permissions, or has no natural parent. Reviews, wishlists, vendor profiles fit here. Use a kebab-case filename (`vendor-profiles.json`). The collection lives at `apps/<app_id>/<collection>` and requires explicit relationship links.

- **Use a child collection** when data is tightly scoped to a parent and should not exist independently. Declare with `"type": "collection"` containing nested `fields`. Children share the parent's API path: the children of one record of an app collection are at `/<collection>/<id>/<name>`, and all of them across parents at `/<collection>:<name>`. Child collections declared in a standard-model extension live at `/<collection>:apps.<app_id>.<name>`, expand into the record under `$app.<app_id>.<name>` (not the record root), fire events under the parent model's event root (`before:product.<name>.created`), and are deleted automatically when the parent record is deleted.

Reference an app model by its Fully Qualified Name, `apps/<app_id>/<collection>`, in API endpoints, relationship links and SDK queries. The app's own code can use the short path, `/reviews`, in its functions (`req.swell`) and in its frontend's Backend client.

## Relationships

Relationships require two fields: an `objectid` stores the reference; a `link` declares the target and enables expansion.

```json
{
  "product_id": { "type": "objectid", "required": true },
  "product": { "type": "link", "model": "products", "key": "product_id" }
}
```

For app model targets, use the FQN: `"model": "apps/<app_id>/vendors"`. For child collections: `"model": "products:variants"` or `"model": "apps/<app_id>/vendors:locations"`.

Link fields declared in a standard-model extension expand via `?expand=$app.<app_id>.<field>`. Link resolution sees both your app's fields and the parent record's native fields (app fields win on name collisions) — but inside an app link's `key` or `params`, `id` always refers to the **parent record's** id, so key links off a dedicated app field (e.g. `channel_id`), never `id`.

## Events

Events enable function, webhook and notification triggers on record changes and are declared in the model JSON.

Standard events (`created`, `updated`, `deleted`) exist on all models by default. Custom events (e.g. `review.approved`) must be declared in the data model before anything can subscribe to them, and the declaration requires a non-empty `conditions` object (the condition that marks the event as having occurred) unless it is an `extension` event; conversely, standard `created`/`updated`/`deleted` types must **not** declare `conditions`. Both are enforced at push time by `validateModelEvents`, never by local validation.

```json
{
  "events": {
    "types": [
      {
        "id": "approved",
        "conditions": { "status": "approved", "$record": { "status": { "$ne": "approved" } } }
      }
    ]
  }
}
```

The event's full name takes the model's event root, which is the singular of the collection name: `review.approved` for `reviews`. The `$record` part of the condition holds the record before the write, so the event above marks the change to approved and not every later update of an approved review.

Hook-specific event properties (`hooks`, `hook_timeout`, `hook_retry_attempts`) are in `references/functions-hooks.md`.

## Storefront exposure

**Storefront exposure is opt-in and off by default.** An app collection with no public declaration produces no permissions record at all, so *every* Frontend API verb fails with `You do not have permission to perform this action on '<model>'`. Declare it in the model JSON: `"public": true` at the model root publishes every field; a per-field `"public": true` publishes just that field. `public_permissions` then refines it:

- `fields` is an explicit read whitelist.
- `query` pins a filter the caller cannot widen (`"query": { "where": { "status": "approved" } }` keeps unmoderated records inside the store, since config values override the caller's).
- `input.fields` is **required for any storefront write** (without it POST/PUT/DELETE fail with `You may not update <model> without public permissions`), and a field outside that list is *rejected* (`You are not allowed to update <field>`), not ignored.
- `scope: "account"` restricts reads and writes to the logged-in customer, but it is only applied when an `input` block is also present.

Run `swell schema model --format=dts` for the full shape. **Ownership and authentication are separate requirements.** The carried-forward Frontend API guidance reports that account scope permits anonymous creates without an owner; that behavior still needs verification during API-skill revision. Do not claim a login-only write boundary from scope or a browser login check alone. Until anonymous rejection is established for the chosen model, use an authenticated server write path and keep direct public writes closed when login is mandatory. Choosing between direct writes, a frontend handler and a route function is covered in the `swell-frontend-api` skill's `references/app-data.md`.

**Fields added to a standard model are a different story.** They are **not readable from the Frontend API** with a store's own public key, whatever `"public": true` says on the field: the storefront gateway projects every read through a per-model field allowlist, and the allowlist it builds for a store's own public key contains no `$app` path at all. The field simply comes back absent — no error, no 403 — so a storefront feature built on it fails while every secret-key check passes. Three real options, most portable first: put the storefront-visible data in the app's **own collection** with `public_permissions` and attach it per product with an `include` sub-query; return it from a `public: true` route function; or have the merchant extend that **public key record's** own field permissions to allow the `$app` path.

Do not verify this with `swell api … --api frontend` inside an app repo — that call authenticates with the *installed app's* public key, which does merge app fields into the model config and will show the field that a storefront on the store's own key cannot see. Check with the key the storefront will actually use. An app's own `frontend/` is connected with the installed app's key, not the store's, so check there as well instead of assuming either result.
