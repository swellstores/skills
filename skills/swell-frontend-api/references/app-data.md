# App Data from a Storefront

An app adds data as its own collections and as fields on standard models; a storefront can build on the first only. How a model declares what is public is in the app skill's `references/data-models.md`, "Storefront exposure".

## App collections

`/apps/<app_id>/<collection>` and `/apps/<app_id>/<collection>/<id>`, through `swell.get/post/put/delete`. `<app_id>` is the `id` in the app's `swell.json`; the app's record id answers a store's key with an empty list.

- **Nothing public:** every call rejects with status 400, code `permission_error`.
- **Reads** return `id` and the public fields. Naming another field in `fields` adds nothing; expanding a link that is not public rejects.
- **A pinned query wins without an error.** A `where` or `limit` the model pins replaces the caller's, so page with `page`. A record the filter excludes resolves by id with an empty string, like any missing record.
- **Writes** reject with `permission_error` unless the model declares `input`. A field outside `input.fields` rejects the whole write, and `param` names it. Field validation resolves with `errors` instead: `{ errors: { note: { code: 'REQUIRED' } } }`, or `UNIQUE` for a duplicate.

## Who can write

With `input` and no `scope`, any visitor can create records and change or delete any record by id, those the pinned query hides included, and a write answers with the whole record, not only its public fields.

With `input` and `scope: 'account'`:

- **Not logged in:** a create succeeds without an owner, so no storefront caller reaches the record again. Every other call rejects with status 400, code `UNAUTHORIZED`.
- **Customer:** a create is stamped with their `account_id`, and sending one is refused. A list returns their records only and ignores an `account_id` filter. Another customer's record resolves by id with an empty string, and rejects with 404 on update and delete.

`scope` without `input` is not applied: everyone reads every record.

So scope gives ownership, not login, and a `swell.account.get()` check only hides the form.

- **Customer-owned data where a record without an owner does no harm**, such as a wishlist: direct writes with `scope: 'account'`.
- **Login required, or moderation and fields the server sets**, such as reviews: no `input`. The storefront posts to an app route function that checks `req.session?.account_id` (`SKILL.md`, "Calling App Functions"), or in an app's own frontend to an `/app-api` handler (the app skill's `references/frontend.md`).

## App fields on standard models

Do not build a storefront on `$app.<app_id>.*` fields of products or other standard models. A store's own key and another app's key never return them, whatever the field declares. The app's own key returns its public fields only on the first read of a path in about five seconds, so a single test passes and a page under traffic rarely gets the value. Put such values in an app collection, or return them from a route function.
