# Designsprache des Sitzungswerkzeugs

Absichtlich **nicht** der Moosburg-Kanon aus `moosburg-design`: jeder Mandant
bringt eigene Farben mit, und in der Sitzung schlägt Informationsdichte den
Markenauftritt. Was hier steht, gilt für dieses Werkzeug.

Die Zahlen stehen in `src/index.css`, nicht hier. Diese Datei beschreibt die
Rollen und die Regeln; wer einen Wert braucht, liest ihn dort. Bis September
2026 standen beide Stellen nebeneinander und die Tabellen hier waren an der
Hälfte der Werte veraltet.

## Farben

Zwei Schichten in `src/index.css`:

- **`--t-*` sind je Mandant austauschbar** (Rot, Akzent, Grundton). Eine
  `config.json` unter `public/tenants/<id>/` ersetzt sie unter `"farben"`,
  `tenant.ts` schreibt sie beim Laden auf `:root`. Die Vorgaben im Stylesheet
  sind der Mandant Moosburg.
- **Der Rest ist für alle Mandanten gleich**, allen voran die
  Abstimmungsfarben: Ja, Nein, Abwesend und Hinweis sind Semantik, nicht
  Branding, und dürfen nicht mandantenabhängig kippen.

## Typografie

| Rolle | Font | Gewicht | Beispiel |
|---|---|---|---|
| Überschriften | Noto Serif, Georgia, serif | 700 | Seitentitel, Section-Headings |
| Fließtext | Noto Sans, system-ui, sans-serif | 400 | Body, Labels |
| Section-Labels | Noto Serif | 700, uppercase, 0.06em tracking | `ABSTIMMUNGEN`, `TIMELINE` |
| Kleintext | Noto Sans | 400, 0.72–0.82rem | Tags, Badges, Metadaten |

Basis: `line-height: 1.6`, Textfarbe `--text`.

## Abstände & Layout

- **Max-Width**: `800px` für Content, `640px` für Suchbereich
- **Padding**: `24px` horizontal, `32px` vertikal (Main)
- **Gap**: `12px` zwischen Cards, `6–8px` zwischen Tags/Chips
- **Border-Radius**: `8px` (Cards, Inputs), `12px` (kleine Tags), `20px` (Pills), `50%` (Dots)

## Schatten

Zwei Stufen, `--shadow-card` für ruhende Elemente und `--shadow-card-lg` für
Hover-Karten, Dropdowns und das Suchfeld. Werte in `src/index.css`.

## Komponenten

### Cards
- Weiß (`--surface`), 1px `--border`, `--radius` Rundung
- `--shadow` default, `--shadow-lg` + `translateY(-1px)` on hover
- Optionaler farbiger linker Rand: `border-left: 4px solid --primary-bright`

### Tags / Chips
- Klein: `0.72rem`, `2px 10px` Padding, `12px` Radius, `--accent-light` Hintergrund
- Pill: `0.82rem`, `5px 14px`, `20px` Radius, halbtransparent auf dunklem Hintergrund
- Aktiver Pill: weiß mit `--primary` Text

### Buttons (Tab-Bar)
- Icon + Label vertikal gestapelt
- `--text-muted` default, `--primary` aktiv
- Transition: `color 0.15s`

### Timeline
- Vertikale 2px-Linie (`--border`), `36px` Einrückung
- Farbige Dots mit Icons: Proposal (blau), Vote (grün/rot), Milestone (teal), Committee (gold)
- Dot: `24px`, zentriertes Icon, weißer Hintergrund, farbiger 2px Border

### Links
- Farbe: `--primary`
- Unterstrich: `border-bottom: 1px dashed`, solid on hover

### Suche
- Volle Breite auf Rot-Gradient-Hintergrund
- Weißes Input mit `--shadow-lg`
- Focus: `0 0 0 3px rgba(255,255,255,0.4)` Glow

### Badges
- Uppercase, `0.72rem`, `0.04em` tracking
- `--accent-light` Hintergrund, `--accent` Text
- Optional mit Material Icon (14px)

## Prinzipien

- Hell und freundlich, warme Töne statt kaltem Grau
- Rot als Leitfarbe, Gold als ruhiger Akzent
- Informationsdichte dosieren: nicht alles auf den ersten Blick
- Hover-Feedback über Schatten und leichte Bewegung, nie zu viel
- Konsistente Elemente: gleiche Patterns für gleiche Dinge
