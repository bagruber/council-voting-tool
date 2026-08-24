# Council Voting Tool

Eine Browser-App zur **digitalen Schriftführung kommunaler Sitzungen**:
Anwesenheit, Abstimmungen und Protokoll werden live während der Sitzung
erfasst und am Ende als JSON/Markdown/ZIP exportiert. Kein Backend nötig;
auf moosburg.eu kann der öffentliche Teil zusätzlich an den Posteingang
der Transparenz-App übermittelt werden.

Gebaut für den **Stadtrat Moosburg a. d. Isar** und seine Ausschüsse. Andere
Räte sind **Mandanten**: ein Ordner mit Konfiguration und Mitgliederliste,
kein Fork. Der Gemeinderat Langenbach liegt als zweiter Mandant bei.

Live: [bagruber.github.io/council-voting-tool](https://bagruber.github.io/council-voting-tool/)
· Demo: [?demo](https://bagruber.github.io/council-voting-tool/?demo)
· Langenbach: [?rat=langenbach](https://bagruber.github.io/council-voting-tool/?rat=langenbach)

> **Hinweis:** Dieses Tool ist eine private Eigenentwicklung, nicht offiziell
> durch eine Kommune beauftragt. Es wird im praktischen Einsatz genutzt;
> Fehler oder Edge-Cases können trotzdem auftreten. Wünsche, Bug-Reports und
> Adaptionsanfragen gerne als
> [GitHub-Issue](https://github.com/bagruber/council-voting-tool/issues).

> **Hosting und Plattform-Regeln:** [PLATTFORM.md](PLATTFORM.md). Läuft
> zweifach (GitHub Pages und `moosburg.eu/abstimmung/`), beides gebaut
> aus `main`.

## Was die App kann

- **Sitzungsverwaltung**: Eröffnen, Pausieren, Unterbrechen für den
  nichtöffentlichen Teil, Beenden. Alle Statuswechsel landen mit Zeitstempel
  im Protokoll.
- **Anwesenheits-Tracking**: Sitzplan als Kreis, Klick togglet anwesend und
  abwesend. Bei Ausschüssen rückt automatisch die Stellvertretung ein.
  Abwesende rücken sichtbar aus dem Kreis heraus und werden hohl dargestellt.
- **Abstimmungen**: pro TOP Ja/Nein pro Sitz, "Alle Ja"/"Alle Nein" sowie
  Ja/Nein pro Fraktion über die Partei-Chips, Ergebnis-Summary vor dem
  Speichern. Stimmrecht ergibt sich aus der aktuellen Anwesenheit. Während
  einer Abstimmung setzt ein Klick auf den Sitz die Stimme; Anwesenheit
  ändert man dann über die Mitgliederkarten.
- **Tagesordnung**: als Text einfügbar (eine Zeile = ein TOP) oder als Datei
  vorbereitet, Autocomplete im Abstimmungs-Dialog.
- **Export**: JSON (maschinenlesbar), Markdown (für Mail), Text und
  ZIP-Bundle mit getrennten Dateien für den öffentlichen und den
  nichtöffentlichen Teil. Auto-Backup im LocalStorage gegen versehentliches
  Schließen.
- **Tastatursteuerung**: Die Fraktionen haben Vorrang auf den Buchstaben,
  jeweils der Anfangsbuchstabe des Namens (<kbd>C</kbd> CSU, <kbd>G</kbd>
  Grüne, <kbd>W</kbd> Freie Wähler, ...). Der Buchstabe schaltet die ganze
  Fraktion auf Ja, und auf Nein, wenn sie bereits geschlossen mit Ja stimmt.
  Die Befehle nehmen, was übrig bleibt: <kbd>+</kbd> neue Abstimmung,
  <kbd>J</kbd> alle Ja, <kbd>N</kbd> alle Nein, <kbd>Enter</kbd> speichern,
  <kbd>Esc</kbd> abbrechen, <kbd>?</kbd> Übersicht. Buchstabenkürzel
  pausieren, solange ein Textfeld aktiv ist.

## Demo

`?demo` öffnet eine vollständig bedienbare Sitzung, vorbelegt mit dem
Bauausschuss vom 13.07.2026 samt echter Tagesordnung. Eine Leiste über dem
Header führt in zehn Schritten durch alle Funktionen; die Schritte haken
sich anhand des tatsächlichen Sitzungszustands ab, auch wenn man sie in
anderer Reihenfolge durchläuft. Welche Sitzung die Demo lädt, steht im
`demo`-Block der Mandanten-Konfiguration; ohne den Block gibt es für einen
Mandanten keine Demo.

Der Demo-Modus schreibt nicht ins LocalStorage-Backup und liest es auch
nicht; eine laufende echte Sitzung kann er also nicht überschreiben.
`test/demo-durchlauf.test.tsx` fährt die Demo-Sitzung bei jedem Testlauf
einmal komplett durch.

## Entwickeln

```bash
npm install
npm run dev        # Dev-Server auf http://localhost:5173
npm run build      # TypeScript-Check + Vite-Build nach dist/
npm run test       # Demo-Durchlauf und Export-Schema (Vitest)
npm run typecheck  # nur tsc
```

Stack: Vite, React 19, TypeScript, Tailwind CSS 4. Noto Sans/Serif und JSZip
sind gebündelt, es wird nichts von CDNs geladen. Nach dem ersten Laden der
Seite braucht das Tool kein Netz mehr, bis exportiert oder übermittelt wird.

## Projektstruktur

```
council-voting-tool/
├── index.html                  # Vite-Einstieg
├── src/
│   ├── types.ts                # Domänenmodell (members.json + Sitzungszustand)
│   ├── data.ts                 # Verarbeitung von members.json, Gremien-Logik
│   ├── logic.ts                # Formatierung, Tastatur, Protokoll, Export
│   ├── reducer.ts              # Sitzungszustand und alle Übergänge
│   ├── demo.ts                 # die zehn Demo-Schritte
│   ├── tenant.ts               # Mandanten-Auflösung (?rat=...)
│   └── App.tsx                 # Oberfläche
├── public/tenants/
│   ├── index.json              # Standard-Mandant + Liste
│   ├── moosburg/               # config.json, members.json, tagesordnung/
│   └── langenbach/             # config.json, members.json
├── test/                       # Demo-Durchlauf, Export-Schema
├── DESIGN.md                   # Designsprache (Farben, Typografie)
└── stadtrat-design-dokument.md # HLD/LLD der Anwendung
```

## Einen weiteren Rat aufnehmen

Ein Rat ist ein Ordner unter `public/tenants/<id>/`:

**1. `config.json`**: Name, Browser-Titel, Vorgaben für neue Sitzungen,
Begriffe ("Stadtrat"/"Gemeinderat", Vorsitz-Titel), optional eigene Farben
(ersetzen die `--t-*`-Werte aus `src/index.css`) und optional ein
`demo`-Block. Vorlage: `public/tenants/langenbach/config.json`.

**2. `members.json`**: Personen, Parteien, Gremien. Das Format ist dasselbe
wie in [bagruber/council](https://github.com/bagruber/council):

- **`parties`**: `id`, `name`, `color`, optional `key` (der Buchstabe für
  das Fraktions-Kürzel; ohne ihn wird der erste freie Anfangsbuchstabe
  vergeben).
- **`seatOrder`**: Reihenfolge der Parteien im Sitzkreis, links nach rechts.
- **`councilOrder`**: optional, explizite Reihenfolge einzelner Mitglieder,
  überschreibt die Parteilogik.
- **`members`**: pro Person `id`, `firstName`, `lastName`, `party`, `role`
  (`mayor` oder `councillor`), `from`/`to` für den Mandatszeitraum, optional
  `partyHistory` und `title`. Zeiträume werden ausgewertet: nicht mehr
  aktive Mitglieder verschwinden automatisch aus Sitzplan und Stimmrecht.
- **`bodies`**: `type: "plenum"` besetzt sich automatisch aus allen aktiven
  Mitgliedern; `type: "ausschuss"` trägt eine `seats`-Liste mit `member`
  und optional `sub` (Stellvertretung), dazu `chair`, `vicechairs`,
  optional `chairSub`.

**3. Eintrag in `public/tenants/index.json`.** Danach ist der Rat unter
`?rat=<id>` erreichbar; wer ihn zum Standard machen will, ändert dort
`standard`.

**Tagesordnungen** liegen optional als Textdateien (eine Zeile pro TOP)
unter `tenants/<id>/tagesordnung/JJJJ-MM-TT_<gremium>.txt` und werden zum
passenden Sitzungsdatum automatisch geladen.

## Geschwister-Apps

Teil der Moosburg-Projekte, Überblick im
[BRIEFING](https://github.com/bagruber/moosburg-eu). Am engsten verwandt:
[bagruber/council](https://github.com/bagruber/council), die öffentliche
Transparenz-App. Sie nutzt dasselbe `members.json`-Datenmodell und erhält
über den Posteingang auf moosburg.eu die hier erfassten Sitzungen.

## Verantwortung

Entwickelt und betrieben von **Benedict Arya Gruber**, von 2022 bis 2026
Digitalisierungsreferent der Stadt Moosburg a. d. Isar und Stadtrat (fresh).
Private Eigenentwicklung, kein offizielles Produkt einer Verwaltung.

Kontakt: [benedict.gruber@fresh.bayern](mailto:benedict.gruber@fresh.bayern) ·
[gruber.am](https://www.gruber.am)

Lizenz: MIT.
