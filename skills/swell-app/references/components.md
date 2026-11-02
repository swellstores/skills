# Components

An app component is a Preact UI that renders a **content field** in the admin in place of a built-in input. It runs in a cross-origin iframe on the app installation's origin (`https://<store>--<installation>--app.swell.store`): no access to the admin DOM, storage or session. Swell serves the frame page and its runtime from `/.swell/components/` and `/.swell/sdk/` on that origin (reserved: an app frontend cannot use these paths); the app ships only the component.

A component with `config.extension: { id }` and `targets` is a checkout payment component: the same iframe mechanism, rendered by hosted checkout in the body of a payment method, with its own contract (`context: { cart, method }`, `submit` and `redirect` handlers, `call`) — `references/payment-extensions.md`. Never put `config.extension` on a field component.

Requires `@swell/cli` 2.9.27, `@swell/apps-sdk` 2.0.0-alpha.6 (types) and `@swell/app-types` 1.2.9 (`req.swellContext`), or later. Earlier SDK releases have no `./components` entry. Payment components need `@swell/cli` 2.9.28 and `@swell/apps-sdk` 2.0.0-alpha.7 (`call`, `targets`). `theme` is typed from `@swell/apps-sdk` 2.0.0-alpha.9.

## Files and names

- Every `.tsx` / `.jsx` file **directly in `components/`** is one component. Anything else under `components/` (`components/lib/*`, `components/tsconfig.json`) is shared code, bundled into the components that import it.
- The name is the file name: `ColorPicker.tsx` → `ColorPicker`. Use letters, digits and `-`. A `_` deploys as `-`, with a warning; push refuses a new file with any other character in its name, as one that would never load.
- A **default export is required**; without it the build fails (`Unable to compile component <name> …`).
- `export const config = { description }` is optional and must be a static object literal; the CLI reads it without running the code.
- Scaffold: `swell create component <Name> [-d <description>] -y`. It writes the file, adds `preact` and `@swell/apps-sdk` (dev, types only) to `package.json`, writes `components/tsconfig.json`, adds `components` to the root `tsconfig.json` `exclude`, and extends the `typecheck` script. Run `npm install` after.

## Build limits

- JSX always compiles with Preact's automatic runtime. `react` and `react-dom` resolve to `preact/compat`, so React libraries bundle; React 19-only APIs (`use`, Actions, `useOptimistic`) do not exist.
- **No CSS or other non-JS imports** — the build fails. Use inline styles or a `<style>` element.
- `@swell/apps-sdk` is types only: `import type { ComponentProps } from '@swell/apps-sdk/components'`.
- Bundles are public: no secrets in a component.

## Props

```ts
interface ComponentProps<TValue = unknown, TContext = Record<string, unknown>> {
  readonly value: TValue;
  setValue(value: TValue): void;
  readonly context: TContext;
  readonly params: Readonly<Record<string, unknown>>;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly locale: string;
  readonly readonly: boolean;
  readonly theme: 'light' | 'dark';
  setValidity(error: string | null): void;
  readonly fetch: typeof fetch;
  on(event: string, handler: (data: unknown) => unknown): () => void;
  call<T = unknown>(name: string, data?: unknown): Promise<T>;
}
```

| Prop | In an admin content field |
|---|---|
| `value` | The field value; `null` when empty. |
| `setValue(v)` | Changes the form value. `null` (or `undefined`) clears the field. |
| `context` | `{ record, field }`; `field` is `{ id, label, required, type }`, `type` being the stored type (`'string'` when `models/` does not declare the field). |
| `params` | The field's `params`; `{}` when none. |
| `settings` | The app's public settings. |
| `locale` | The store's locale. |
| `readonly` | The field is disabled or read-only. A `setValue` sent anyway is ignored. |
| `theme` | `'light'` or `'dark'`, the dashboard's theme; a new one re-renders. The frame's root carries it as `data-theme` and `color-scheme`. |
| `setValidity(msg)` | A message blocks saving and shows under the field when the merchant saves; `null` clears it. |
| `fetch` | See "Calling the backend". |
| `on` | The admin sends no events. |
| `call(name, data)` | The admin offers no actions: it rejects with `Unknown host action "<name>"`. Hosts that mount with `actions` offer theirs, and payment components get `createIntent` and `getIntent` (`payment-extensions.md`). |

- Prop changes arrive as a **re-render with new props**; there is no change event. `setValue` re-renders with the new value at once and the host does not echo it back. The host sends a value only when it changes elsewhere (form reset, another edit) or to restore the previous one when it refuses yours.
- `setValue`, `setValidity`, `fetch`, `on` and `call` keep their identity across renders. Values must be structured-cloneable.
- `context.record` is the record **with unsaved edits** on a record page, the row in a collection-field row, and the modal's values in an app action modal (no record id there).
- `required` is checked by the admin ("Required" for an empty value). Use `setValidity` for values that are set but invalid. When a save stops at this field, the admin focuses the component's first control.
- A component that fails to start shows its error under the field; the rest of the form works. An error after it started shows as a warning and does not block saving.

## Using it in content

```json
{ "id": "brand_color", "type": "component", "component": "ColorPicker", "label": "Brand color", "params": { "palette": ["#111827", "#e11d48"] } }
```

