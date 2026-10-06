# Components

An app component is a Preact UI that renders in a **cross-origin iframe** on the app installation's own origin (`https://<store>--<installation>--app.swell.store`) and talks to the host page only through the SDK protocol. It cannot reach the admin page, its DOM, its storage, its session, or its API. The shell page that loads it, and the runtime the shell imports, are served by the platform, not by the app.

v1 host: **admin content fields** (`type: "component"` in `content/*.json`). Checkout payment components are a different mechanism — they keep the legacy `config.extension` contract, are not iframes, and are covered in `references/payment-extensions.md`. A component without `config.extension` is an iframe component; a component with it is a checkout payment component and builds the legacy way. Do not mix the two in one file.

Applies to `admin` and `integration` apps. A full working app: the `components-example-app` repository (no public URL yet).

## Files and names

- Only `.tsx` / `.jsx` files **directly in `components/`** are components. Everything else under `components/` — `components/lib/*`, root `.ts` helpers, `components/tsconfig.json` — is shared code: bundled into the components that import it and pushed as a raw file (never parsed or built).
- A component's **name** is the file name with `_` replaced by `-`: `ColorPicker.tsx` → `ColorPicker`, `color_picker.tsx` → `color-picker`. Content fields, the metadata endpoint, and the dev route all use that normalized name, so `component: "color-picker"` — not `color_picker`. `swell create component` writes PascalCase names, which need no normalization.
- Use only letters, digits, `_` and `-` in the file name. Push does not check it, but the content field's `component` must match `^[\w-]+$` and the shell page only serves `[\w-]+`, so `Color.Picker.tsx` pushes and then can never be referenced or loaded.
- `export const config` is optional and must be a **static object literal**: no spreads, no computed keys, no references to values computed at runtime. The CLI reads it from the source without running it. v1 defines only `description`. A non-static `config` fails that component's push.
- A **default export is required**. Without one the compile fails (esbuild: `No matching export … for import "default"`) and push prints a `Unable to compile component <name> …` line for that file. Legacy payment components (`config.extension`) are different: a missing default export deploys and renders nothing.
- Push is not all-or-nothing and exits 0 on per-file failures — see `references/cli.md`. A component that failed to compile is simply missing, which then fails any content that names it.

## Scaffold

```bash
swell create component ColorPicker -d "Brand color picker" -y
```

Writes `components/ColorPicker.tsx` (a text input bound to `value` / `setValue`). It also, without overwriting what exists:

- without a `package.json` it only warns (run `npm init`, then install `preact` and `@swell/apps-sdk` yourself);
- adds `preact` to `dependencies` and `@swell/apps-sdk` to `devDependencies` — run `npm install`;
- writes `components/tsconfig.json` (Preact JSX, DOM libs, `react` → `preact/compat` paths);
- adds `components` to the root `tsconfig.json`'s `exclude`;
- appends a `components/tsconfig.json` check to the `typecheck` script.

`--overwrite` replaces an existing file. Without `-y` it prompts for name and description.

## Preact

- JSX compiles with Preact's **automatic runtime whatever the tsconfig says** (the CLI prepends a pragma to every `.tsx`/`.jsx` of the app). `tsconfig` `paths` and `baseUrl` still apply.
- `react`, `react-dom` and their subpaths (`react/jsx-runtime`, `react-dom/client`) resolve to `preact/compat`, so third-party React libraries bundle. React 19-only APIs (`use`, Actions, `useOptimistic`) are not available.
- Import hooks from `preact/hooks` (or `preact/compat`). `preact` must be installed in the app: without it the build fails with `install preact in the app (npm install preact)`.
- **CSS and other non-JavaScript imports fail the build** with `components cannot import CSS or other non-JavaScript files yet (<file>); use inline styles or a <style> element`. Use inline styles, a `<style>` element, or CSS-in-JS.
- `@swell/apps-sdk` is a **types-only** dev dependency (`import type { ComponentProps } from '@swell/apps-sdk/components'`). Nothing from it is bundled. It must be a 2.x release that has the `./components` entry.
- Bundles are public. Never put secrets in a component; keep them in app settings and functions.

## `ComponentProps`

```ts
interface ComponentProps<TValue = unknown, TContext = Record<string, unknown>> {
  readonly value: TValue;
  setValue(value: TValue): void;
  readonly context: TContext;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly readonly: boolean;
  setValidity(error: string | null): void;
  readonly fetch: typeof fetch;
  on(event: string, handler: (data: unknown) => unknown): () => void;
}
```

Changes to `value`, `context`, `params`, `readonly` and `locale` arrive as a **re-render with new props**; there is no change event. `setValue`, `setValidity`, `fetch` and `on` keep the same identity across renders. Values and context must be structured-cloneable.

What the admin content field puts into the props:

