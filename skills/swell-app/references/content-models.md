# Content Models

Content models configure Admin Dashboard views in `./content/*.json`. They control how merchants interact with data: list columns, form layouts, navigation, and input behavior. As established in Section I, content models map to data model Resource IDs and define UI logic only; data logic belongs in `./models/*.json`. Content field ID must correspond to a data model field, except `type: "action"` fields, which are buttons and store nothing (see `references/actions.md`).

**Decision Guide:**

- [ ] **Augmenting standard models** applies when adding UI for fields on existing platform entities. For standard model extensions, `admin_zone` places fields within existing editor sections (e.g., `"admin_zone": "details"` on products); invalid zone values cause fields to silently disappear, so verify against `swell schema content --format=dts`. Alternatively, declare `tabs` in the edit view to add custom tab panels alongside native tabs. Extensions merge with existing UI rather than replacing it: `edit.tabs` adds alongside native tabs, `list.fields` appends to existing columns, and `list.tabs` introduces additional filtered views. Tab and view `query.where` may mix your app's extension fields (bare keys, auto-namespaced to `$app.<app_id>.*` by model metadata) with native model fields, recursing into `$and`/`$or`/`$nor`. Merchants can reorder or hide these additions in their dashboard preferences.

- [ ] **Creating app model views** applies to app-defined collections. Declare `nav` on the list view to give the collection a sidebar entry — **a list view with no `nav` object gets no sidebar entry at all**. Within `nav`, `parent` nests it under an existing section, but only a section that already has sub-items can host a child: `orders`, `products`, `discounts`, `content`, `reporting`. `subscriptions` and `customers` are flat top-level entries with no sub-items — naming either (or any unrecognized id) as `parent` **drops the collection from the sidebar entirely**, with no fallback to top level and no error anywhere. Omit `parent` and set `icon` for a top-level entry. You cannot create a new nav section. For app-defined collections, control layout entirely through views—`admin_zone` has no effect.

Content models declare views by id. The standard ids map to platform routes: `list` (table columns, sort, filters, navigation), `edit` (form for existing records), and `new` (creation form); a single `record` view replaces `edit` + `new` when their layouts are identical. Additional views with any custom id are allowed and surface in a view-selector dropdown. Each view's `type` is `list` or `record`, defaulting to `list` only when the id is `list`.

Fields declared in views inherit properties from matching top-level field definitions by `id`. A view field `{ "id": "rating" }` acquires label, type, and constraints from the top-level `"rating"` entry. Override selectively per view—for instance, a shorter label in list columns versus the full label in edit forms.

Layout uses `field_row` for horizontal arrangement and `field_group` for collapsible sections—both require a `fields` array (omitting it fails validation). Width is controlled via `admin_span` (1–4 on a 4-column grid). Conditions control field visibility using MongoDB-style operators: equality (`"status": "approved"`), negation (`"rewarded": { "$ne": true }`), comparison (`"count": { "$gt": 0 }`), and app settings references (`"$settings.feature.enabled": true`). Multiple conditions are AND-ed.

A field's `readonly` accepts a boolean or a condition expression with the same operators and scopes as `conditions` (record fields, `$settings.*`, other apps' `$app.<app_id>.<field>`) — the field becomes non-editable while the expression matches. This gates dashboard editing only; direct API writes still succeed, so enforce integrity in model rules or app functions. Views declare buttons in `actions` (view header) and `extra_actions` (the view's Actions menu); list views add `bulk_actions` (bulk bar, which also makes the list selectable). An item is a built-in id (`new`, `save`, `delete`), a link action (`link`, with `{field}` placeholders and `frontend://` targets — see `references/frontend.md`), or a function action (`function`) that runs an app function or workflow — the full contract is in `references/actions.md`. An action object needs `function`, `link`, or an `id` naming a view that defines `nav.link`. When every item in `actions`/`extra_actions` runs a `function`, the items are added after the view's defaults; any built-in id or link item makes the array **replace** the defaults instead (`new` in a list header, `save` in a record header, `delete` in the record's Actions menu), so re-declare the defaults you still want. Each action renders only when not `hidden` and its `conditions` match the current record (record fields only — no `$settings`; on standard collections a bare key names the app's own `$app.<app_id>` field, and a native field needs a `$` prefix, e.g. `{ "$active": true }`); `conditions` are ignored on bulk actions and on function actions in list views, and they control visibility only, never who may run the action. The schema also accepts a `record_actions` property, but no dashboard code reads it — actions placed there silently never render.

A dashboard button that writes data is a **function action**: `{ "id": "approve", "label": "Approve", "function": "approve-review" }` runs `functions/approve-review.ts` (config `action: true`) for the admin user who clicked it, and the page reloads after it succeeds. Bulk updates use `bulk_actions`, which receive the selection as a query; work that outlasts a function timeout names a workflow instead. This works on app collections and on standard pages such as Products and Orders, where function actions from the app's record views join the record page's Actions menu, and those from the app's view with id `list` join the list's Actions menu and bulk bar. For simple status transitions, an editable `select` or `toggle` field on the record view plus `list.tabs` with `query.where` for Pending/Approved queues remains the zero-code option.

The `collection` content type creates inline references to other collections without duplicating data. Declare with `"type": "collection"`, target via `"collection": "products"` (or `"products:variants"` for child collections), and define the join with `"link": { "params": { "account_id": "id" } }`. This renders as a filterable list widget in the edit view.

For field types, input widgets, and all property options, consult `swell schema content --format=dts`.

```json
{
  "collection": "products",
  "fields": [
    {
      "id": "seller",
      "type": "lookup",
      "label": "Seller",
      "model": "apps/my_app/sellers",
      "key": "seller_id"
    }
  ],
  "views": [
    {
      "id": "edit",
      "tabs": [
        {
          "id": "seller_info",
          "label": "Seller Info",
          "fields": [
            { "id": "seller" }
          ]
        }
      ]
    }
  ]
}
```
Note that lookup type can be set to the fields, declared with `"type": "link"` at the data model.
