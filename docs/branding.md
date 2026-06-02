# NOS branding

The widget UI, the test app, and the icons follow the NOS visual identity (palette sampled from
nos.pt's CSS and the provided brand logos).

## Palette (from nos.pt)

| Token | Hex | Use |
|---|---|---|
| NOS dark | `#1E1F27` | widget background, app background |
| NOS dark 2 | `#2A2A33` | secondary surfaces / cards |
| NOS green | `#BAD80A` | accent (refresh action, primary buttons, headings) |
| White | `#FFFFFF` | primary text on dark |
| Muted grey | `#94959D` | secondary text |

## Brand assets (`/brand`)

| File | What |
|---|---|
| `nos-widgets-logo.png` | full "NOS WIDGETS" lockup |
| `nos-widgets-icon.png` | app icon (1254²) — source for all icon sizes |
| `app-icon-1024.png` | iOS marketing icon |
| `app-icon-foreground-432.png` | Android adaptive-icon foreground |

## Branded widget (both platforms)

Dark card, white balance, green refresh — identical on Android (Glance) and iOS (WidgetKit):

| Android | iOS |
|---|---|
| ![android](img/android-widget-branded.png) | ![ios](img/ios-widget-branded.png) |

## App icon (test app)

The Cordova default icon is replaced via `config.xml`:

```xml
<platform name="android">
  <!-- adaptive icon: foreground tiles on a solid NOS-dark background (one entry per density) -->
  <icon density="xxxhdpi" foreground="res/android/icon-foreground.png"
        background="res/android/icon-background.png" />
  <!-- ...mdpi/hdpi/xhdpi/xxhdpi... -->
</platform>
<platform name="ios">
  <icon src="res/ios/icon-1024.png" />
</platform>
```

Notes learned applying it:
- Android adaptive `<icon>` needs a **`density`** attribute (else cordova-android throws
  `Cannot read properties of undefined (reading 'startsWith')`).
- `background` must be an **image** (a solid `#1E1F27` PNG), not a hex string — cordova-android
  references `@mipmap/ic_launcher_background`, so a hex value fails AAPT resource linking.
- iOS accepts a single 1024² icon (`<icon src>`); cordova-ios 8 generates the asset catalog.