| Prop | Content |
|---|---|
| `value` / `setValue(v)` | The field value. `null` when the field is empty (an `''` a component sent stays `''`). `setValue(null)` — or `undefined`, which arrives as `null` — clears any field, string fields included. |
| `context` | `{ record, field }`. `field` is `{ id, label, required, type }`. |
| `params` | The field's `params` from `content/*.json`. `{}` when none. |
| `settings` | The app's **public** settings (setting fields flagged `public`). |
| `locale` | The store's default locale. Localized component values are not supported. |
| `readonly` | `true` while the field is disabled or read-only. A `setValue` sent while read-only is dropped. |
| `setValidity(msg)` | `msg` blocks saving and shows under the field; `null` clears it. |
| `fetch` | See "Calling the backend". |
| `on` | The admin sends no events to content field components. |

Exact semantics:

- `context.field.type` is the **model field type** (`string`, `int`, `array`, `object`, …), so a component knows what it stores. It is `'string'` when the app's models do not declare the field.
- `context.record` depends on where the field is:
  - **Record page** (edit and new): the whole record **with unsaved form edits**, so a component can read other fields. The record is the form's own data and is not filtered by permissions (no filtering is applied in `conditionValues`).
  - **Row of a collection field**: the row.
  - **App action modal**: the modal's form values. There is no record and the target record id is not passed (the action's `record_id` is not in `context`).
- `$settings` is not part of `context.record`; use `props.settings` for public settings.
- `setValue` is type-checked against the model field type. On a `string` field a non-empty non-string value is **rejected, not coerced** (`null` is not rejected; it clears the field): the field shows `The component sent <a list | an object | a number | …>; this field stores text.`, the value does not change, and the form cannot be saved until the component sends a valid value. Send strings (`JSON.stringify` for structured data) or declare the field in `models/` with the type you store.
- `setValidity('message')` keeps the form from saving until the component calls `setValidity(null)`. A stale message can remain visible after clearing until the next change or submit.
- A component that fails to start shows its error under the field and does not take the form down. An error after a successful start shows as a notice and does not block saving.

## Using a component in content

```jsonc
// content/labels.json
{ "id": "color", "label": "Color", "type": "component", "component": "ColorPicker", "params": { "palette": ["#fff", "#000"] } }
```

- `component` (required) names a component. `params` (optional) must be a plain object. A missing or non-`[\w-]+` `component`, or non-object `params`, fails the push.
- **Storage:** when `models/` declares the field, that definition wins (an `array` of objects stays an `array`; the component must send that type). Otherwise the platform creates a `string` field.
- Works for app models and standard models (`admin_zone`, with the field declared in `content/<standard-model>.json`), at any depth inside field groups, rows and collection items. App settings (`settings/*.json`) accept it too.
- **Push order:** models → components → content → assets → functions → notifications → settings → … `swell app push` uploads components before content and settings, so a first push works.
- **A field naming a component the app does not have fails the push** with `Content field '<id>' uses component '<Name>', which the app does not have. Add components/<Name>.tsx (or .jsx) and push it.` Only *built* components of the app's own unversioned configs count: a shared file under `components/lib` is not a component, and a component that failed to compile is missing. The check covers content and settings fields at any depth, but **not fields inside action `modal.fields`**: a missing component there passes push and the admin shows the field's error.
- Deleting a component that content still uses is not checked at release: the field shows an error in the admin.
- `type: "component"` is allowed in action modals (only `action` fields are not). In a modal `context.record` is the modal's values.
- **List columns** render a primitive value as text. An object or array renders no text (a dash in collection-field rows). A column's view `template` renders as text for component columns.

## Calling the backend

`props.fetch` is `window.fetch` plus the **component token**: it adds `Swell-Component-Token` to every request whose URL is on the frame's own origin (the app installation's origin), and to nothing else.

```ts
const res = await props.fetch(`/functions/my_app/get-risk?order=${props.context.record.id}`);
const preview = await props.fetch('/app-api/risk'); // the app's frontend, if it has one
```

