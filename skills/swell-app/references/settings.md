# Settings

Settings define merchant-configurable app behavior in `./settings/*.json`. The merchant edits them on the app's page in the dashboard; code reads them with `await req.swell.settings()` in functions and with the Backend client's `settings()` in a frontend; model and content conditions read them through `$settings`. Consult `swell schema setting --format=dts` for every property.

## Files, groups and fields

Each settings file creates a grouped panel in the App Preferences UI. Structure: `label` (panel heading), `description` (explanatory text), `fields` (array using content field syntax), and optional `actions` (items in the Actions menu of the app's page — see `references/actions.md`). Multiple files render as grouped panels.

- **Group keys are kebab-cased filenames.** Settings returned by `settings()` are namespaced under the filename, but the CLI converts `_` to `-` first: `settings/new_section.json` deploys as the group `new-section`, read as `settings['new-section'].<field>` — `settings.new_section` is `undefined`. Name settings files in kebab-case so the group key matches the filename exactly.
- **`field_group` does not introduce nesting** — its child fields are flattened to the parent level.
- **Select-style fields require `options` entries as `{ "value": …, "label": … }` objects** — bare strings fail validation.
- **One record per app.** An app's settings files collapse to one platform record at push time. Inspect it with `swell inspect settings --app=.`.
- **Saved values do not travel with the app.** An app installed in another store or environment starts with empty settings values — see `references/app-publishing.md`.

## Configuration, credentials and secrets

**Functions and managed frontends have no custom runtime variables or secret bindings.** Settings configure them, and settings are not a secret store. A frontend self-hosted in the developer's Cloudflare account can use its own bindings and secrets; setup is covered in `references/frontend.md`, "Self-hosting on Cloudflare".

- The deployed function worker is uploaded with **no Cloudflare bindings** (upload metadata carries only `body_part`, `tags`, `annotations`) and the runtime wrapper discards the env argument, so `env.MY_SECRET` is undefined. `process.env` does not exist either — functions run service-worker format with no `nodejs_compat`.
- `.dev.vars` is **never uploaded** — `swell app push` ignores `**/.dev.vars*`. It feeds the `frontend/` dev server only. A managed frontend gets no custom variables or bindings either (`references/frontend.md`).
- **`"type": "secret"` masks the input; it does not protect the value.** Use it for API keys and other credentials the merchant enters: the dashboard hides the value behind a show button. It is an alias of `short_text`, so the value is stored as an ordinary string and `settings()` returns it like any other field. The only access flags on a field are `public` (expose to the storefront API) and `private` (restrict from it).
- Settings are **not isolated per app**. `await req.swell.settings('<other_app_id>')` is a plain `GET /settings/<id>` sent with the caller's own app credentials. An app with an empty `permissions` array — the `swell create app` default — is authorized for everything, and so is an app that declares `read_settings`. Assume any other installed app can read your provider credentials.
- Rotation of a settings value is a merchant action in App Preferences; there is no separate store to purge and no versioning of old values. A secret the merchant must not see belongs in the developer's own service or a secret binding of a self-hosted frontend. Never put it in settings or bundle it into app code. A frontend's secret binding is not available to app functions; code needing it must execute in that frontend's server runtime or in the external service.

An app that declares `permissions` needs `read_settings` to read even its own settings — see `references/permissions.md`.
