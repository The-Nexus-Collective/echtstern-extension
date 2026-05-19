# ECHTSTERN Chrome Extension

ECHTSTERN ist eine Chrome-Erweiterung für Google Maps. Sie hilft dabei,
Google-Maps-Bewertungen einzuordnen, wenn Google Hinweise auf entfernte
Bewertungen wegen Diffamierungsbeschwerden anzeigt.

Die Erweiterung läuft im Rezensionen-Tab von Google Maps, liest dort öffentlich
sichtbare Bewertungsinformationen aus und zeigt eine zusätzliche ECHTSTERN-
Einordnung. Diese Einordnung ist eine nachvollziehbare Berechnung, keine Aussage
darüber, ob eine einzelne Bewertung rechtmäßig, unrechtmäßig oder tatsächlich
diffamierend war.

## Was die Erweiterung macht

- Erkennt den aktiven Rezensionen-Tab in Google Maps.
- Liest sichtbare Bewertung, Bewertungsanzahl, Sterneverteilung und Hinweise auf
  entfernte Bewertungen aus.
- Berechnet eine ECHTSTERN-Schätzung auf Basis konfigurierbarer Annahmen.
- Zeigt einen kleinen Statusindikator neben der Google-Bewertung.
- Kann entweder eine kompakte Inline-Einordnung in Google Maps anzeigen oder
  einen Button, der das Popup öffnet.
- Zeigt bei Profilen ohne entfernte Bewertungen einen Prüfhinweis statt einer
  Schätzung.
- Ermöglicht Einstellungen für Sternegewichtung, angenommene echte
  Diffamierungsquote, Warnungsgrenzen, Sprache, Anzeigeart und anonyme
  Beobachtungsdaten.
- Kann das Ergebnis aus dem Popup als PNG exportieren.

## Datenschutz

Standardmäßig sendet die Erweiterung anonyme, ortsbezogene Beobachtungsdaten an
`https://echtstern.de/api/observations`. Das hilft dabei, öffentlich
sichtbare Bewertungsänderungen über Zeit aggregiert zu analysieren. Der
Tracking-Code liegt offen in diesem Repository, damit er geprüft, geändert oder
entfernt werden kann.

Die Erweiterung sendet:

- Google-Maps-Ortsschlüssel und Ortsname.
- Die Google-Maps-URL des betrachteten Ortes.
- Server-Zeitpunkt der Beobachtung.
- Sichtbare Google-Bewertung und sichtbare Bewertungsanzahl.
- Sichtbare 1/2/3/4/5-Sterneverteilung, wenn erkannt.
- Googles sichtbare Spanne entfernter Bewertungen, wenn vorhanden.
- Latitude und Longitude aus der aktuellen Google-Maps-URL, wenn verfügbar,
  damit der Server Stadt/Region/Land ableiten kann.
- Spracheinstellung.
- Eine zufällig erzeugte anonyme Installations-ID, lokal gespeichert, zur
  Deduplizierung von Beobachtungen.

Die Erweiterung sendet nicht:

- Google-Kontodaten.
- Rezensionstexte.
- Von Nutzerinnen oder Nutzern eingegebene Inhalte.
- Browserverlauf außerhalb der aktuellen Google-Maps-Ortsseite.
- Zahlungs-, Gesundheits- oder Authentifizierungsdaten.
- Sonstige personenbezogene Daten

Die anonyme Beobachtungsfreigabe kann im Popup unter `Einstellungen` →
`Anonyme Beobachtungsdaten` deaktiviert werden.

Für einen lokalen Build, bei dem Tracking standardmäßig deaktiviert ist, ändere:

```ts
// src/shared/tracking.ts
export const TRACKING_ENABLED_BY_DEFAULT = false
```

Alternativ kannst du in einem Fork `src/shared/tracking.ts` und den Aufruf von
`maybeSendObservation` in `src/content/content.ts` komplett entfernen.

Andere Daten bleiben lokal im Browser:

- Nutzereinstellungen liegen in `chrome.storage.sync`.
- Das zuletzt berechnete Ergebnis liegt in `chrome.storage.local`, damit das
  Popup es direkt anzeigen kann.
- Lokale Sende-Drosselung und anonyme Installations-ID liegen in
  `chrome.storage.local`.

## Voraussetzungen

- Node.js 20+
- npm
- Chrome oder ein anderer Chromium-basierter Browser zum lokalen Testen

## Abhängigkeiten installieren

```bash
npm install
```

## Entwicklung

```bash
npm run dev
```

Das startet Vite für die Popup-Oberfläche. Für Tests des Content Scripts die
Extension bauen und den Ordner `dist/` in Chrome laden.

Die eingecheckte Store-Konfiguration sendet Beobachtungen an
`https://echtstern.de/api/observations`. Für lokale API-Tests kannst du
vorübergehend `TRACKING_ENDPOINT` in `src/shared/tracking.ts` ändern und die
passende lokale Host-Permission in `manifest.json` ergänzen. Beides vor einem
Release-ZIP wieder zurücksetzen.

## Build

```bash
npm run build
```

Der Chrome-Extension-Build landet in `dist/`.

## Lokal in Chrome laden

1. `chrome://extensions` öffnen.
2. "Entwicklermodus" aktivieren.
3. "Entpackte Erweiterung laden" klicken.
4. Den Ordner `dist/` auswählen.
5. Ein Google-Maps-Unternehmensprofil öffnen und in den Rezensionen-Tab wechseln.