- **Third-party URLs get the plain `fetch`** — no token. A component that needs a third-party API with secrets goes through an app function.
- The platform verifies the token (signature, expiry, store, installation, app) and mints a signed **`Swell-Context`** with `surface: 'admin'` and `admin: { user_id }` for the call. The token is valid for 600 seconds and is refreshed by the host; it is scoped to one installation of one app.
- **Functions** see the minted context as `req.swellContext` — `{ appId, installationId, storeId, storeUser, surface, storefrontId? }` — and `null` unless the platform forwarded a signed context. The runtime does not verify the signature (only the platform can set the header); call `verifySwellContext(req.headers)` from `@swell/apps-sdk` when a function needs proof.
- **A route function called with its own app's context does not need `route.public: true`**, and a secret key is not required. Only route functions qualify (not hooks or cron), only of the token's own app. Calls for another app's function fall back to the normal secret-key rule.
- **GET responses for such calls are not cached.**
- **The app frontend** verifies the context with `verifySwellContext` (see `references/frontend.md`). `surface` is absent on contexts the proxy mints for ordinary requests, and `'admin'` for a component call.
- **A verified context is not proof of an admin.** The proxy signs a context for **every** request through the app origin, anonymous visitors included, with `admin: null`. A route that returns or changes store data **must** check both `surface` and `storeUser`, exactly:

  Function:

  ```ts
  if (!(req.swellContext?.surface === 'admin' && req.swellContext.storeUser)) {
    throw new SwellError('Admin component calls only', { status: 403 });
  }
  ```

  App frontend (Hono shown; `verifySwellContext` throws on a missing or invalid context, which also means reject):

  ```ts
  const ctx = await verifySwellContext(c.req.raw.headers, { env: c.env }).catch(() => null);
  if (!(ctx?.surface === 'admin' && ctx.storeUser)) {
    return c.json({ error: 'admin_component_only' }, 403);
  }
  ```

  `storeUser` without `surface` is an admin browsing the app frontend with their dashboard cookie, not a component call; `surface` is set only when a component token was used. A bare `if (req.swellContext)` is not a check.
- `req.swellContext` is `null` unless the platform forwarded a signed context (secret-key calls, storefront calls, hooks, cron). Treat `null` as "not from a component", never as "allowed".
- The token is never accepted as a `Swell-Context`: it has its own token type and audience, and the platform drops any `Swell-Context` a client sends.

## Develop and deploy

- `swell app dev` pushes the app, then serves component modules from your machine and rebuilds on every change. It prints `Component modules at: http://localhost:<port>/.swell/components/<Name>.js`. While the dev session sets `local_proxy_url`, the shell page loads the bundle from `<local_proxy_url>/.swell/components/<name>.js` instead of the CDN. Edits to shared files (`components/lib/*`) rebuild every component.
- `swell app push` builds each component to an ES module and uploads it with the source and static `config`. Neither build ever runs the component.
- The admin loads the components of the **installed version**; a development install (no version) uses the current unversioned build.
- **The component hash includes its imports**: editing only `components/lib/*` redeploys every component that imports it on the next plain `swell app push`, no `--force` needed. After upgrading to a CLI with component builds, push each component once: the hash changed.
- `swell inspect` has no component topic. Check that a component deployed from the push output and by opening the field.

## Security model

- The iframe isolates the component: its own origin, no access to the admin DOM, storage or session. Frames may only be embedded by the store's admin origin (`frame-ancestors`).
- Context comes from the host. The admin passes the whole record; a component sees what the form holds.
- The token is short-lived (600 s), scoped to installation and app, bound to the admin session user at issue time, and never accepted as `Swell-Context`. It is issued only to a signed-in dashboard session. It keeps its admin identity until it expires, even after the merchant signs out.
- `props.fetch` sends it only to the app's own origin, never to third parties.
- **Cookies on the app origin are unchanged**; the component mechanism does not depend on them. Requests without a component token use the existing cookie flow.
- A component never writes records itself: `setValue` changes the form and the merchant saves with their own session.
- **Overlay mode:** a component that opens a modal (a fixed element covering the frame's viewport) switches its frame to cover the host page. Page scrolling is locked meanwhile. A component can therefore draw over the admin; reviewed apps only.

## Common mistakes

- **Importing CSS** (or an image). The build fails. Inline the styles.
- **Expecting React APIs that Preact compat lacks.** React 19-only APIs (`use`, Actions, `useOptimistic`) are not available.
- **Fetching a third-party API and expecting the token there.** Only same-origin requests carry it.
- **A route or frontend handler that trusts `req.swellContext` / a verified context without checking `storeUser` and `surface`.**
- **Treating a missing `req.swellContext` as allowed.** It is `null` unless the platform forwarded a signed context; decide deliberately.
- **Hard-coding the store id.** Use `req.swellContext.storeId` / `context.storeId`; the app origin is per installation and relative URLs already target the right one.
- **Sending a non-empty non-string with `setValue` on a content-only field.** It is rejected (`null` clears); declare the field in `models/` with the real type.
- **Forgetting the `exclude` in the root `tsconfig.json`.** The root config checks functions with Worker libs, which conflict with the DOM libs components need; `swell create component` adds `components` to `exclude`, and a hand-built setup must too.
- **A `component` name that does not match the pushed name** (`color_picker.tsx` is `color-picker`).
- **Naming a component file with dots or other characters outside `[A-Za-z0-9_-]`.** It pushes and then cannot be used.
- **Expecting events.** The admin sends none; `props.on` is for later hosts.
- **Putting `config.extension` on an admin field component.** That switches the file to the legacy checkout build.
