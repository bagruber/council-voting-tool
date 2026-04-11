# Moosburg Design Language

Designsprache der Council Transparency App. Wiederverwendbar in anderen Projekten.

## Farben

### Primär (Moosburg-Rot)
| Token | Hex | Verwendung |
|---|---|---|
| `--primary-dark` | `#5A070A` | Überschriften, Hover-States |
| `--primary` | `#9B0000` | Links, aktive Elemente |
| `--primary-bright` | `#E6001E` | Akzentlinien, Gradient-Endpunkt |

Gradient für Hero-Bereiche: `linear-gradient(135deg, --primary-dark, --primary, --primary-bright)`

### Akzent (Gold)
| Token | Hex | Verwendung |
|---|---|---|
| `--accent` | `#B39F7A` | Section-Headings, Badges |
| `--accent-light` | `#E8DFCF` | Hintergründe, Tag-Chips, Hover |

### Oberfläche
| Token | Hex | Verwendung |
|---|---|---|
| `--bg` | `#FAF8F5` | Seiten-Hintergrund (warm off-white) |
| `--surface` | `#FFFFFF` | Cards, Dropdowns, Modals |
| `--border` | `#E8E2D8` | Trennlinien, Card-Borders |
| `--text` | `#2D2D2D` | Fließtext |
| `--text-muted` | `#777777` | Sekundärtext, Metadaten |

### Semantisch
| Token | Hex | Verwendung |
|---|---|---|
| `--yes` | `#78BE1E` | Zustimmung, Erfolg |
| `--no` | `#9B0000` | Ablehnung, Fehler |
| `--absent` | `#B0B0B0` | Abwesend, inaktiv |
| `--info` | `#5B9BD5` | Hinweise, Anträge |
| `--teal` | `#00B4D8` | Meilensteine |
| `--purple` | `#9B59B6` | Sonderkategorie |

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

| Token | Wert | Verwendung |
|---|---|---|
| `--shadow` | `0 1px 3px rgba(0,0,0,0.07)` | Cards, ruhende Elemente |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.1)` | Hover-Cards, Dropdowns, Suchfeld |

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
