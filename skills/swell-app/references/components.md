# Components

An app component is a Preact UI that renders a **content field** in the admin in place of a built-in input. It runs in a cross-origin iframe on the app installation's origin (`https://<store>--<installation>--app.swell.store`): no access to the admin DOM, storage or session. Swell serves the frame page and its runtime from `/.swell/components/` and `/.swell/sdk/` on that origin (reserved: an app frontend cannot use these paths); the app ships only the component.

A component with `config.extension` is a checkout payment component instead: a different mechanism, not an iframe — `references/payment-extensions.md`. Never put `config.extension` on a field component.

## Files and names

- Every `.tsx` / `.jsx` file **directly in `components/`** is one component. Anything else under `components/` (`components/lib/*`, `components/tsconfig.json`) is shared code, bundled into the components that import it.
- The name is the file name with `_` → `-`: `ColorPicker.tsx` → `ColorPicker`, `color_picker.tsx` → `color-picker`. Use only `[A-Za-z0-9_-]`: other names push but can never be referenced or loaded.
- A **default export is required**; without it the build fails (`Unable to compile component <name> …`).
- `export const config = { description }` is optional and must be a static object literal; the CLI reads it without running the code.
- Scaffold: `swell create component <Name> [-d <description>] -y`. It writes the file, adds `preact` and `@swell/apps-sdk` (dev, types only) to `package.json`, writes `components/tsconfig.json`, adds `components` to the root `tsconfig.json` `exclude`, and extends the `typecheck` script. Run `npm install` after.

## Build limits

- JSX always compiles with Preact's automatic runtime. `react` and `react-dom` resolve to `preact/compat`, so React libraries bundle; React 19-only APIs (`use`, Actions, `useOptimistic`) do not exist.
- **No CSS or other non-JS imports** — the build fails. Use inline styles or a `<style>` element.
- `@swell/apps-sdk` is types only (`import type { ComponentProps } from '@swell/apps-sdk/components'`): a 2.x release with the `./components` entry.
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
  setValidity(error: string | null): void;
  readonly fetch: typeof fetch;
  on(event: string, handler: (data: unknown) => unknown): () => void;
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
| `setValidity(msg)` | A message blocks saving and shows under the field when the merchant saves; `null` clears it. |
| `fetch` | See "Calling the backend". |
| `on` | The admin sends no events. |

- Prop changes arrive as a **re-render with new props**; there is no change event. `setValue` re-renders with the new value at once and the host does not echo it back. The host sends a value only when it changes elsewhere (form reset, another edit) or to restore the previous one when it refuses yours.
- `setValue`, `setValidity`, `fetch` and `on` keep their identity across renders. Values must be structured-cloneable.
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
- The frame has no styles: set `font-family` and colors yourself.
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
- `swell inspect` has no component topic: confirm from the push output and by opening the field.

## Other pages

Any page on a `*.swell.store` address can render an installed app's components with `createComponents({ storeId, publicKey })` from `@swell/apps-sdk/components`, then `mount(target, { app, component, value, params, context })`. The handle has `ready`, `on('change' | 'validity' | 'error')`, `update`, `emit`, `focus` and `unmount`. Frames refuse other parents (custom domains included), there is no shopper token (`props.fetch` calls are anonymous), and a moved mount element reloads the frame.

## Errors

| Message | Cause |
|---|---|
| `Component "<Name>" not found in app "<app>"` | No built component of that name in the installed version: not pushed, failed to compile, or the name differs (`_` → `-`). |
| `Component frame did not start` | The frame loaded but did not start within 10 s: the page is not on a `*.swell.store` address, or the app's address did not serve the frame. |
| `Component field '<label>' needs an app` | The field is not in an app's content file. |
| 401 or 404 from a function | The call did not use `props.fetch`, or the function has no `route`. |
