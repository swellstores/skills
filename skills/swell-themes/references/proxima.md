# Proxima and Liquid themes

Proxima is a storefront app by Swell, built with Astro and open source (github.com/swellstores/proxima-app). It runs Liquid themes in the structure of Shopify's Online Store 2.0 themes against the store's Swell catalog, so a store moving to Swell can keep the theme it has. Proxima is a storefront app like any other, with its own theme format. **For migrating a Shopify theme, Swell recommends Wave, not Proxima**: Wave imports the theme and rebuilds it as a Wave storefront (the dashboard's **Upload theme**, with **Rebuild it with Wave**), or it is rebuilt in code as a Wave theme (`wave-migration.md`). Use Proxima only when the user asks to keep a Liquid theme running unchanged.

What Proxima doesn't have:

- **No storefront extensions**: no app embed blocks, data sources, actions, app pages or product ratings. A Proxima theme can require an app, but can't use these from it. A feature that needs one is a reason to choose Wave.
- No `swell theme check`, no similarity check signals, and no demo frame for the Theme Store's View demo.

## Shopify compatibility

A compatibility layer in the Swell Apps SDK converts Swell records into Shopify's objects as a theme renders, and covers most Liquid objects, filters, tags and templates of Shopify themes, except Shopify Apps. It is in beta: most Online Store 2.0 features work, deprecated ones may not. Proxima picks the standard from the theme's files: a `config/settings_schema.json` means a Shopify theme, with the compatibility layer on; a `config/editor.json` means a Swell-native Liquid theme, without it. A Swell-native theme uses `components/` where Shopify uses `snippets/`. Liquid references: Shopify's Liquid docs for Shopify-standard themes, developers.swell.is "Swell Liquid" for Swell-native ones.

## Working on a theme

```sh
swell theme pull        # choose the environment and the storefront; downloads into a folder named after the theme id
swell theme dev         # watches files, re-uploads to that storefront, serves a preview on a local port
swell theme push        # uploads local files to the theme
```

- Run `swell theme pull` again from inside the folder: the CLI remembers the storefront.
- `swell theme dev --bundle` runs the `package.json` `bundle` script on each change; `--storefront-select` picks another storefront; `--local` connects to a locally running storefront app, for developing Proxima and a theme together (`swell app dev` in the Proxima folder, `swell theme dev --local` in the theme's).
- Changes merchants make in the theme editor can be overwritten during `swell theme dev`.
- Editing a storefront's theme instance changes that storefront. A new theme for other stores is a theme app, installed first and then used to create storefronts.

The `swell-app` skill doesn't cover these commands; this file and developers.swell.is "Proxima" and "Themes" do.