- Works in app and standard models (value under `$app.<app_id>.<id>` on a standard record), in field groups, rows and collection fields at any depth, in `settings/*.json`, and in action `modal.fields`.
- **Stored type:** a field `models/` declares keeps that type, and the component must send it. Otherwise the field stores **text**: a non-null non-string value is refused, the old value stays, and saving shows `The component sent a list; this field stores text.` (or `an object`, `a number`, …). Send strings, or declare the type in `models/`.
- List columns show text and numbers; objects and arrays show nothing unless the column has a `template`.
- Push validates `component` (`^[\w-]+$`) and `params` (a plain object). Push uploads components before content and settings, and fails a content or settings file that names a component the app has not built: `Content field '<id>' uses component '<Name>', which the app does not have.` Fields in action `modal.fields` are not checked — a missing component there shows its error in the admin.

## Layout, focus and modals

- The frame is part of the form: its height follows the component's content (do not set a fixed one), its background is transparent, and the admin's popovers and sticky bars stack over it.
- The frame has no styles: set `font-family` and colors yourself, for both themes (`:root[data-theme="dark"]`).
- Tab and Shift+Tab move through the component's controls in form order. Use native focusable elements.
- **Modal:** render a `position: fixed` element covering the viewport **directly into `document.body`** (`createPortal` from `preact/compat`). While it exists the frame covers the whole admin, the rest of the page is inert and does not scroll, and focus moves to the modal's first control. Removing the element restores the field. A fixed element inside the component's own root covers only the field.

## Calling the backend

`props.fetch` adds the component token (`Swell-Component-Token`) to requests on the frame's own origin and to nothing else. Use relative URLs:

```ts
const res = await props.fetch(`/functions/<app_id>/list-labels`);
const preview = await props.fetch('/app-api/label-preview'); // the app's frontend
```

- Third-party URLs get no token. Calls that need secrets go through an app function.
- The token lasts 600 s and the host refreshes it; it is scoped to one installation and bound to the signed-in admin.
- Swell turns the token into a signed context with `surface: 'admin'` and the admin as `storeUser`.
- **Functions:** a **route** function of the same app accepts the call without `route.public` or a secret key (not hooks or cron, not other apps' functions). The context is `req.swellContext` — `{ appId, installationId, storeId, storeUser, surface }` — already verified by Swell, and `null` on calls without one. GET responses to component calls are not cached.
- **Frontend:** `/app-api` handlers get the context from the scaffold's helper; the check is in `references/frontend-dashboard.md`, "Authorize store users".
- **Check both `surface` and `storeUser`.** Swell signs a context for every request through the app origin, anonymous ones included, and `storeUser` without `surface` is an admin using the frontend with a cookie. `null` is never "allowed":

  ```ts
  if (!(req.swellContext?.surface === 'admin' && req.swellContext.storeUser)) {
    throw new SwellError('Admin component calls only', { status: 403 });
  }
  ```

- A component never writes records itself: `setValue` changes the form, and the merchant saves with their own session.

## Develop and deploy

- `swell app dev` serves component modules from the machine (`Component modules at: http://localhost:<port>/.swell/components/<Name>.js`) and rebuilds on change; reload the admin to see edits. Route functions a component calls still run the **pushed** version — push after changing them.
- `swell app push` builds each component as an ES module. Its change hash includes the files it imports, so a `components/lib/*` edit redeploys the importers without `--force`.
- The admin loads the build of the **installed version**; a development install uses the current unversioned build.
- `swell inspect components --app=.` (`@swell/cli` 2.9.33 or later) lists the built components with their targets and extension. Open the field to see one render.

## Other pages

Any page on a `*.swell.store` address can render an installed app's components with `createComponents({ storeId, publicKey })` from `@swell/apps-sdk/components`, then `mount(target, { app, component, value, params, context })`. The handle has `ready`, `on('change' | 'validity' | 'error')`, `update`, `emit`, `focus` and `unmount`. `actions` in the mount options are host functions a component reaches with `call(name, data)`. Frames refuse other parents (custom domains included), there is no shopper token (`props.fetch` calls are anonymous), and a moved mount element reloads the frame.

`mount(el, { target, select, context })` instead of `app` and `component` mounts a host **place** (`@swell/apps-sdk` 2.0.0-alpha.7 or later). The platform returns every component of the store's active apps that declares the target, and the host's `select(component)` picks which to mount: it gets each component's `name`, `app`, `targets` and `extension` (no settings) before any frame is created, and without it all are mounted. Hosted checkout keeps the component of the selected method's app and extension: `select: (c) => c.app === method.extension_app_id && c.extension?.id === method.id`. The handle adds `components` (`{ app, name }[]` of the mounted ones, known after `ready`), has no bound value, and `emit` resolves with an array, one result per component that handled the event. `select` is fixed at mount; a `select` that throws fails `ready`. Payment components also get built-in `createIntent` and `getIntent` actions served by the Swell vault (`vaultUrl` option of `createComponents`, default `https://vault.schema.io`); hosts cannot override them.

## Errors

| Message | Cause |
|---|---|
| `Component "<Name>" not found in app "<app>"` | No built component of that name in the installed version: not pushed, failed to compile, or the name differs. |
| `Component frame did not start` | The frame loaded but did not start within 10 s: the page is not on a `*.swell.store` address, or the app's address did not serve the frame. |
| `Component field '<label>' needs an app` | The field is not in an app's content file. |
| 401 or 404 from a function | The call did not use `props.fetch`, or the function has no `route`. |
