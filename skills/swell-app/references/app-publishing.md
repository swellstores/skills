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
- `-s` and `-e` skip the install confirmation. Once the store and environment are known, and before any prompt, the command checks that no other app holds the app's ID there (see "One app per ID in a store environment"); a held ID ends it with exit code 1 and nothing installed. It installs the app the current store owns with the `id` in `swell.json`, never another owner's installed app that shares the ID.
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

**Record data is kept unless the uninstall asks to clear it.** By default, rows in the app's own collections, `$app.<app_id>.*` values already written onto standard records and the app's saved settings values all survive, and become addressable again once the app is reinstalled. Two options of an uninstall or an app delete clear them: "Clear app settings" (`clear_settings`) deletes the saved settings, and "Clear app data" (`clear_data`, store owner only) deletes the app's own records and the fields it added to standard records, which can't be undone. Neither applies to a theme. Never treat an uninstall without them — or the uninstall half of a version update — as a data reset; plan migrations on that basis.

Uninstall is a **reversible flag, not a delete**: it PUTs `uninstalled: true` to `/client/apps/<app_id>`, and reinstalling flips the flag back and restores the app's `public_id`. While `uninstalled` — or `active: false` — the installed app's credentials stop authenticating, surfacing as `app_uninstalled` / `app_inactive`.

```bash
swell app uninstall <app record id> -s <store> -e <environment>        # asks for confirmation
swell app uninstall <app record id> -s <store> -e <environment> --yes  # without a terminal
swell app uninstall <app record id> -s <store> -e <environment> --clear-settings --clear-data
```

- Its earlier name, `swell app _uninstall`, still works. The argument is the app's **record id**, as a refused push or install prints it, not the `id` in `swell.json`: 24 hexadecimal characters, or a plain name such as `vercel` for a few early apps. An id that names another app by its `id` is refused. The command needs no app folder, so it removes another owner's app as well as your own. `-s` defaults to the current store. `-e` takes `live`, `test` or the id of another test environment, as the refusal prints it, and defaults to `test`.
- Without a terminal it needs `--yes`. It ends with exit code 1 whenever it uninstalls nothing: declined, nothing installed there (`App <id> isn't installed in store <store> (<Env>).`), a development install, or storefronts using the app.
- It does not remove a **development install**: the store's own app leaves an environment only by being deleted, with `swell app delete` run from its folder. A theme of the store is uninstalled in the dashboard instead.
- It refuses an app that storefronts in that environment use, as their app or as their theme, and lists them: delete those storefronts in the dashboard first.
- The app's settings and data stay in the store unless `--clear-settings` or `--clear-data` is given. An app installed in its place does not get them, except the store's own app with the same `id` through `--replace-app` (see "Replacing an installed app with your own"). The API deletes them after the uninstall answers. `--clear-data` is refused for a user who isn't the store owner, and both flags are refused for a theme. Uninstalling a theme deletes the store's copies of it in that environment.

Two guards to expect rather than retry through: a theme app with connected storefronts refuses to uninstall (`Cannot uninstall theme app with connected storefronts`), and any install, update, or uninstall attempted while another async app operation is in flight fails with `App is currently processing '<type>'` — wait for the uninstall to finish before installing the next app.

## One app per ID in a store environment

Two different apps can't be installed with the same ID (`private_id`, the `id` in `swell.json`, or a published `public_id`) in one store environment; themes may share an ID with other themes. A disabled app still holds its ID; only uninstalling frees it. Swell refuses the install with the error code `APP_ID_IN_USE`, and the same refusal comes from creating an app whose development install it would block and from uploading files to an app whose development install is refused.

`swell app push` and `swell app install` check this first, before any prompt, upload or deploy — also when no file changed — and stop with exit code 1, with or without a terminal. They print the refusal to stderr as it is, each command and URL on a line of its own: the error code and the instruction, for a push the way to keep both apps, then the commands and the dashboard page that remove each app holding the ID:

```
Error: [APP_ID_IN_USE] "Acme Reviews" (1.2.0) already uses app ID "reviews" in Test. Uninstall it to free the ID.

To keep both apps, choose an unused "id" in swell.json and push again.

To uninstall it and keep its settings and data, run:
  swell app uninstall 6b03f73bef3829679cf0b375 -s my-store -e test
Or in the dashboard:
  https://my-store.swell.store/admin/test/apps/6b03f73bef3829679cf0b375
```

