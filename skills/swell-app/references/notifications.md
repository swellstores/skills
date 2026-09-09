# Notifications

Notifications are transactional emails triggered by model events, defined in `./notifications/` using a paired-file convention: a JSON manifest (`<name>.json`) and a Liquid template (`<name>.tpl`) must share the same base filename. Consult `swell schema notification --format=dts` for all configuration properties.

**Event binding.** Notifications fire only on record **create and update** — the platform triggers them on `post`/`put` only. Set `event` to `created`, `updated`, or a custom event declared in the collection's data model; `deleted` is accepted by the schema but never dispatches, so use a function or webhook for delete-driven mail. An undeclared custom event is **not** rejected at deploy either — the notification installs silently and never fires. Verify the deployed `(model, name)` binding with `swell inspect notifications --app=.` and by triggering the event; the list key includes the model since name alone is not unique within an app. File basenames must not contain `.` — push rejects them, because the inspect identifier grammar splits on dots.

**Dispatch controls.** Binding alone does not decide whether a notification sends. Two defaults surprise people:

- **`repeat` defaults to `false`, meaning once per record, ever.** Before sending, the platform counts existing messages for `(template, record_id)` and skips when any exist — a notification bound to `order.updated` fires on the *first* qualifying update to an order and never again for that order. Set `"repeat": true` for anything that should send more than once per record.
- **A notification with neither `conditions` nor `event` never sends.** That is deliberate legacy behavior, not a bug — always declare at least one.

Also: `new: true` restricts sending to record creation (POST) only; `conditions` are evaluated against the record with `$record`, `$data`, `$origData`, `$method`, `$env`, `$notify` in scope (an empty `{}` counts as no condition and passes); `delay` is in **minutes**; `cc`/`bcc` are comma-separated strings capped at 80 characters total; `attachments` holds at most 5 model field paths.

**Testing.** `sample` supplies the record used when the dashboard renders a test/preview send — without it the preview renders against an essentially empty record and every `{{ field }}` comes out blank. It costs nothing at runtime, being read only on test sends. Any notification sent from a non-live environment gets `(TEST) ` prepended to the subject, so never assert on an exact subject line in test-environment checks.

**Recipient resolution.** Set `contact` to a dot-notation path resolving to an email field (e.g., `"contact": "account.email"`), or set `admin: true` for store administrator delivery. The contact path is expanded automatically when the recipient is resolved — `query.expand` is what the **template** needs instead: any relationship your `.tpl` references (`{{ account.name }}`) must be listed there, e.g. `"expand": ["account"]`.

**Child collections.** Use colon notation for the collection (`"collection": "reviews:comments"`). In templates, the parent record is accessible via the `parent` variable; expand upward with `"expand": ["parent", "parent.product"]`.

The `.tpl` file uses Liquid syntax. Record fields are accessed directly (`{{ product.name }}`), child collection parents via `{{ parent.field }}`. Two global objects are available in all templates, plus a `get` filter:

`settings` — App settings from `./settings/`, enabling conditional content: `{% if settings.rewards.enabled %}...{% endif %}`.

`store` — Store metadata: `name`, `url`, `logo`, `currency`, `support_email`.

`get` — a Liquid **filter**, not a function: `{{ '/products/abc' | get }}` fetches additional Swell data during rendering. It takes only the URL string — there is no second `data` argument, so interpolate any parameters into the URL yourself.

Admin-editable fields defined in the manifest's `fields` array are accessed via `{{ content.field_id }}`. Standard Liquid filters apply: `{{ date_created | date: '%b %d, %Y' }}`, `{{ amount | currency }}`.

Build templates with MJML for cross-client email compatibility, then convert to HTML.
