# Council Voting Tool

Eine Browser-App zur **digitalen Schriftführung kommunaler Sitzungen** —
Anwesenheit, Abstimmungen und Protokoll werden live während der Sitzung
erfasst und am Ende als JSON/Markdown exportiert. Läuft komplett im Browser,
ohne Backend, ohne Build-Step.

Ursprünglich gebaut für den **Stadtrat Moosburg a.d. Isar** und seine
Ausschüsse, ist die App so aufgebaut, dass sie sich mit überschaubarem
Aufwand für andere Räte adaptieren lässt (siehe
[Anpassung für andere Räte](#anpassung-für-andere-räte) unten). Eine Variante
für den Gemeinderat Langenbach existiert bereits parallel im selben
Repository-Ordner.

> ⚠️ **Hinweis:** Dieses Tool ist eine **private Eigenentwicklung**, nicht
> offiziell durch eine Kommune beauftragt. Es wurde im praktischen Einsatz
> getestet — Fehler oder Edge-Cases können trotzdem auftreten. Wünsche,
> Bug-Reports und Adaptionsanfragen gerne jederzeit als
> [GitHub-Issue](https://github.com/bagruber/council-voting-tool/issues)
> oder per Mail.

## Was die App kann

- **Sitzungsverwaltung** — Eröffnen, Pausieren, Unterbrechen für nicht­öffentlichen
  Teil, Beenden. Alle Statuswechsel landen mit Zeitstempel im Protokoll.
- **Anwesenheits-Tracking** — Sitzplan als Kreis, Klick togglet anwesend /
  abwesend. Bei Ausschüssen rückt automatisch die Stellvertretung ein.
- **Abstimmungen** — Pro TOP Ja/Nein pro Sitz, „Alle Ja“/„Alle Nein“-Shortcuts,
  Ergebnis-Summary vor dem Speichern. Stimmrecht ergibt sich aus aktueller
  Anwesenheit.
- **Tagesordnung** — als Text einfügbar (eine Zeile = ein TOP), Autocomplete im
  Abstimmungs-Dialog.
- **Export** — JSON (maschinenlesbar), Markdown (für Mail) und ZIP-Bundle.
  Auto-Backup im LocalStorage gegen versehentliches Schließen.

## Lokal starten

Statischer Webserver reicht — kein npm, kein Build:

```bash
npx serve
# oder
python -m http.server 8000
```

Dann `http://localhost:8000/` öffnen. Änderungen an HTML/JS/JSON sind nach
Reload sichtbar.

## Projektstruktur

```
council-voting-tool/
├── index.html                  # App-Shell + Tailwind-Theme
├── members.json                # Rats- und Ausschuss-Konfiguration
├── js/
│   ├── data.js                 # Datenmodell, Gremien-Logik
│   └── app.js                  # React-App (JSX in-browser via Babel)
├── tagesordnung/               # Vorerfasste TOP-Listen pro Sitzung
├── DESIGN.md                   # Designsprache (Farben, Typografie)
└── stadtrat-design-dokument.md # HLD/LLD der Anwendung
```

## Anpassung für andere Räte

Drei Stellen reichen für die meisten Fälle:

### 1. `members.json` — Personen, Parteien, Gremien

Die zentrale Konfigurationsdatei. Sie enthält:

- **`parties`** — Liste mit `id`, `name`, `color`, `accent` (Hex). Bestimmt
  Sitzfarbe und Akzent.
- **`seatOrder`** — Reihenfolge der Parteien beim Layout des Sitzkreises
  (links nach rechts, politisches Spektrum).
- **`councilOrder`** — *optional*: explizite Reihenfolge einzelner Mitglieder
  im Uhrzeigersinn, überschreibt die Parteilogik. Praktisch, wenn der
  reale Sitzplan abweicht.
- **`members`** — pro Person `id`, `firstName`, `lastName`, `party`, `role`
  (`mayor` oder `councillor`), `from`/`to` für Mandatszeitraum. Optional
  `partyHistory` (Parteiwechsel) und ein `profile`-Block (in dieser App nicht
  zwingend nötig, aber kompatibel zu [bagruber/council](https://github.com/bagruber/council)).
- **`bodies`** — die Gremien:
  - `type: "plenum"` — alle aktiven Stadträt:innen + Bürgermeister:in werden
    automatisch besetzt.
  - `type: "ausschuss"` — explizite `seats`-Liste mit `member` und optional
    `sub` (Stellvertretung), dazu `chair`, `vicechairs`, optional `chairSub`.

Mandats-Zeiträume (`from`/`to`) werden ausgewertet: nicht mehr aktive
Mitglieder verschwinden automatisch aus Sitzplan und Stimmrecht.

### 2. `index.html` — Farben und Branding

Im `<script>`-Block oben steht die Tailwind-Konfiguration. Das Farbschema
(`primary`, `accent`, `bg`, …) lässt sich dort und in `DESIGN.md` zentral
ändern. Auch der `<title>` und ggf. der Standard-Sitzungsort gehören hierher.

### 3. `js/app.js` — Default-Werte

Ganz oben definiert `INITIAL_STATE` die Vorgaben für neue Sitzungen
(`title: 'Stadtratssitzung'`, `location: 'Rathaus Moosburg, …'`). Diese auf
die jeweilige Kommune anpassen.

### Tagesordnungen vorbereiten *(optional)*

Der Ordner `tagesordnung/` enthält Plain-Text-Dateien (eine Zeile pro TOP)
für reale Sitzungen. Diese können im Vorfeld eingepflegt und in der App
beim Sitzungsstart einkopiert werden.

## Geschwister-Apps

Dieses Tool ist Teil einer kleinen Familie von Anwendungen rund um
Transparenz und Datenarbeit in der Kommune Moosburg:

- **[bagruber/council](https://github.com/bagruber/council)** — öffentliche
  Transparenz-App, die historische Abstimmungen, Themen, Anträge und
  Pressemitteilungen verzahnt darstellt
  ([Live](https://bagruber.github.io/council/)). Das Datenmodell von
  `members.json` ist mit dieser App kompatibel.
- **[bagruber/datahub](https://github.com/bagruber/datahub)** — interaktives
  Umfrage- und Daten-Dashboard für die Stadt.
- **bagruber/council-voting-tool** *(dieses Repo)* — die Live-Erfassung
  während der Sitzung.

Daten und Designsprache (Moosburg-Rot, Gold-Akzent, warmes Off-White) sind
über alle drei Apps konsistent.

## Verantwortung

Entwickelt und betrieben von **Benedict Arya Gruber**, von 2022 bis 2026
Digitalisierungsreferent der Stadt Moosburg a.d. Isar und Stadtrat (fresh).
Dieses Projekt ist eine private Eigenentwicklung — kein offizielles Produkt
der Stadtverwaltung.

Kontakt: [benedict.gruber@fresh.bayern](mailto:benedict.gruber@fresh.bayern) ·
[gruber.am](https://www.gruber.am)

Lizenz: MIT.
