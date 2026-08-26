# Versions-Update — council-voting-tool

*Briefing fuer eine eigene Claude-Code-Sitzung in diesem Repo. Angelegt 26.08.2026.
Nach erledigtem Update loeschen.*

## Auftrag

Dieses Repo auf die Hausbasis ziehen, die ueber alle bagruber-Repos gilt. Der Zweck
ist nicht Aktualitaet um ihrer selbst willen: alle Repos teilen sich seit dem
26.08.2026 einen gemeinsamen pnpm-Store. Der dedupliziert exakt so weit, wie die
Versionen uebereinstimmen. Gemessen wurde: ein Repo mit abweichenden Versionen kostet
~158 MB, ein Versions-Zwilling ~8 MB.

**Welle 1 + 2 von 4.**

Die Gesamtreihenfolge ueber alle Repos, damit klar ist, wo dieses hier steht:

| Welle | Repos | Warum hier |
|---|---|---|
| **1** | baumkarte, datahub, haushaltvis, moosburghistorisch, council-voting-tool, freshdoc, freshpost, transitmap, moosburg, moosburg-relaunch | TypeScript und `@types/node` — reine Typaenderung, kein Laufzeitrisiko. Groesster Speichergewinn: TypeScript wiegt 23 MB und liegt derzeit in sechs Versionen herum. |
| **2** | dieselben zehn Repos | Vite 6 -> 8. Build-Tool-Major, bewusst getrennt von Welle 1: bricht etwas, ist die Ursache dann eindeutig. |
| **3** | pridemap, dann etymology, dann home_dashboard | React 18 -> 19. Echte Runtime-Majors, jeweils nur ein Repo betroffen. Aufsteigend nach Aufwand. |
| **4** | sexdiary | Echter Versionskonflikt im Monorepo (web React 18, mobile React 19), nicht blosse Drift. Zuletzt, weil am aufwendigsten. |
| **parallel** | aicms, anagram, learnfarsi | Stehen bereits voraus (TypeScript 7, Vite 8). Nur untereinander angleichen, nicht zurueckziehen. Jederzeit machbar. |

## Hausbasis

| Paket | Zielversion |
|---|---|
| react / react-dom | 19.2.x |
| vite | 8.x |
| typescript | 5.9.x |
| tailwindcss | 4.x |
| @types/node | 26.x |
| vitest | 4.1.x |
| react-router-dom | 7.x |

## Konkret in diesem Repo

| Paket | Ist | Ziel | Einordnung |
|---|---|---|---|
| `typescript` | ~5.7.2 | ~5.9.x | Welle 1 — nur Typen, kein Laufzeitverhalten |
| `@types/node` | ^22.10.0 | ^26.x | Welle 1 — nur Typen, kein Laufzeitverhalten |
| `vite` | ^6.0.0 | ^8.x | Welle 2 — Build-Tool-Major |


## Vorgehen

1. Ausgangslage sichern: der Build muss **vor** dem Update gruen sein. Ist er das
   nicht, zuerst das melden statt zu updaten.
2. Pakete einzeln oder in kleinen Gruppen hochziehen, nicht alle auf einmal. Nach
   jeder Gruppe bauen. Bricht etwas, ist die Ursache dann eindeutig.
3. Bei Majors (React, Vite, Tailwind) die jeweilige Migrations-Doku lesen, bevor die
   Version angefasst wird.
4. `pnpm install`, dann pruefen, ob `pnpm approve-builds` noetig wird.

## Verifikation

```bash
pnpm run build
pnpm run test
```

Alle davon muessen gruen sein.

## Fallstricke aus der pnpm-Migration (26.08.2026)

Diese drei Dinge sind beim Umstieg auf pnpm real aufgetreten — bitte beim Update
im Kopf behalten:

1. **Ein Lockfile-Wechsel ist ein Update.** `pnpm install` loest Ranges neu auf.
   In moosburg brach ein reiner Patch-Sprung `react-map-gl 8.1.1 -> 8.1.2` den
   `maxBounds`-Typ. Wenn nach einem Update etwas bricht: erst pruefen, welche
   Version vorher im Lockfile stand, bevor die eigene Codebasis verdaechtigt wird.
2. **Phantom-Dependencies.** pnpm zeigt Pakete nur, wenn sie deklariert sind. Taucht
   ein "cannot resolve X" auf, obwohl X frueher ging: X war transitiv vorhanden und
   gehoert jetzt korrekt in die package.json (`pnpm add`), nicht ins Hoisting
   zurueckgebogen. In freshpost und home_dashboard war das je einmal der Fall.
3. **Build-Scripts sind per Default blockiert.** Nach einem Update kann
   `ERR_PNPM_IGNORED_BUILDS` erscheinen. Dann `pnpm approve-builds <paket>`
   ausfuehren; das schreibt die Freigabe nach `pnpm-workspace.yaml`.
