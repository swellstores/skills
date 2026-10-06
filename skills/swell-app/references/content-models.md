# Content Models

Content models configure Admin Dashboard views in `./content/*.json`. They control how merchants interact with data: list columns, form layouts, navigation, and input behavior. Content models map to data model Resource IDs and define UI logic only; data logic belongs in `./models/*.json` (`references/data-models.md`). Content field ID must correspond to a data model field.

**Decision Guide:**

- [ ] **Augmenting standard models** applies when adding UI for fields on existing platform entities. For standard model extensions, `admin_zone` places fields within existing editor sections (e.g., `"admin_zone": "details"` on products); invalid zone values cause fields to silently disappear, so verify against `swell schema content --format=dts`. Alternatively, declare `tabs` in the edit view to add custom tab panels alongside native tabs. Extensions merge with existing UI rather than replacing it: `edit.tabs` adds alongside native tabs, `list.fields` appends to existing columns, and `list.tabs` introduces additional filtered views. Tab and view `query.where` may mix your app's extension fields (bare keys, auto-namespaced to `$app.<app_id>.*` by model metadata) with native model fields, recursing into `$and`/`$or`/`$nor`. Merchants can reorder or hide these additions in their dashboard preferences.

- [ ] **Creating app model views** applies to app-defined collections. Declare `nav` on the list view to give the collection a sidebar entry — **a list view with no `nav` object gets no sidebar entry at all**. Within `nav`, `parent` nests it under an existing section, but only a section that already has sub-items can host a child: `orders`, `products`, `discounts`, `content`, `reporting`. `subscriptions` and `customers` are flat top-level entries with no sub-items — naming either (or any unrecognized id) as `parent` **drops the collection from the sidebar entirely**, with no fallback to top level and no error anywhere. Omit `parent` and set `icon` for a top-level entry. You cannot create a new nav section. For app-defined collections, control layout entirely through views—`admin_zone` has no effect.

Content models declare views by id. The standard ids map to platform routes: `list` (table columns, sort, filters, navigation), `edit` (form for existing records), and `new` (creation form); a single `record` view replaces `edit` + `new` when their layouts are identical. Additional views with any custom id are allowed and surface in a view-selector dropdown. Each view's `type` is `list` or `record`, defaulting to `list` only when the id is `list`.

Fields declared in views inherit properties from matching top-level field definitions by `id`. A view field `{ "id": "rating" }` acquires label, type, and constraints from the top-level `"rating"` entry. Override selectively per view—for instance, a shorter label in list columns versus the full label in edit forms.

Layout uses `field_row` for horizontal arrangement and `field_group` for collapsible sections—both require a `fields` array (omitting it fails validation). Width is controlled via `admin_span` (1–4 on a 4-column grid). Conditions control field visibility using MongoDB-style operators: equality (`"status": "approved"`), negation (`"rewarded": { "$ne": true }`), comparison (`"count": { "$gt": 0 }`), and app settings references (`"$settings.feature.enabled": true`). Multiple conditions are AND-ed.

A field's `readonly` accepts a boolean or a condition expression with the same operators and scopes as `conditions` (record fields, `$settings.*`, other apps' `$app.<app_id>.<field>`) — the field becomes non-editable while the expression matches. This gates dashboard editing only; direct API writes still succeed, so enforce integrity in model rules or app functions. Actions live in a view's `actions` array (header buttons) and `extra_actions` (the Actions menu); list views also take `bulk_actions`, and a field with `"type": "action"` is a button among the fields. An action either opens a `link` or runs an app `function`. Each renders only when not `hidden` and its `conditions` match the current record (record fields only — no `$settings`); in list views `conditions` are ignored on function and bulk actions. The schema also accepts a `record_actions` property, but no dashboard code reads it — actions placed there silently never render.

**Link actions.** Three built-in ids carry behavior of their own: `new` (links to `<collection>/new`), `save` (submits the form), `delete` (deletes the record). Any other id needs a `link` — it interpolates `{field}` placeholders from the record and accepts `frontend://path/{id}` to target an app frontend (see `references/frontend-dashboard.md`) — and without one renders as a button that goes nowhere. An `actions` or `extra_actions` array that holds a link action or a built-in id **replaces** the view's defaults rather than appending to them, so re-declare any native action you still want.

**Function actions.** An action with `function` runs an app function or workflow when clicked, optionally after a dialog that confirms or asks for inputs. This is how a dashboard button changes data: approve a record, resend an email, process the selected rows. Function actions are added to the view's defaults instead of replacing them, work on standard collections too, and can also be declared in settings files. Read `references/actions.md` before declaring one.

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
