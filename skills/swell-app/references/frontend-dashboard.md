# Dashboard frontend

Custom pages for store users, shown inside the Swell dashboard: the `frontend/` of an `admin` or `integration` app. Read `references/frontend.md` first — the scaffold, the connection to Swell, `/app-api` endpoints, local development and deployment are the same for every frontend. This reference covers what is specific to the dashboard.

## Choose the smallest thing that works

A frontend is the most expensive way to put something in the dashboard. Go down this list and stop at the first row that covers the need:

| Need | Use |
| --- | --- |
| List, filter, create and edit records | Content-model views — `references/content-models.md` |
| A button that does something: on a record, on selected records, in a field, or in the app's settings; optionally asking a few inputs in a dialog first | An action that runs a function, or a workflow when the work outlives a function timeout — `references/actions.md` |
| Anything else: multi-step flows, charts and summaries across records, a custom layout, an embedded third-party widget | A frontend |

They combine. A typical app keeps its records in content-model views, runs its one-click operations as actions, and opens a frontend page for the one screen neither can express.

**Swell authenticates action callers.** An action uses the store-user invocation path described in `references/actions.md`, including its role checks and equivalent CLI request. A frontend endpoint is a public address whose code must authorize the viewer (see "Authorize store users"). When an operation needs no custom UI, make it an action.

**Template.** Use `swell-vinext` unless there is a reason not to: pages render on the server, so a page can check the store user and read Backend data in one place. `swell-react` fits a dashboard that is a browser app from end to end — every read and write then goes through a `/app-api` handler in its Worker, and the app adds its own client-side router.

## How the dashboard shows the app

The dashboard renders the frontend in a frame at `/app/<app_id>/<path>` and signs the store user in to it. The app implements nothing for this: it sees the result as `context.storeUser`.

- **The dashboard shows the deployed build** of the app version installed in the environment the dashboard is switched to. `swell app push` deploys to the test environment, so look there; a `swell app dev` session never appears in the dashboard.
- **The frame is not the access control.** The same build answers at its own public address, `https://<storeId>--<installedAppId>--app.swell.store`, where anyone can open it as a visitor. Every page and endpoint decides from `context.storeUser`, never from "we are inside the dashboard".
- **Give visitors a state.** A dashboard-only page still renders for a visitor. Show a short "Open this app from the Swell dashboard" message and read no Backend data for it.
- **The path is the only thing the dashboard passes in.** `/app/<app_id>/shipments/42` loads `/shipments/42` in the frame; a query string on the dashboard address is dropped. The dashboard's address does not follow navigation inside the frame, so reloading the dashboard returns to the page the link opened. Put what a page needs in the path of the link that opens it.
- **Open links that leave the app in a new tab.** Inside the frame a plain link replaces the app, not the dashboard page. Use `target="_blank"` for external pages and for raw endpoint links, as the scaffold's home page does.

## Entry points

Nothing links to the frontend automatically. The app declares each way in, as a link that starts with `frontend://` followed by a path in the frontend:

| Where the merchant clicks | Declared in |
| --- | --- |
| Sidebar entry | `nav.link` on a list view of a content model |
| A row in the collection's list | `nav.link` on the `edit` view — the row then opens the frontend page instead of the record page |
| Button in a list or record header | the view's `actions[]` |
| Item in a list or record Actions menu | the view's `extra_actions[]` |
| Item in the Actions menu of the app's own page | `actions[]` in a settings file |

```json
{
  "views": [
    {
      "id": "list",
      "nav": { "label": "Shipments", "icon": "orders" }
    },
    {
      "id": "overview",
      "type": "list",
      "nav": { "label": "Shipping overview", "icon": "reporting", "link": "frontend://overview" }
    },
    {
      "id": "edit",
      "actions": [
        "save",
        { "id": "open-app", "label": "Open in app", "link": "frontend://shipments/{id}" }
      ]
    }
  ]
}
```

