# ECHTSTERN Browser Extension

ECHTSTERN ist eine Browser-Erweiterung für Google Maps. Sie hilft dabei,
Google-Maps-Bewertungen besser einzuordnen, wenn Google Hinweise auf entfernte
Bewertungen wegen Diffamierungsbeschwerden anzeigt.

Die Erweiterung läuft im Rezensionen-Tab von Google Maps. Sie liest dort
öffentlich sichtbare Bewertungsinformationen aus und zeigt direkt in Google Maps
eine zusätzliche ECHTSTERN-Einordnung. Diese Einordnung ist eine nachvollziehbare
Berechnung, keine Aussage darüber, ob eine einzelne Bewertung rechtmäßig,
unrechtmäßig oder tatsächlich diffamierend war.

## Was ECHTSTERN Kann

- Erkennt den aktiven Rezensionen-Tab in Google Maps.
- Liest sichtbare Bewertung, Bewertungsanzahl, Sterneverteilung und Hinweise auf
  entfernte Bewertungen aus.
- Berechnet eine ECHTSTERN-Schätzung auf Basis konfigurierbarer Annahmen.
- Zeigt einen kleinen Statusindikator neben der Google-Bewertung.
- Zeigt wahlweise eine kompakte Inline-Einordnung oder einen Button zum Popup.
- Zeigt bei Profilen ohne entfernte Bewertungen einen Prüfhinweis statt einer
  Schätzung.
- Ermöglicht Einstellungen für Sternegewichtung, angenommene echte
  Diffamierungsquote, Warnungsgrenzen, Sprache, Anzeigeart und anonyme
  Beobachtungsdaten.
- Kann das Ergebnis aus dem Popup als PNG exportieren.

## Datenschutz

Die Berechnung läuft lokal im Browser. Standardmäßig kann die Erweiterung
anonyme, ortsbezogene Beobachtungsdaten an
`https://echtstern.de/api/observations` senden. Das hilft dabei, öffentlich
sichtbare Bewertungsänderungen über Zeit aggregiert zu analysieren. Die Freigabe
kann jederzeit im Popup unter `Einstellungen` -> `Anonyme Beobachtungsdaten`
deaktiviert werden.

Die Erweiterung kann senden:

- Google-Maps-Ortsschlüssel und Ortsname.
- Die Google-Maps-URL des betrachteten Ortes.
- Sichtbare Google-Bewertung und sichtbare Bewertungsanzahl.
- Sichtbare 1/2/3/4/5-Sterneverteilung, wenn erkannt.
- Googles sichtbare Spanne entfernter Bewertungen, wenn vorhanden.
- Latitude und Longitude aus der aktuellen Google-Maps-URL, wenn verfügbar.
- Spracheinstellung.
- Eine zufällig erzeugte anonyme Installations-ID zur Deduplizierung.

Die Erweiterung sendet nicht:

- Google-Kontodaten.
- Rezensionstexte.
- Von Nutzerinnen oder Nutzern eingegebene Inhalte.
- Browserverlauf außerhalb der aktuellen Google-Maps-Ortsseite.
- Zahlungs-, Gesundheits- oder Authentifizierungsdaten.

Andere Daten bleiben lokal im Browser, darunter Einstellungen, das zuletzt
berechnete Ergebnis, die lokale Sende-Drosselung und die anonyme Installations-ID.

## Lokal Installieren

Du brauchst:

- Node.js 20+
- pnpm
- Chrome, Chromium oder Firefox

Installiere zuerst die Abhängigkeiten:

```bash
pnpm install
```

### Chrome Oder Chromium

Baue die Extension:

```bash
pnpm run build:chrome
```

Lade sie anschließend im Browser:

1. `chrome://extensions` öffnen.
2. "Entwicklermodus" aktivieren.
3. "Entpackte Erweiterung laden" klicken.
4. Den Ordner `dist/` auswählen.
5. Ein Google-Maps-Unternehmensprofil öffnen und in den Rezensionen-Tab wechseln.

### Firefox

Baue die Firefox-Version:

```bash
pnpm run build:firefox
```

Für einen schnellen lokalen Test kannst du Firefox direkt über `web-ext` starten:

```bash
pnpm run run:firefox
```

Alternativ kannst du den Build manuell laden:

1. `about:debugging#/runtime/this-firefox` öffnen.
2. "Temporäres Add-on laden" klicken.
3. `dist/manifest.json` auswählen.
4. Ein Google-Maps-Unternehmensprofil öffnen und in den Rezensionen-Tab wechseln.

Firefox lädt temporäre Add-ons nur bis zum nächsten Browser-Neustart. Danach musst
du sie erneut laden.

## Entwickeln

Für die Popup-Oberfläche kannst du Vite starten:

```bash
pnpm run dev
```

Für das Content Script und den Background Worker musst du die Extension bauen und
den `dist/`-Ordner im jeweiligen Browser laden.

