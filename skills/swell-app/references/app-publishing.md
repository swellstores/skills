# Publishing & Distribution

`swell app push` deploys working state to the developing store's test environment. Distribution is a separate lifecycle built on immutable **versions**: create a version, install it into store environments, and optionally release it for App Store publication. All commands operate on the app in the current `swell.json`.

## Creating versions — `swell app version`

```bash
swell app version                      # print the latest remote version
swell app version 1.0.0 -m "First release" -y
swell app version patch -y             # semver release types: major|minor|patch|pre*
```

- A version snapshots the app's current state: before creating it, the command pushes all app configs and deploys the frontend, then registers the version remotely and writes it back to `swell.json`.
- The first version requires an explicit argument — with no remote version yet, the no-argument form only reports status. (Once versions exist, the no-argument form proceeds to create one only when `swell.json`'s version is already ahead of the remote.) Each new version must be semver-greater than the current one; equal or lower versions are rejected.
- Prompts for a change description and a confirmation unless `-m` / `-y` are passed.
- Git integration: commits the `swell.json` version change and tags `<version>` (`--no-git-tag` to skip the tag). In a non-git directory the remote version is still created before the git step fails — treat the trailing `fatal: not a git repository` as cosmetic and do not re-run (the re-run fails because the version now exists).
- `--amend` updates the description of an existing version instead of creating one.

## Installing — `swell app install`

```bash
swell app install -v 1.0.0 -s other-store-id -e live
```

- Installs a version (default: latest) into a store environment (default: live). Store and environment are prompted interactively when omitted; there is no `-y`, so pass `-s` and `-e` explicitly.
- `-s` and `-e` skip the install confirmation but **not** the development-app prompt: if the target store already carries a development instance of this app (matched by `.swellrc`'s id sent as `source_id`) and the app is not already installed there, the command blocks on `… has a development version of <app>. Do you want to replace it with an installed instance?` (defaults to **no**, no flag bypasses it). Answering yes PUTs `uninstalled: true` on the dev instance first. Unattended installs are only safe into a store with no dev instance, or where the app is already installed.
- The developing store's own test environment is not a valid target — that is where the source app already lives. Installing into the developing store's live environment, or any environment of another logged-in store, is the supported path.
- An installed app gets its own API keys per store environment and starts with **empty settings values** — defaults from `./settings/` files do not carry over as saved values. Configure the app's settings in the target store after installing.

## Updating and uninstalling

Installing a newer version over an existing install is **not a patch — it is a full uninstall followed by a reinstall** of every config. `swell app install` against a store that already has the app PUTs the new `version` to `/client/apps/<app_id>`, which triggers that update. Theme apps are the exception: they reinstall in place without the uninstall pass.

Uninstall removes installed *resources*, by config type:

| Config type | What uninstall does |
|---|---|
| `model` (app's own collection) | deletes the collection definition |
| `model` (standard-model extension) | `$unset __app.<app_id>` — the extension fields leave the standard model's schema |
| `content` | deletes the content record |
| `notification` | deletes it, or blanks `content.html` when another config shares the name |
| `setting` | deletes the app's settings **config** record (fields, defaults, labels, actions) |
| `webhook`, `function` | deletes the record |
| `file`, `asset`, `theme`, `frontend` | untouched — installed as files only |

**Record data is not deleted.** The installer carries an explicit `TODO: delete related model/content data`: rows in the app's own collections and `$app.<app_id>.*` values already written onto standard records all survive, and become addressable again once the schema is reinstalled. Never treat an uninstall — or the uninstall half of a version update — as a data reset; plan migrations on that basis.

Uninstall is a **reversible flag, not a delete**: `swell app _uninstall [-s <store>] [--env <env>]` (the leading underscore is part of the command name; `--env` defaults to `test`) confirms, then PUTs `uninstalled: true` to `/client/apps/<app_id>`. It errors with `app not installed on store.` or `app already uninstalled on store.`. Reinstalling flips the flag back and restores the app's `public_id`. While `uninstalled` — or `active: false` — the installed app's credentials stop authenticating, surfacing as `app_uninstalled` / `app_inactive`.

Two guards to expect rather than retry through: a theme app with connected storefronts refuses to uninstall (`Cannot uninstall theme app with connected storefronts`), and any install, update, or uninstall attempted while another async app operation is in flight fails with `App is currently processing '<type>'`.

## Releasing — `swell app release`

```bash
swell app release 2.0.0 --release-notes ./releases/v2.0.0.md
swell app release 2.0.0 --amend -m "Corrected description"
```

Marks a version as released for App Store publication. Released versions are reviewed by the Swell team before they are published, and the app must be connected to a partner account with publishing access — private distribution via `swell app install` needs neither.

- If the version does not exist yet, it is created first (same flow as `swell app version`).
- Re-releasing an already-released version errors; use `--amend` to update its description or release notes.
- `--release-notes <file>` attaches release notes from a file; `--not-supported` marks the version as not officially supported by the developer.
- One version can be staged at a time — releasing a different version unstages the currently staged one (confirmed interactively; `-y` covers it).

## Billing fields (`swell.json`)

| Field | Type | Notes |
|------|------|------|
| `price` | number ≥ 0 | App price; omit or `0` for free apps |
| `price_interval` | `"once"` \| `"monthly"` | Defaults to `monthly` when `price > 0` |
| `price_trial_days` | number ≥ 0 | Free-trial length for priced apps |
| `price_external` | boolean | Billing handled outside Swell |

## Marketing fields

App-record fields validated **server-side at release time** — missing fields fail `swell app release`, never `swell app push`:

| App type | Required before a version can be released |
|---|---|
| `theme` | `name`, `description` (≤ 70 chars) |
| every other type | the above, plus `full_description` (≤ 3500 chars), `support_email`, an icon (`assets/icon.*` → `logo_icon`) and a cover image (`assets/image.*` → `cover_image`) |
| `storefront` of kind `shop` whose theme provider is not `app` | the above, plus a preview image (`assets/preview.*` → `preview_image`) |

There is no stricter second tier for App Store publication — staging and publishing only check that the version is released. Failures read `App must have full_description, support_email to release. Add them to swell.json.`, `App must have a cover image to release. Add image.* to the assets folder.`, or `App must have a logo icon to release. Add icon.* to the assets folder.`

Optional: `support_url`, `demo_url`, `documentation_url`, `preview_video_url`, `repository_url`.

Text fields belong in `swell.json`, but only an allow-list of keys is applied to the app record, and the marketing subset — `description`, `full_description`, `support_url`, `documentation_url`, `support_email`, `preview_video_url`, `demo_url`, `repository_url`, `price` — is **cleared to `null` when the key is absent from the manifest**. Editing those in the dashboard is therefore temporary: the next push carrying a changed `swell.json` wipes whatever the manifest omits. Keep them all in the manifest.

`full_description` has a second source, `assets/description.md`. Assets push before ordinary files, so a push carrying both applies `description.md` first and then overwrites it from `swell.json` — define it in one place.

Images come from `./assets/`, matched by filename (`icon.*` → `logo_icon`, `image.*` → `cover_image`, `preview.*` → `preview_image`), not from manifest fields — a rename silently unbinds them and surfaces only at release.