- **A sidebar entry needs a content model.** It comes from a list-type view with a `nav` object, in a content file for a collection that exists. Give the frontend page a view of its own, as `overview` above: each list-type view with `nav` gets its own sidebar entry, while `nav.link` on the collection's `list` view would point that entry at the frontend and leave the native list without one. `nav.parent` and `nav.icon` follow the rules in `references/content-models.md`. An app with no collection to hang it on is reached from its own page under Apps, through a settings action.
- **Placeholders.** `{id}` and other `{field}` placeholders expand from the current record in row links and in record view actions. Sidebar, list header and settings links have no record, so they take a fixed path.
- **Leave `target` unset.** The link then opens inside the dashboard with the store user signed in. `"target": "blank"` opens the frontend's own address in a new tab; only a view action signs the store user in on the way, so from a sidebar or settings link the page can open in its visitor state.
- **A link action replaces the view's default actions.** Record views default to `actions: ["save"]` with `extra_actions: ["delete"]`; list views default to `actions: ["new"]`. Declaring only `open-app` on an edit view ships a record the merchant can open in the app but can no longer save — re-declare every default that should stay. (An array holding only function actions is added to the defaults instead.)
- **An action has either `link` or `function`, never both.** Bulk actions and action fields run functions only; they cannot open a frontend page.

## Authorize store users

`context.storeUser` is `{ userId, storeId }` for someone signed in to the store's dashboard and `null` for everyone else. That is all Swell says about the viewer.

- **Pages.** Read `context.storeUser` before anything else and render the visitor state when it is `null`. In Vinext: `(await getSwellContext())?.storeUser`, as in the scaffold's `components/store-user-card.tsx`. In React the browser cannot tell who is viewing — ask the Worker, as the scaffold's `src/components/store-user-card.tsx` does.
- **Endpoints and server actions.** Start with `requireStoreUser`. It returns the store user or throws a `SwellError` with status 401 and code `store_user_required`. The scaffold's `POST /app-api/hello` shows where it goes: check the store user, then validate input, then apply the app's own permissions, then do the work.
- **The Backend client is the app, not the store user.** It carries the app's access token and the scopes in `swell.json`, and it returns the same data whoever asks. A page or handler that reads Backend data without the store-user check publishes that data on the frontend's public address.
- **Any dashboard user counts** — including partners and Swell support, who may not appear in the store's own user list. Roles are not applied: which store user may do what is the app's decision.
- **Looking up the viewer.** To learn more than the id, read `/:users/<userId>` with the Backend client, as the scaffold's store user card does. Once `permissions` in `swell.json` is non-empty that read needs the `read_:users` scope, colon included; without it the read answers 403, which the card handles.
- **Writes go in POST/PUT/DELETE handlers or server actions.** Swell withholds the store user on a request from another origin unless it is a `GET`, `HEAD` or `OPTIONS`. That is what stops another site from triggering a store-user-only write, and it does not protect a `GET` that changes data.
- **Ids in the address are input.** A `frontend://shipments/{id}` link delivers an id anyone can type. Validate it and load the record on the server before acting on it.

## Preview and verify

```bash
swell app dev --store-user   # from the app root: preview as the store user logged in to the CLI
swell app dev                # preview as a visitor
```

`--store-user` is the dashboard preview: requests are signed as the store user logged in to the CLI. Anyone who has the preview address gets the same access while the session runs, so do not share it.

Check both viewers before calling a dashboard page done:

1. `swell app dev`: store-user-only pages show their visitor state and store-user-only endpoints answer 401. That is the expected result, not a bug.
2. `swell app dev --store-user`: the same pages and endpoints work.
3. `swell app push`, then open the app from the dashboard through each entry point declared above: the link lands on the intended page with the record id filled in, and the store-user checks pass against the deployed build.
4. Open the deployed frontend's own address in a private browser window: visitor state, and 401 from the endpoints. Use a private window because a browser that opened the app from the dashboard stays signed in at that address for hours.

Test a store-user-only write from the page itself. A bare `curl -X POST` sends no `Origin` header, so Swell treats it as a request from another origin and withholds the store user: the endpoint answers 401 even under `--store-user`. To script it, add `-H "Origin: https://<the preview host>"`.
