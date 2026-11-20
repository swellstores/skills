# OAuth connections

Providers (TikTok, Google, Meta…) allow a fixed list of redirect URLs, but every store has its own domain. Swell gives each app **one callback URL** for every store and routes the provider's redirect to the app's callback function in the right store and environment. The developer's client secret stays in app secrets (`references/settings.md`); the merchant's token goes into the app's settings.

## 1. Register the callback URL with the provider

`swell app info` prints it as `OAuth callback`:

```
https://swell.store/integration/api/apps/<app record id>/oauth/callback
```

- The id is the app record's id (`.swellrc`), not the slug in `swell.json`. Each app record has its own URL: a copy of the app pushed from another store is another app with another URL.
- Register the URL of every platform you test on (a development environment has its own base URL). Providers usually allow several.

## 2. Keep the developer's credentials in app secrets

```bash
swell app secret set TIKTOK_APP_ID
swell app secret set TIKTOK_APP_SECRET
```

## 3. Declare where the token goes

A settings group of its own (the group's name is the file name), with fields the merchant sees but can't edit and the Connect button (step 4):

```json
// settings/connection.json
{
  "label": "TikTok connection",
  "fields": [
    { "id": "connect", "type": "component", "component": "Connect", "label": "Connection" },
    { "id": "access_token", "type": "secret", "label": "Access token", "readonly": true },
    { "id": "advertiser_ids", "type": "short_text", "label": "Advertiser accounts", "readonly": true },
    { "id": "connected_at", "type": "short_text", "label": "Connected at", "readonly": true },
    { "id": "last_error", "type": "short_text", "label": "Last connection error", "readonly": true }
  ]
}
```

`readonly` limits only the dashboard: the callback writes the field with `PUT /settings/<app_id>`, and a dashboard save never writes a read-only field back.

## 4. Start the flow from the dashboard

**The route that calls `start()` is never `public: true`.** The state isn't tied to who started the flow, so a shopper who can start it can authorize with their own provider account and link it to the store: the store's data then goes to the shopper's account. A route without `public` is reachable only from the app's own components, the app's own token and the store's secret key.

The Connect button lives in one of two places:

| Button in | Calls the route with | The route checks |
|---|---|---|
| An app component (`references/components.md`), such as the `connect` field in step 3. Works for every app, with or without a frontend | `props.fetch('/functions/<app_id>/tiktok-connect')` | `req.swellContext?.surface === 'admin' && req.swellContext.storeUser` |
| A page of the app's frontend | its endpoint: `requireStoreUser`, then `backend.functions.call(context.appId, 'tiktok-connect')` (`references/frontend.md`) | nothing more: the frontend checked the store user, and `functions.call` forwards nothing about the viewer, so `req.swellContext` is `null` there |

A function action in a settings file or a view can't start the flow: it can only answer `{ message }`, not send the merchant to the provider.

The route, for the component:

```ts
// functions/tiktok-connect.ts
export const config: SwellConfig = { route: { methods: ['post'] } };

export default async function (req: SwellRequest) {
  // Admins in the dashboard, through the app's own component
  if (!(req.swellContext?.surface === 'admin' && req.swellContext.storeUser)) {
    throw new SwellError('Admin component calls only', { status: 403 });
  }

  const appId = req.appSecrets.TIKTOK_APP_ID;
  if (!appId) {
    throw new SwellError('TIKTOK_APP_ID is not set: run swell app secret set TIKTOK_APP_ID', { status: 500 });
  }

  const { state, redirectUri } = await req.oauth.start({
    callback: 'tiktok-callback', // the route function that receives the redirect
    // data: { codeVerifier },   // optional, returned to the callback, never sent to the browser
  });

  const url = new URL('https://business-api.tiktok.com/portal/auth');
  url.searchParams.set('app_id', appId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  return { url: url.toString() };
}
```

A route the component reads the connection from, since a component sees only public settings:

```ts
// functions/connection-status.ts
export const config: SwellConfig = { route: { methods: ['get'] } };

export default async function (req: SwellRequest) {
  if (!(req.swellContext?.surface === 'admin' && req.swellContext.storeUser)) {
    throw new SwellError('Admin component calls only', { status: 403 });
  }

  const { connection } = await req.swell.settings();
  return {
    connected: Boolean(connection?.access_token),
    connected_at: connection?.connected_at ?? null,
    last_error: connection?.last_error ?? null,
    last_error_at: connection?.last_error_at ?? null,
  };
}
```

The component:

```tsx
// components/Connect.tsx
import type { ComponentProps } from '@swell/apps-sdk/components';
import { useEffect, useState } from 'preact/hooks';

type Status = {
  connected: boolean;
  connected_at: string | null;
  last_error: string | null;
};

export default function Connect(props: ComponentProps<string>) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [continueUrl, setContinueUrl] = useState('');

  // The merchant comes back to a freshly loaded page, so this reads the result
  useEffect(() => {
    void props
      .fetch('/functions/<app_id>/connection-status')
      .then((res) => (res.ok ? res.json() : null))
      .then(setStatus);
  }, []);

  async function connect() {
    setMessage('');
    const res = await props.fetch('/functions/<app_id>/tiktok-connect', { method: 'POST' });
    if (!res.ok) {
      setMessage('Could not start the connection');
      return;
    }
    const { url } = await res.json();
    setContinueUrl(url);
    // The whole dashboard tab goes to TikTok and comes back to the app's page
    window.open(url, '_top');
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: '14px' }}>
      <p>{status?.connected ? `Connected at ${status.connected_at}` : 'Not connected'}</p>
      {status?.last_error && <p>Last attempt failed: {status.last_error}</p>}
      <button type="button" onClick={() => void connect()}>
        {status?.connected ? 'Reconnect' : 'Connect TikTok'}
      </button>
      {continueUrl && (
        <p>
          <a href={continueUrl} target="_top">Continue to TikTok</a>
        </p>
      )}
      {message && <p>{message}</p>}
    </div>
  );
}
```

- The provider page can't run inside the dashboard or the component's frame, so the dashboard tab itself goes there (`_top`) and comes back to the app's settings (step 5). The component reads the result from the status route when the page loads again: there is no window to watch and nothing to poll.
- The component's frame is on another origin, so the browser lets it send the tab elsewhere only right after a click. When the route answers too late, the browser blocks it. The **Continue to TikTok** link then does it with a fresh click.
- The tab leaves the dashboard, so changes not yet saved elsewhere on the page are lost.
- `state` is an opaque random id. Swell keeps what it stands for: the store, environment, install, callback and `data`. It expires in 10 minutes and works once.
- `callback` must name a route function of the app that answers GET (no `route.methods`, or one that includes `get`). `start()` refuses any other with `oauth_callback_invalid`. The function must also handle GET in code: a default export, or a `get` export (`export function get` or `export default { get }`). `start()` can't see the exports, so a callback module with only a `post` export fails on every redirect, after the state is used.
- `data` is JSON up to 2 KB for values the callback needs and the browser must not see, such as a PKCE `code_verifier` (`oauth_data_too_large` over it).
- `start()` throws a `SwellError` when Swell refuses: `oauth_callback_invalid`, `oauth_data_too_large`, an install that is no longer installed or active (403), or `oauth_not_configured` (501) on a platform without the relay.

## 5. Handle the callback

```ts
// functions/tiktok-callback.ts
export const config: SwellConfig = { route: { methods: ['get'] } };

export default async function (req: SwellRequest): Promise<SwellOAuthCallbackResult> {
  const callback = req.oauth.callback;
  if (!callback) {
    throw new SwellError('Not an OAuth callback', { status: 400 });
  }

  // Back to the app's settings, where the Connect field reads the result (step 4)
  const back = (): SwellOAuthCallbackResult => {
    const url = new URL(req.app.admin_url);
    url.searchParams.set('tab', 'settings');
    return { redirect: url.href };
  };

  const fail = async (error: string) => {
    await req.swell.put(`/settings/${req.appId}`, {
      connection: { last_error: error, last_error_at: new Date().toISOString() },
    });
    return back();
  };

  if (callback.params.error || !callback.params.auth_code) {
    return fail(callback.params.error || 'no_code'); // the merchant cancelled
  }

  const { TIKTOK_APP_ID, TIKTOK_APP_SECRET } = req.appSecrets;
  if (!TIKTOK_APP_ID || !TIKTOK_APP_SECRET) {
    // The merchant sees last_error; the fix is the developer's, so it goes to the log
    const name = TIKTOK_APP_ID ? 'TIKTOK_APP_SECRET' : 'TIKTOK_APP_ID';
    console.error(`${name} is not set: run swell app secret set ${name}`);
    return fail('app_not_configured');
  }

  const res = await fetch(
    'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: TIKTOK_APP_ID,
        secret: TIKTOK_APP_SECRET,
        auth_code: callback.params.auth_code,
      }),
    },
  );
  // TikTok answers errors with a non-zero `code`, often with HTTP 200
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.code !== 0 || !body.data?.access_token) {
    console.error('TikTok token exchange failed', res.status, body?.code, body?.message);
    return fail('token_exchange_failed');
  }

  await req.swell.put(`/settings/${req.appId}`, {
    connection: {
      access_token: body.data.access_token,
      advertiser_ids: (body.data.advertiser_ids ?? []).join(', '),
      connected_at: new Date().toISOString(),
      last_error: null,
    },
  });

  return back();
}
```

- Swell checks the state (known, not expired, not used, this app's) and that the install is still installed before calling the function. `req.oauth.callback` is `{ params, data, name, redirectUri }` on that call only, and `null` on any other call through Swell: no caller of the app's routes can set it.
  - `params`: every parameter the provider sent, as raw strings, from the query string or from the form body when the provider posts the response (`response_mode=form_post`). Swell doesn't interpret them.
  - `data`: what was passed to `start()`.
  - `redirectUri`: the URL `start()` returned. Providers that check it again in the token request (Google, Meta and most OAuth 2.0 providers) need it as `redirect_uri` there. TikTok doesn't.
  - Trust `params` only once the provider has accepted the code exchange: a request sent straight to the function's worker, outside Swell, can carry any `Swell-OAuth` header, but it gets no `req.appSecrets`, so its exchange fails.
- The callback is always called with GET, whatever method the provider used, so it needs a default export or a `get` export. It can be non-public: Swell calls it internally, not through the storefront gateway. It always runs on Swell's workers, never on a `swell app dev` machine, so it has `req.appSecrets`.
- Return `{ redirect }` (`SwellOAuthCallbackResult`) to send the merchant's tab to the app's page in the dashboard (`req.app.admin_url`, or a path or query under it, such as `?tab=settings` above) or to the app's frontend in that store. Any other target is replaced by the app's dashboard page, which is also the default. A callback that throws or answers 400 or more shows the merchant a page with a link back to the app.
- The relay's page answers an expired or reused state with "connect again".
- **Debugging.** The callback's run is in the function logs like any other call: `swell logs --type function -s tiktok-callback` (add `--env live` for live). Log the provider's error code and message, as above, not `req.oauth.callback` or the provider's answer: they hold the code, your `data` and the token, and function logs are visible to the store's staff.

## 6. Use the token

In any function, or in a workflow through its `settings` operation:

```ts
const { connection } = await req.swell.settings();
if (!connection?.access_token) {
  return; // not connected yet
}
```

## Local development and tests

- `swell app dev` runs hooks and actions locally with an empty `req.appSecrets`. Settings, the token among them, read the same way locally, so a connected store works end to end. Connect once through the deployed flow (`swell app push`, then Connect): the callback runs on Swell either way.
- Unit tests pass a fake `req` with `appSecrets`, `oauth.start` and `oauth.callback` (`{ params, data, name, redirectUri }`).
- A `secret` settings field is still readable by store staff and by other apps with access to settings (`references/settings.md`).