## Scripts

- `npm run dev` - Vite für lokale Popup-Entwicklung starten
- `npm run typecheck` - TypeScript prüfen
- `npm test` - Vitest-Tests ausführen
- `npm run lint` - ESLint ausführen
- `npm run build` - Popup, Content Script und Background Service Worker bauen

## Projektstruktur

```text
src/background/   Chrome Extension Background Service Worker
src/content/      Google Maps Content Script
src/popup/        React Popup UI
src/shared/       Schätzung, Parsing, Formatierung, Settings, i18n
public/_locales/  Chrome-i18n-Texte für das Manifest
public/icons/     Extension-Icons
```

## Host Permissions

Die Erweiterung benötigt Zugriff auf Google-Maps-Seiten, um öffentlich sichtbare
Bewertungsinformationen im Rezensionen-Tab zu lesen. Außerdem benötigt sie
Zugriff auf `https://echtstern.de/*`, um anonyme Beobachtungsdaten zu senden,
wenn die Freigabe aktiviert ist.

## Lizenz

MIT. Siehe `LICENSE`.

## Disclaimer

ECHTSTERN ist unabhängig und steht in keiner Verbindung zu Google. Google Maps
und Chrome sind Marken von Google LLC.

---

# ECHTSTERN Chrome Extension (English)

ECHTSTERN is a Chrome extension for Google Maps. It helps users better
understand Google Maps ratings when Google shows notices about reviews removed
after defamation complaints.

The extension runs on Google Maps review pages, reads publicly visible rating
information in the browser, and shows an additional ECHTSTERN estimate. The
estimate is a transparent calculation, not a claim about whether any individual
review was lawful, unlawful, or actually defamatory.

## What It Does

- Detects the active Google Maps reviews tab.
- Reads the visible rating, review count, star distribution, and removed-review
  notice when available.
- Calculates an ECHTSTERN estimate using configurable assumptions.
- Shows a small status indicator next to the Google rating.
- Can either show a compact inline estimate in Google Maps or a button that
  opens the popup.
- Lets users configure star weighting, assumed genuine defamation quota,
  warning thresholds, language, Google Maps display mode, and anonymous
  observation sharing.
- Can export the result as a PNG from the popup.

## Privacy

By default, this extension can send anonymous place-level observation data to
`https://echtstern.de/api/observations`. This is used to analyze aggregated
rating changes over time. The tracking code is part of this repository so it can
be audited, changed, or removed.

The extension can send:

- Google Maps place key and place name.
- The Google Maps URL for the observed place.
- Timestamp of the server-side observation.
- Visible Google rating and visible review count.
- Visible 1/2/3/4/5-star distribution, when detected.
- Google's visible removed-review range, when available.
- Latitude and longitude extracted from the current Google Maps URL, when
  available, so the backend can derive city-level metadata.
- Locale.
- A random anonymous install ID, stored locally, to deduplicate observations.

The extension does not send:

- Google account data.
- Review texts.
- User-entered content.
- Browser history outside the current Google Maps place page.
- Payment, health, or authentication data.

Users can turn observation sharing off in the popup under
`Settings` → `Anonymous observation data`.

For a local build with tracking disabled by default, change:

```ts
// src/shared/tracking.ts
export const TRACKING_ENABLED_BY_DEFAULT = false
```

You can also remove `src/shared/tracking.ts` and the call to
`maybeSendObservation` in `src/content/content.ts` entirely in your fork.

Other data stays local in the browser:

- User settings are stored via `chrome.storage.sync`.
- The latest calculated result is stored via `chrome.storage.local` so the popup
  can display it.
- Local send-throttle state and the anonymous install ID are stored via
  `chrome.storage.local`.

## Requirements

- Node.js 20+
- npm
- Chrome or another Chromium-based browser for local testing

## Install Dependencies

```bash
npm install
```

## Development

```bash
npm run dev
```

This starts Vite for the popup UI. For content-script testing, build the
extension and load the `dist/` folder in Chrome.

The committed store configuration sends observations to
`https://echtstern.de/api/observations`. For local API testing, temporarily
change `TRACKING_ENDPOINT` in `src/shared/tracking.ts` and add the matching local
host permission to `manifest.json`. Revert both before creating a release ZIP.

## Build

```bash
npm run build
```

The Chrome extension build is written to `dist/`.

## Load Locally In Chrome

1. Open `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked".
4. Select the `dist/` folder.
5. Open a Google Maps business profile and switch to the reviews tab.

## Scripts

- `npm run dev` - start Vite for local popup development
- `npm run typecheck` - run TypeScript checks
- `npm test` - run Vitest tests
- `npm run lint` - run ESLint
- `npm run build` - build popup, content script, and background script

## Project Structure

```text
src/background/   Chrome extension background service worker
src/content/      Google Maps content script
src/popup/        React popup UI
src/shared/       Estimation, parsing, formatting, settings, i18n
public/_locales/  Chrome i18n manifest messages
public/icons/     Extension icons
```

## Host Permissions

The extension requests access to Google Maps pages to read publicly visible
rating information. It also requests access to `https://echtstern.de/*` to send
anonymous observation data when sharing is enabled.

## License

MIT. See `LICENSE`.

## Disclaimer

ECHTSTERN is independent and is not affiliated with Google. Google Maps and
Chrome are trademarks of Google LLC.

