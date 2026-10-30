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
| `price` | number ≥ 0 | App price; `0` for a free app |
| `price_interval` | `"once"` \| `"monthly"` | Defaults to `monthly` when `price > 0` |
| `price_trial_days` | number ≥ 0 | Free-trial length for priced apps |
| `price_external` | boolean | Billing handled outside Swell |

## Listing

The App Store listing is the app record, filled from the app's files whenever a push changes them:

| Source | Fields |
|---|---|
| `swell.json` | `name`, `description` (≤ 70 chars), `support_email`, `support_url`, `documentation_url`, `demo_url`, `repository_url`, `preview_video_url`, `images`, `highlights`, the billing fields; for storefronts and themes also `use_cases`, `purchase_options`, `features` |
| `DESCRIPTION.md` at the app root | `full_description`, as Markdown without HTML, up to 20,000 characters |
| image files | the icon, preview images, and the images of `images` and `highlights` |

- **The files are the listing.** A key removed from `swell.json` clears its field, and deleting `DESCRIPTION.md` clears the full description. The billing fields are the exception: a removed key keeps the stored value, so a free app sets `price` to `0`. A `full_description` in `swell.json` is not applied, and push warns about it.
- **Images bind by path, when the image file is pushed.**
  - The icon is `assets/icon.*`, or the file `logo_src` names. Draw it with **square corners**: the surfaces that display it round it themselves.
  - The preview images of a storefront or theme are `assets/preview.*` and `assets/preview-mobile.*`, or the files `preview_src` and `preview_mobile_src` name.
  - Each `images` entry (`id`, `image_src`, optional `title` ≤ 40 and `description` ≤ 140 chars) and each `highlights` entry (`id`, `title` ≤ 40, `description` ≤ 140, optional `image_src`) shows the file at its `image_src`.

  Each path names a file in `assets/` by its path from the app root (`assets/logo.png`); push warns when it does not, or when the app has no such file. A path pointed at a file that is already pushed and unchanged binds nothing until the file is pushed again: `swell app push --force`. Deleting or renaming a bound file leaves its image on the listing; to change an image, replace the file under the name it is bound by.
- **Release checks that the listing is complete**; push checks only the values it is given. Every app needs `name` and `description`; every app but a theme needs the icon and at least one bound `images` entry; a `storefront` of kind `shop` whose theme provider is not `app` also needs `assets/preview.*`. Only storefronts and themes may have preview images, `use_cases`, `purchase_options` or `features`. A failure lists what is missing, as in `App must have the following to release: name and description in swell.json; assets/icon.* and at least one image described in the images section in swell.json.` Staging and publishing check only that the version is released.

`./assets/` is the app's only **public** directory: asset files are stored non-private and served from an unauthenticated CDN URL, while every other file `swell app push` uploads (functions, models, settings, `package.json`, tests) is stored private with no URL. Put nothing in `assets/` you would not publish.
