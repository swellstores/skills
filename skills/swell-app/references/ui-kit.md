# Swell UI kit

Swell UI (`@swell/swell-ui`) is the set of web components Swell's hosted checkout is built from: `<swell-button>`, `<swell-input>`, `<swell-select>`, `<swell-radio>`, `<swell-status>` and the rest. Each host sets their look through design tokens, so UI built from them matches the page around it and follows its theme. Build the UI of an app's components and frontend from the kit's elements, and style only the markup the kit has no element for.

Requires `@swell/cli` 2.9.36 and `@swell/apps-sdk` 2.1.0, or later, for the kit in components. The references below are in `@swell/swell-ui` 0.1.2.

## Where the kit is described

In `node_modules/@swell/swell-ui/`:

| What | Where |
| --- | --- |
| Loading, frameworks, icons, browser support | `README.md` |
| An element's attributes, properties, events, slots, CSS parts and states | its entry in `custom-elements.json`, or the JSDoc of its class in `dist/types/components/<module>/<name>/<name>.d.ts` |
| `configure()`, themes, areas of a page, variants, settings | `TOKENS.md` |
| Every configuration key | the type `Config`, exported from `@swell/swell-ui` |
| Every token's default and meaning | `tokens/*.json` and each component's `tokens.json` |

Markup of your own reads the kit's global CSS variables, such as `--swell-color-accent` and `--swell-border-radius`, which carry the host's values and follow its theme.

## In a component

Set `ui: true` in the component's `config`. The platform loads the kit into the frame, configured like the host, before the first render, and applies the host's later changes.

```tsx
import type { ComponentProps } from "@swell/apps-sdk/components";

export const config = {
  description: "Gift message for the order",
  ui: true,
};

export default function GiftMessage({ value, setValue, readonly }: ComponentProps<string | null>) {
  return (
    <swell-textarea
      label="Gift message"
      value={value ?? ""}
      readonly={readonly}
      oninput={(event) => setValue(event.target.value || null)}
    />
  );
}
```

- **The platform supplies the kit's code.** Use the elements by their tags. The build leaves every value import of `@swell/swell-ui` out of the bundle and warns: `"@swell/swell-ui" is left out of the bundle: set config.ui = true in the component and the platform loads the Swell UI kit; import the kit only as types`. So the kit's functions and its React wrappers are unavailable in a component.
- `ui` is `true` or `false`; push refuses any other value with `ui must be true or false`.
- **Types:** `npm install -D @swell/swell-ui`, then add `"@swell/swell-ui/preact"` to `types` in `components/tsconfig.json` (the scaffold writes `types: []`). Event props are lowercase, as these types name them: `oninput`, `onchange`, `ontoggle`, `onremove`. `event.target` is the element.
- **The look is the host's.** Hosted checkout passes its kit configuration, so a payment component draws the checkout's colors, font and radius. The dashboard passes none, so a field component draws the kit's default look. `props.ui.config` holds what the host passed. The kit follows the host's theme in both, so a component needs no theme CSS and no `configure()` of its own.
- Without `ui: true` the frame has no kit and no styles: `components.md`, "Layout, focus and modals".

## In a frontend

- **Install it from npm:** `npm install @swell/swell-ui`. In React, use the typed wrappers from `@swell/swell-ui/react` (README → Frameworks).
- **The kit runs in the browser only:** importing it on the server throws. `swell-vinext` renders pages on the server, so load a component built from the kit with `dynamic(() => import("./GiftForm"), { ssr: false })` from `next/dynamic`, inside a `"use client"` component. `swell-react` renders in the browser and imports the kit directly.
- **The frontend sets its own look.** No host passes a configuration to a frontend: the kit draws its default look until the frontend calls `configure()` with its values, such as a storefront's brand colors (`TOKENS.md` → Configuration).
