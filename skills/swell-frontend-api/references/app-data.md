# App Data from a Storefront

An app adds data as its own collections and as fields on standard models, and a storefront reaches both as far as the model makes them public. How a model declares what is public is in the app skill's `references/data-models.md`, "Storefront exposure".

## App collections

`/apps/<app_id>/<collection>` and `/apps/<app_id>/<collection>/<id>`, through `swell.get/post/put/delete`. `<app_id>` is the `id` in the app's `swell.json`; the app's record id answers a store's key with an empty list.

- **Nothing public:** every call rejects with status 400, code `permission_error`.
- **Reads** return `id` and the public fields, and reject with `permission_error` when no field is public. Naming another field in `fields` adds nothing; expanding a link that is not public rejects.
- **A pinned query wins without an error.** A `where` condition or a `limit` the model pins replaces the caller's value for it, while the caller's other conditions still apply. Page with `page`. A record the filter excludes resolves by id with an empty string, like any missing record.
- **Writes** reject with `permission_error` unless the model declares `input`. A field outside `input.fields` rejects the whole write, and `param` names it. Field validation resolves with `errors` instead: `{ errors: { note: { code: 'REQUIRED' } } }`, or `UNIQUE` for a duplicate.

## Who can write

With `input` and neither scope below, any visitor can create records, and an update or a delete rejects with `permission_error`. A write answers with the record's `id` and its public fields, or only the `id` when no field is public.

`scope: 'account'` limits reads and writes to the logged-in customer's own records; `input.scope: 'account'` limits writes the same way and leaves reads as declared.

- **Not logged in:** a scoped call rejects with status 400, code `UNAUTHORIZED`, a create included.
- **Customer:** a create is stamped with their account, in `account_id` or, in a model without one, its only link to `accounts`, and the caller cannot set that field. Another customer's record rejects with 404 on update and delete. With `scope`, a list returns their records only and ignores a filter on that field, and another customer's record resolves by id with an empty string.

- **Customer-owned data**, such as a wishlist: `scope: 'account'`.
- **Data that everyone reads and customers submit**, such as reviews: `input.scope: 'account'`, with a pinned query that shows only approved records. Logic the model cannot declare goes through an app route function that checks `req.session?.account_id` (`SKILL.md`, "Calling App Functions"), or in an app's own frontend through an `/app-api` handler (the app skill's `references/frontend.md`).

## App fields on standard models

`$app.<app_id>.*` fields of products and other standard models are returned to any storefront key when the app marks them public, wherever a storefront reads the model, the cart included. They do not open a model that storefronts do not read. Fields the app does not mark public are absent, with no error. A public link field of an app expands only with that app's own key. The storefront GraphQL API returns no app fields.
