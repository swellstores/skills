# Client themes and the Theme Store

A Wave theme is built the same way for one client or for the Theme Store. What differs is where it lives and who reviews it.

## A theme for one client

A private theme app in the client's own store: nobody else sees it, and it isn't reviewed.

- Log in to the client's store (`swell login --store <store>`, or `swell switch <store>`) with a user who can manage apps and storefronts.
- Build and preview as usual, on a storefront in the client's store or in your development store. Push from `app/`; the first push creates a storefront for the theme in that store.
- The client, or you, publishes from the Wave editor. After that, the client edits content and settings in the editor and your own changes stay in code: the editor and your pushes both write the storefront's draft, and the last one saved wins.
- A theme built on a paid theme can be published only in a store that has bought that theme, so the client buys it first. A client theme can become a product later: make it generic, remove the client's brand and content, and sell it.
- A rebuild of a client's existing site is a client theme. Brand words and photos belong in its templates and settings, not in section defaults.

## Selling in the Theme Store

The Theme Store lists Wave themes, and opens to partner themes at its launch; until then only Swell's own themes are listed. Selling needs a Swell partner account with the theme app connected in the partner dashboard, and payouts set up through Stripe.

- **Substantially your own.** A theme you sell is mostly your own sections, blocks and layouts, not another theme with new colors and fonts. You may build on Swell's free themes (Tide, Marram, Mooring, Estuary, Spinnaker, all on GitHub under swellstores) and your own earlier themes and apps; not on another developer's theme or app, and not on any paid theme. Review compares a theme's code, settings, assets and rendered pages with the other themes for the same storefront app, leaving out files from Swell's free themes, `@swell/wave-theme-core` and your own apps. A theme that's too close is held for a reviewer; nothing is rejected automatically.
- **Free and paid.** A free theme fits any kind of store: `theme.listing.industries` is empty and it has no sections built for one category. Sections built for a category, such as a size guide, belong to paid themes. Set the price in the partner dashboard (the `swell-app` skill's `references/app-publishing.md`, "Price").
- **Checks.** It must pass `swell theme check` with its warnings fixed, and review checks the rules in `wave.md`, "Rules every theme follows".
- **Listing** (read from `swell.json`, `DESCRIPTION.md` and `assets/`): `description` (one line, at most 70 characters), `assets/icon.*`, `assets/image.*` (cover), `preview_src` and `preview_mobile_src` (desktop and phone screenshots from the demo store), `support_email`, `documentation_url`, and `theme.listing`:

```json
"theme": {
  "storefront": { "app": "wave" },
  "listing": {
    "industries": [],
    "styles": ["bold"],
    "features": ["filters", "quick_add", "mega_menu"],
    "catalog_sizes": ["some", "lots"],
    "best_for": "Stores with a large, changing range and frequent sales",
    "demo_url": "https://<store>--<storefront>--preview.swell.store/__demo"
  }
}
```

  Labelled ids: industries `fashion beauty jewelry home food_drink electronics outdoor single_product b2b wellness kids digital art flowers_gifts`; styles `minimal editorial bold warm utilitarian playful refined`; features `subscriptions mega_menu filters quick_add compare volume_pricing lookbook video journal sticky_buy comparison menu pickup locations drops size_guide quick_order trade_gate group_pricing shop_the_look swatches samples delivery_date gift_message age_gate clubs bundles bookings memberships gift_cards licences limited_editions ingredients routines`; catalog sizes `one few some lots`. Swell doesn't check the values, but an unlisted id gets no label or filter.
- **`DESCRIPTION.md`**: Markdown without HTML, about 3,500 characters or fewer: an opening paragraph on the stores it suits and its look, a paragraph per signature feature starting with a short bold phrase, how merchants change the look and edit pages, and a closing **Good to know** with what it needs (attributes, content pages, apps) and what it doesn't do yet.
- **Demo store**: a store of yours running the theme with a catalog made for it. `demo_url` is Wave's demo frame on the storefront's preview host; the frame opens only for a storefront in your own store and shows once the theme is published.
- **Versions**: create and release versions as for any app (`swell-app`, `references/app-publishing.md`). Merchants get a published version as a theme update they review in the editor; follow the renaming rules in `wave.md`, "Versions and updates".

## Licensing

`@swell/wave-theme-core`, Tide and Swell's other free themes are under the Swell App License: you may use, copy, change and sell apps and themes built on them, for Swell stores only. A theme offered to more than one store goes through the Swell App Store; it has its own name, and source copies keep the license notice. Paid themes, Swell's included, are licensed to each store that buys them: that store may change the theme for itself but not copy it to another store, or transfer, sell or share it.