- An installed app names `swell app uninstall` with the holder's record id, store and environment, also an early app of another owner installed without a version. Several of them share one block: the commands, then the pages. The store's own development app names `swell app delete`, run from its folder, between `swell switch <store>` and `swell switch <current store>` when that store isn't the current one: delete works on the current store's app with the folder's `id`. The refusal then says to retry from the folder of the refused command. A theme of the store gets no command: it is uninstalled in the dashboard, once no storefront uses it. An installation of an app that was deleted has no command and no page: the instruction says to ask Swell support, with its installation id. Next to such an installation the instruction and the CLI name each app instead of saying "it", as the ID is free only once all of them are gone.
- The line about a new `id` comes with a push only: it creates a separate app.
- When the app in the folder can replace the holder and you are the store's owner, the refusal leads with the replace option instead of the uninstall block (see "Replacing an installed app with your own"):

  ```
  Error: [APP_ID_IN_USE] "Acme Reviews" v1.2.0 already uses app ID "reviews" in Test.

  To replace it and move its data and settings:
    swell app push --replace-app

  To keep both apps, choose an unused "id" in swell.json and push again.
  To start with empty data, uninstall the original and retry this command.
  ```

  Install names `swell app install --replace-app -s <store> -e <environment>`, and only in the store that owns the app. To start your app with no data instead, uninstall the holder first (`swell app uninstall` with its record id, or in the dashboard), then push or install.
- The dashboard page is there for what the command can't do: a development app whose folder is elsewhere, storefronts that use the holder, a delete that is blocked.
- Push, install and `swell app delete` work on the app the current store owns with the `id` in `swell.json`, never on another owner's installed app with the same ID: install names the app that holds the ID, not a missing version of it. `swell app install` takes its app from the current store, never from an installed app of another owner or a published app with that ID: to install an app another store owns, make that store the current one with `swell switch` first; a published app is installed from the App Store in the dashboard.
- Apps already installed together keep working: pushing, updating and installing a new version of either is not refused.

## Replacing an installed app with your own — `--replace-app`

When the app holding the ID is an installed version of another app with the same `id` (typically an App Store app whose open-source version you changed), the store owner can replace it with the app in the folder and keep the merchant's settings and data. The data of a store environment is stored under the app's record id, so a plain push or install of your app starts empty; the flag moves it.

```bash
swell app push --replace-app                                    # in Test
swell app push --replace-app --yes                              # without a terminal
swell app install --replace-app -s <store> -e live -v <version> # in Live, in the store that owns the app
```

The command reads a plan first, changes nothing, prints it and asks once (`Replace "Acme Reviews" in Test? (y/N)`). Without a terminal it needs `--yes`, and is refused before it reads anything otherwise.

```
Replace "Acme Reviews" v1.2.0 with "My Reviews" v1.0.0
Uninstalling the original takes both apps offline until the push finishes.

Turns off   shipping carrier "Acme shipping". Select the replacement in Settings
            afterward.
Moves       reviews (1,204 records)
            App fields on Products
            Saved settings
Excluded    App secrets, notification edits, past events and logs.
            External services may need to be reconnected.
```

Then it uninstalls the original (keeping its settings and data, as `swell app uninstall` does), creates your app if it doesn't exist, moves the settings and data, and pushes **every** file (as `--force`) or installs the version. It ends with `✔ Replaced "<name>" with "<your app>" v<version> in <Env>.` and the shipping, payment and tax settings to select again, with their Settings pages.

- **What moves:** the original's own collections and their child collections (with their numbering), its child collections and fields on standard models (from its model and content configs, all versions), its saved settings (its values over your defaults, with any keys typed into them) and the merchant's content fields on its collections. Your app's models, content, functions, notifications, webhooks and settings form are installed from your files.
- **What doesn't move:** the original's app secrets, the merchant's edits to its notifications, events, logs, workflow runs and usage. The plan also names saved settings that contain its record id (an OAuth redirect URL: update them after the replacement) and other apps whose models link to its models (they keep pointing at it until their configs are installed again).
- **Compatibility is yours.** Data moves as it is, and fields your app doesn't declare stay stored without being shown. A renamed or retyped field needs your own migration, as a new version of the original would.
- **Shipping, payment and tax settings** the original served are switched off by the uninstall and stay off until the merchant selects your app's in Settings. In Live, checkout runs without them until then.
- The app is absent in that environment until the command ends: its functions, webhooks and jobs don't run.
- **Other apps** using the services your app declares stay on: the command names them at the end. `--conflicts=disable` is refused with `--replace-app`; switch them off in the dashboard.
- **Refused before anything changes** (exit code 1): nothing to replace (no app with the ID there, and no uninstalled one that left data; it never falls back to a plain push or install); a user who isn't the store owner; your app already has data of its own there (in Test, delete it with `swell app delete` to start it over; in Live, ask Swell support); the holder can't be replaced (several apps hold the ID, it holds it as its public ID only, a development app, a deleted app, a theme or a storefront app: the refusal says which); storefronts that use the original (delete them in the dashboard first, as for `swell app uninstall`); another operation still running on either app (run again in a few minutes); several uninstalled apps with the ID that left data (ask Swell support); `install --replace-app` into a store that doesn't own the app. A push with a file or directory is refused: the flag pushes the whole app.
- **An original you already uninstalled:** `--replace-app` finds the uninstalled app with the same `id` that left data, shows the plan and moves the data.
- **If it stops** (a failed step, Ctrl-C, a lost connection): run the same command again. The store records how far it got: after the uninstall it moves the data (asking again), after the move it only pushes or installs, without asking. The failure names the step, whether the original stays uninstalled and which shipping, payment and tax settings are off. When the push or install after the move fails on an error in the app, fix it first: for an install, create a new version and run the command with that version. If a move can't finish, Swell support moves the data back. If configs of the uninstalled original are still installed, the move is refused: Swell support removes them, then run the command again.
- Not offered: replacing storefront apps and themes, replacing in a store that doesn't own the app (an agency's version in a client's store), the way back to the original, and the dashboard.

