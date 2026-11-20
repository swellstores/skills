# Settings

Settings define merchant-configurable app behavior in `./settings/*.json`. The merchant edits them on the app's page in the dashboard; code reads them with `await req.swell.settings()` in functions and with the Backend client's `settings()` in a frontend; every kind of condition — function, notification, content and model event — reads them as `$settings`. Consult `swell schema setting --format=dts` for every property.

## Files, groups and fields

Each settings file is a section of the app's settings page: `label` (heading), `description` (shown under it, with Markdown links and line breaks), `fields` (content field syntax) and optional `actions` (items in the Actions menu of the app's page — see `references/actions.md`). Sections with a `position` come first, lowest first; the rest follow by label. A field's `description` is its help tooltip and its `hint` shows under it, with Markdown links; on an action field `hint` is the button's hover tooltip and `description` shows under it.

- **The group key is the filename.** Settings returned by `settings()` are namespaced under it: `settings/new-section.json` is read as `settings['new-section'].<field>`. A `_` in the name deploys as a dash, and push warns about it.
- **`field_group` does not introduce nesting** — its child fields are flattened to the parent level.
- **Select-style fields require `options` entries as `{ "value": …, "label": … }` objects** — bare strings fail validation.
- **One record per app.** An app's settings files collapse to one platform record at push time. Inspect it with `swell inspect settings --app=.`. To set values for a test without the dashboard, write them to the same record: `swell api put '/settings/<app_id>' --body '{"<group>":{"<field>":"…"}}'`.
- **Saved values do not travel with the app.** An app installed in another store or environment starts with empty settings values — see `references/app-publishing.md`.

## Configuration, credentials and secrets

Two places hold credentials, by whose they are:

| | App secrets | Settings field `type: "secret"` |
|---|---|---|
| What | the developer's credentials, the same for every store | a credential of one store: one the merchant enters, or one the app obtains (an OAuth token) |
| Example | OAuth client secret, partner API key | the merchant's access token, a pasted API key |
| Who sets | the developer: `swell app secret set <NAME>` | the merchant in the dashboard, or the app's code with `PUT /settings/<app_id>` |
| Scope | every install of the app, in every store and environment | one install: one store, one environment |
| In a function | `req.appSecrets.NAME` | `(await req.swell.settings()).<group>.<field>` |
| Changes take effect | usually on the next call, within a minute across all installs, without a new app version | on the next read |

**App secrets** (`swell app secret set|list|unset`, run in the app directory after the first push):

- The value is asked for with hidden input or read from stdin (`printf %s "$VALUE" | swell app secret set NAME`), never an argument. One trailing newline from stdin is dropped.
- Names match `^[A-Z][A-Z0-9_]{0,63}$`; values are strings up to 4 KB, up to 32 secrets and 8 KB per app. Errors: `secret_name_invalid`, `secret_too_large`, `secrets_limit_reached`.
- Values are encrypted at rest. No API returns them, `list` shows names and dates only. They reach the app's functions on every call, in the `req.appSecrets` object (read-only, `undefined` for a missing name), and nowhere else: not workflows, not frontends, not other apps.
- **Never under `swell app dev`.** Functions running on the developer's machine get an empty `req.appSecrets`; `swell app dev` says so at start. A local proxy can be set on an install by any user of its store, so the developer's credentials stay on Swell's workers. Routes are never tunneled, so a route (an OAuth callback) always has them.
- They are bundled into the function's runtime at push: a function pushed with a CLI older than `swell app secret` has no `req.appSecrets`. Push again after upgrading.
- Anyone who can push the app can set them, and can deploy a function that returns them: treat push access as secret access. Don't log them, return them from a route, or copy them into records or settings: function logs and records are visible to the merchant's staff.
- They belong to one app record. A copy of the app pushed from another store is another app with its own secrets.
- An identifier that goes with a secret, such as an OAuth client id, can be an app secret too.

**Functions and managed frontends have no custom runtime variables or secret bindings** beyond app secrets. A frontend self-hosted in the developer's Cloudflare account can use its own bindings and secrets; setup is covered in `references/frontend.md`, "Self-hosting on Cloudflare".

- The deployed function worker is uploaded with **no Cloudflare bindings** (upload metadata carries only `body_part`, `tags`, `annotations`) and the runtime wrapper discards the env argument, so `env.MY_SECRET` is undefined. `process.env` does not exist either — functions run service-worker format with no `nodejs_compat`.
- `.dev.vars` is **never uploaded** — `swell app push` ignores `**/.dev.vars*`. It feeds the `frontend/` dev server only. A managed frontend gets no custom variables or bindings either (`references/frontend.md`).
- **`"type": "secret"` masks the input; it does not protect the value.** Use it for API keys and other credentials the merchant enters, and for tokens the app obtains: the dashboard hides the value behind a show button. It is an alias of `short_text`, so the value is stored as an ordinary string and `settings()` returns it like any other field. The only access flags on a field are `public` (expose to the storefront API) and `private` (restrict from it).
- **`"readonly": true`** shows a field the merchant can't edit, such as a token the app obtains with OAuth (`references/oauth.md`). It limits only the dashboard: the app's `PUT /settings/<app_id>` still writes it, and the dashboard never saves a read-only field back. Keep such a token in a settings group of its own.
- Settings are **not isolated per app**. `await req.swell.settings('<other_app_id>')` is a plain `GET /settings/<id>` sent with the caller's own app credentials. An app with an empty `permissions` array — the `swell create app` default — is authorized for everything, and so is an app that declares `read_settings`. Assume any other installed app can read your provider credentials.
- Rotation of a settings value is a merchant action in App Preferences; there is no separate store to purge and no versioning of old values. The developer's own credentials go in app secrets. Never put them in settings or bundle them into app code.
