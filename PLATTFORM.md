# Plattform-Kontext

Wo dieses Tool läuft und was beim Ändern zu beachten ist. Der übergreifende
Kontext steht im Repo `bagruber/moosburg-eu` in `BRIEFING.md`.

*Stand: August 2026*

---

## Das Tool läuft zweifach

| | Adresse | Quelle |
|---|---|---|
| GitHub Pages | `bagruber.github.io/council-voting-tool/` | `main`, gebaut über `.github/workflows/pages.yml` |
| moosburg.eu | `moosburg.eu/abstimmung/` | `main`, gebaut über `.github/workflows/deploy.yml` |

Beide kommen aus `main`, ein Commit erreicht beide. Deployt wird jeweils der
`dist/`-Ordner eines Vite-Builds; der Deploy-Workflow lässt vorher die Tests
laufen. Der Build läuft mit `base: "./"`, alle Pfade sind relativ, dieselbe
Ausgabe funktioniert deshalb unter beiden Adressen ohne Anpassung.

## Übermitteln an das Backend

Neben dem Export kann der **öffentliche Teil** einer beendeten Sitzung an
`moosburg.eu/api/sessions` gesendet werden. Von dort wandert er per Hand in die
Stadtratstransparenz-App (`bagruber/council`) — als Herkunftsstufe `tracked`,
„von einer benannten Person im Saal erfasst".

Vier Entscheidungen, die dabei bewusst so getroffen sind:

**Der Export bleibt die Sicherung.** Das Übermitteln-Feld steht *unter* dem
Export-Panel, nicht darüber und nicht an seiner Stelle. Die Datei in der Hand
ist das Verlässliche, die Übermittlung das Zusätzliche.

**Nur der öffentliche Teil verlässt das Gerät.** Das Panel nennt vor dem
Absenden die Zahl der öffentlichen Abstimmungen, damit sichtbar ist, was
rausgeht. Der Server prüft zusätzlich nach und lehnt alles andere mit 422 ab,
statt sich darauf zu verlassen, dass das Tool nichts anderes schickt.

**ZIP und Upload teilen sich eine Quelle.** `buildPartJSON()` erzeugt beide
Hälften des ZIP und den Upload-Payload. Wer das Format ändert, ändert es an
einer Stelle — Datei und Serverstand können nicht auseinanderlaufen.

**Zugangsdaten liegen nur im Komponenten-State.** Kein LocalStorage, keine
Wiederverwendung nach dem Neuladen; das Passwort wird nach Erfolg verworfen.
(Der Auto-Backup der Sitzung nutzt LocalStorage — Zugangsdaten nicht.)

### Warum das Feld manchmal fehlt

`SAVE_ENDPOINT` ist nur gesetzt, wenn ein Backend erreichbar sein kann:

```js
h.endsWith('moosburg.eu') || h === 'localhost' || h === '127.0.0.1'
```

Auf dem GitHub-Pages-Spiegel und beim Öffnen per `file://` erscheint das Panel
deshalb gar nicht — besser, als einen Knopf anzubieten, der nur scheitern kann.
Wer die Funktion lokal testen will, muss über `localhost` gehen, nicht über
den Dateipfad.

### Zugänge

Es gibt keine Selbstregistrierung. Zugangsdaten erzeugt
`scripts/zugang.php` im Repo `moosburg-eu`; der Prozess steht dort im README.
Ein Zugang besteht aus E-Mail und Passwort, der Server kennt nur den
bcrypt-Hash. Entziehen heißt: Eintrag aus der Server-Config löschen.

## Alles ist gebündelt

Seit dem Port auf Vite (August 2026) liegen React, Tailwind, JSZip und die
Schriften im Build; es wird nichts von CDNs geladen. Zwei Folgen:

- **Nach dem ersten Laden braucht das Tool kein Netz mehr**, bis exportiert
  oder übermittelt wird. Für die Sitzung im Saal mit wackligem WLAN ist das
  der Punkt, an dem es drauf ankommt.
- **Die Content-Security-Policy auf moosburg.eu ist damit möglich geworden.**
  Dieses Tool war der Grund, warum es keine gab.

Typprüfung und Tests laufen vor jedem Deploy (`npm run typecheck`,
`npm run test`); der Demo-Durchlauf-Test fährt eine komplette Sitzung durch.

## Gestaltung

Die Farb- und Schrift-Tokens stehen in [DESIGN.md](DESIGN.md).

### Verbotenes Muster: der einseitige Kantenakzent

Ein dekorativer Farbbalken entlang **einer** Kante einer Karte oder Box ist in
allen Moosburg-Projekten unerwünscht — er ist die Standardausgabe gängiger
Vorlagen und dekoriert eine Unterscheidung, die die Hierarchie ohnehin trägt.
Stattdessen typografisch unterscheiden oder über die ganze Fläche.

Nicht gemeint sind Zustandsanzeigen wie ein Aktiv-Unterstrich oder
strukturelle Linien wie ein Zeitstrahl.

### Tastatur vor Maus

Die Fraktionen haben Vorrang auf den Buchstaben, weil in der Sitzung schnell
erfasst wird. Wer neue Kürzel einführt, prüft die Belegung in `DESIGN.md` und
im README — die Befehle nehmen, was übrig bleibt.
