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

- Installs a version (default: latest) into a store environment (default: live). Store and environment are prompted interactively when omitted; there is no `-y`, so pass `-s` and `-e` explicitly for non-interactive use.
- The developing store's own test environment is not a valid target — that is where the source app already lives. Installing into the developing store's live environment, or any environment of another logged-in store, is the supported path.
- An installed app gets its own API keys per store environment and starts with **empty settings values** — defaults from `./settings/` files do not carry over as saved values. Configure the app's settings in the target store after installing.

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

App-record fields validated **server-side at release time** — missing required fields are reported then, not at push:

- Required to release: `name`, `description` (≤ 70 chars), and an app icon (`assets/icon.*`).
- Additionally required for App Store publication: `full_description` (≤ 3500 chars), `support_email`, and a cover image (`assets/image.*`).
- Optional: `support_url`, `demo_url`, `documentation_url`, `preview_video_url`.

Text fields belong in `swell.json` — the whole manifest syncs to the app record on push, including keys beyond the CLI-validated set. Images come from `./assets/` (`icon.*` and `image.*` are uploaded by `swell app push`), not from manifest fields.