`@swell/cli` 2.9.43 and earlier don't check first. Their push asks `… has an installed version of <app>. Do you want to replace it with a development instance?` and their install `… has a development version of <app>. Do you want to replace it with an installed instance?`, and answering yes uninstalls that app. They print a refusal that reaches them as `app_id: <instruction>`.

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

## Price

An app's price is set in the partner dashboard, not in `swell.json`: open the app and choose **Edit price**. A change applies at once, with no release or review, and is logged in the app's price history. `swell.json` price fields (`price`, `price_interval`, `price_trial_days`, `price_external`) are ignored; `swell app push` warns about them and drops them, so remove them.

| Setting | Values | Notes |
|------|------|------|
| Free, Paid or Paid to the provider | | Paid to the provider (`price_external`) means the provider bills the merchant; Swell bills nothing |
| Amount (`price`) | USD | Themes $100 to $500 one-time; other apps $5 to $1,000 monthly or $5 to $5,000 one-time |
| Billing (`price_interval`) | Monthly or One-time | Themes are one-time. A paid app with installs can't switch between the two |
| Free trial (`price_trial_days`) | 0 to 30 days | Not for themes |

Companion apps are always free. A price can't change while a sale is scheduled or running. When a monthly price goes up (or a free app becomes paid monthly), stores that already have the app keep the old price for 30 days and are emailed; new installs pay the new price at once. A one-time app's existing installs pay the price they installed at, or nothing if they installed it while it was free.

## Listing

The App Store listing is the app record, filled from the app's files whenever a push changes them:

| Source | Fields |
|---|---|
| `swell.json` | `name`, `description` (≤ 70 chars), `support_email`, `support_url`, `documentation_url`, `demo_url`, `repository_url`, `preview_video_url`, `images`, `highlights`, the billing fields; for storefronts and themes also `use_cases`, `purchase_options`, `features` |
| `DESCRIPTION.md` at the app root | `full_description`, as Markdown without HTML, up to 20,000 characters |
| image files | the icon, preview images, and the images of `images` and `highlights` |

- **The files are the listing.** A key removed from `swell.json` clears its field, and deleting `DESCRIPTION.md` clears the full description. Price fields are ignored (see "Price"). A `full_description` in `swell.json` is not applied, and push warns about it.
- **Images bind by path, when the image file is pushed.**
  - The icon is `assets/icon.*`, or the file `logo_src` names. Draw it with **square corners**: the surfaces that display it round it themselves.
  - The preview images of a storefront or theme are `assets/preview.*` and `assets/preview-mobile.*`, or the files `preview_src` and `preview_mobile_src` name.
  - Each `images` entry (`id`, `image_src`, optional `title` ≤ 40 and `description` ≤ 140 chars) and each `highlights` entry (`id`, `title` ≤ 40, `description` ≤ 140, optional `image_src`) shows the file at its `image_src`.

  Each path names a file in `assets/` by its path from the app root (`assets/logo.png`); push warns when it does not, or when the app has no such file. A path pointed at a file that is already pushed and unchanged binds nothing until the file is pushed again: `swell app push --force`. Deleting or renaming a bound file leaves its image on the listing; to change an image, replace the file under the name it is bound by.
- **Release checks that the listing is complete**; push checks only the values it is given. Every app needs `name` and `description`; every app but a theme needs the icon and at least one bound `images` entry; a `storefront` of kind `shop` whose theme provider is not `app` also needs `assets/preview.*`. Only storefronts and themes may have preview images, `use_cases`, `purchase_options` or `features`. A failure lists what is missing, as in `App must have the following to release: name and description in swell.json; assets/icon.* and at least one image described in the images section in swell.json.` Staging and publishing check only that the version is released.

`./assets/` is the app's only **public** directory: asset files are stored non-private and served from an unauthenticated CDN URL, while every other file `swell app push` uploads (functions, models, settings, `package.json`, tests) is stored private with no URL. Put nothing in `assets/` you would not publish.
