# Data Models

Data models define the database schema in `./models/*.json`, where the filename matches the collection (`products.json`). Deployed models can be inspected with `swell inspect models /products` (standard) or `/apps/<app_id>/<collection>` (app). Consult `swell schema model --format=dts` for structure, field options, and condition syntax; this reference covers the decisions and the traps.

Data models hold data logic: types, events, permissions, formulas. How a collection looks in the dashboard is a content model's job — `references/content-models.md`.

## Extend, create, or nest

- **Extend a standard model** when data belongs to an existing record: review scores on products, loyalty tiers on accounts, fulfillment metadata on orders. Name the file after the standard collection (`models/products.json`). The fields live on the record under `$app.<app_id>` and are queryable on the standard list endpoints (`where` on `$app.<app_id>.<field>` paths, including inside `$and`/`$or`). A field declared inside one of the model's objects lives in that object: declared under `billing` in `models/orders.json`, it is at `billing.$app.<app_id>.<field>`.

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

**Storefront exposure is opt-in and off by default.** An app collection with no public declaration produces no permissions record at all, so *every* Frontend API verb fails with `You do not have permission to perform this action on '<model>'`. Declare it in the model JSON: `"public": true` at the model root publishes every field of the model, while fields other apps add to it stay as those apps declare them; a per-field `"public": true` publishes just that field. `public_permissions` then refines it:

- `fields` is an explicit read whitelist. A link's fields listed there (`"vendor.name"`) come as a storefront read of the linked model gives them, as with `expands`.
- `query` pins a filter the caller cannot widen (`"query": { "where": { "status": "approved" } }` keeps unmoderated records inside the store, since config values override the caller's).
- `expands` names a URL that `expand=<key>` reads with each record (`"expands": { "product": { "url": "/products/{product_id}" } }`). The URL answers what a storefront reading it directly would get: the expand is refused where storefronts do not read, and a URL of an account-scoped model needs a login and brings only the customer's own records.
- `input.fields` is **required for any storefront write** (without it POST/PUT/DELETE fail with `You may not update <model> without public permissions`), and a field outside that list is *rejected* (`You are not allowed to update <field>`), not ignored. A collection with `input` and no public field takes writes and refuses reads.
- `scope: "account"` limits reads and writes to the logged-in customer's own records, and `input.scope: "account"` limits writes only. A scoped call, a create included, needs a login. A record's owner is its `account_id`, or, in a model without one, its only link to `accounts`; declare `account_id` in a model that links to `accounts` more than once.

Run `swell schema model --format=dts` for the full shape. An `input` block without either scope lets any visitor create records, and a storefront cannot change or delete them. Choosing between direct writes, a frontend handler and a route function, and what a storefront caller receives, is covered in the `swell-frontend-api` skill's `references/app-data.md`.

**Fields added to a standard model** are public the same way: one marked `"public": true` is returned to any storefront, on the store's own key and on an app's key alike, wherever storefronts read that model. It does not open a model they do not read. `public_permissions` an app declares on a standard model apply to the app's own key and add to the model's permissions only what the model does not set: its own scope, query conditions and expands stay.