Nützliche Checks:

```bash
pnpm run typecheck
pnpm test
pnpm run lint
```

## Projektstruktur

```text
src/background/   Background Worker der Erweiterung
src/content/      Google-Maps-Content-Script
src/popup/        React-Popup
src/shared/       Schätzung, Parsing, Formatierung, Settings, i18n
public/_locales/  Manifest-Texte für die Browser-i18n
public/icons/     Extension-Icons
```

## Berechtigungen

ECHTSTERN benötigt Zugriff auf Google-Maps-Seiten, um öffentlich sichtbare
Bewertungsinformationen im Rezensionen-Tab zu lesen und das ECHTSTERN-UI direkt
in Google Maps einzublenden. Außerdem benötigt die Erweiterung Zugriff auf
`https://echtstern.de/*`, um anonyme Beobachtungsdaten zu senden, wenn die
Freigabe aktiviert ist.

## Lizenz

MIT. Siehe `LICENSE`.

## Disclaimer

ECHTSTERN ist unabhängig und steht in keiner Verbindung zu Google. Google Maps,
Chrome und Firefox sind Marken ihrer jeweiligen Inhaber.

---

# ECHTSTERN Browser Extension (English)

ECHTSTERN is a browser extension for Google Maps. It helps users better
understand Google Maps ratings when Google shows notices about reviews removed
after defamation complaints.

The extension runs on Google Maps review pages. It reads publicly visible rating
information in the browser and adds an ECHTSTERN estimate directly inside Google
Maps. The estimate is a transparent calculation, not a claim about whether any
individual review was lawful, unlawful, or actually defamatory.

## What ECHTSTERN Does

- Detects the active Google Maps reviews tab.
- Reads the visible rating, review count, star distribution, and removed-review
  notice when available.
- Calculates an ECHTSTERN estimate using configurable assumptions.
- Shows a small status indicator next to the Google rating.
- Shows either a compact inline estimate or a button that opens the popup.
- Shows a checked notice instead of an estimate when no removed reviews are
  visible.
- Lets users configure star weighting, assumed genuine defamation quota, warning
  thresholds, language, Google Maps display mode, and anonymous observation
  sharing.
- Can export the result as a PNG from the popup.

## Privacy

The calculation runs locally in the browser. By default, the extension can send
anonymous place-level observation data to
`https://echtstern.de/api/observations`. This is used to analyze publicly visible
rating changes in aggregate over time. Users can turn this off at any time in
the popup under `Settings` -> `Anonymous observation data`.

The extension can send:

- Google Maps place key and place name.
- The Google Maps URL for the observed place.
- Visible Google rating and visible review count.
- Visible 1/2/3/4/5-star distribution, when detected.
- Google's visible removed-review range, when available.
- Latitude and longitude extracted from the current Google Maps URL, when
  available.
- Locale.
- A random anonymous install ID used for deduplication.

The extension does not send:

- Google account data.
- Review texts.
- User-entered content.
- Browser history outside the current Google Maps place page.
- Payment, health, or authentication data.

Other data stays local in the browser, including settings, the latest calculated
result, local send-throttle state, and the anonymous install ID.

## Local Installation

You need:

- Node.js 20+
- pnpm
- Chrome, Chromium, or Firefox

Install dependencies first:

```bash
pnpm install
```

### Chrome Or Chromium

Build the extension:

```bash
pnpm run build:chrome
```

Load it in the browser:

1. Open `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked".
4. Select the `dist/` folder.
5. Open a Google Maps business profile and switch to the reviews tab.

### Firefox

Build the Firefox version:

```bash
pnpm run build:firefox
```

For a quick local test, start Firefox through `web-ext`:

```bash
pnpm run run:firefox
```

You can also load the build manually:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select `dist/manifest.json`.
4. Open a Google Maps business profile and switch to the reviews tab.

Firefox keeps temporary add-ons only until the next browser restart. After that,
load the add-on again.

## Development

For the popup UI, start Vite:

```bash
pnpm run dev
```

For the content script and background worker, build the extension and load the
`dist/` folder in the target browser.

Useful checks:

```bash
pnpm run typecheck
pnpm test
pnpm run lint
```

## Project Structure

```text
src/background/   Extension background worker
src/content/      Google Maps content script
src/popup/        React popup
src/shared/       Estimation, parsing, formatting, settings, i18n
public/_locales/  Manifest messages for browser i18n
public/icons/     Extension icons
```

## Permissions

ECHTSTERN requests access to Google Maps pages to read publicly visible rating
information in the reviews tab and inject the ECHTSTERN UI into Google Maps. It
also requests access to `https://echtstern.de/*` to send anonymous observation
data when sharing is enabled.

## License

MIT. See `LICENSE`.

## Disclaimer

ECHTSTERN is independent and is not affiliated with Google. Google Maps, Chrome,
and Firefox are trademarks of their respective owners.
