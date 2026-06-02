# OutSystems wrapper module

The plugin exposes a JavaScript API (`cordova.plugins.nosWidgets.*`). To consume it from an
OutSystems 11 mobile app, build a thin **wrapper module** (in Service Studio) that surfaces each
call as a **Client Action** via a JavaScript node. This file documents the mapping; the module
itself is built in Service Studio, not stored in this repo.

## Prerequisites

1. The mobile module references this plugin through its **Extensibility Configuration**
   (see [`extensibility-configuration.json`](extensibility-configuration.json)).
2. Generate the app with **MABS 12**.

## Client Actions → JS API

| Client Action | Inputs | JS call |
|---|---|---|
| `Widget_Configure` | `AppGroup` (Text), `Scheme` (Text), `ApiBaseUrl` (Text) | `nosWidgets.configure({...})` |
| `Widget_WriteData` | `Token` (Text), `PayloadJson` (Text) | `nosWidgets.writeData({ token, payload })` |
| `Widget_RefreshNow` | — | `nosWidgets.refreshNow()` |
| `Widget_IsAdded` | out: `IsAdded` (Boolean) | `nosWidgets.isWidgetAdded(...)` |
| `Widget_OnAction` | out: event stream | `nosWidgets.onWidgetAction(cb)` |

## Example JavaScript node (Widget_WriteData)

```js
// Inputs: $parameters.Token, $parameters.PayloadJson
try {
    var payload = JSON.parse($parameters.PayloadJson || '{}');
    cordova.plugins.nosWidgets.writeData(
        { token: $parameters.Token, payload: payload },
        function () { $resolve(); },
        function (e) { $reject(e); }
    );
} catch (e) {
    $reject(e);
}
```

## Notes

- `Widget_OnAction` keeps its callback alive — model it as an event the app subscribes to once
  (e.g. on the bootstrap screen) and routes to the appropriate destination.
- Pass structured data as a JSON **Text** (`PayloadJson`) to keep the OutSystems interface simple;
  the native side parses it.
- Guard every call with a Platform check so the Client Actions are no-ops on the web/PWA channel.
