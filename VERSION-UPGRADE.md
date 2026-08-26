# Versions-Update — council-voting-tool

*Briefing fuer eine eigene Claude-Code-Sitzung in diesem Repo. Angelegt 26.08.2026,
nach Welle 1 fortgeschrieben. Nach erledigtem Update loeschen.*

## Auftrag

Dieses Repo auf die Hausbasis ziehen, die ueber alle bagruber-Repos gilt. Der Zweck
ist nicht Aktualitaet um ihrer selbst willen: alle Repos teilen sich seit dem
26.08.2026 einen gemeinsamen pnpm-Store, und der dedupliziert exakt so weit, wie die
Versionen uebereinstimmen. Gemessen: ein Repo mit abweichenden Versionen kostet
~158 MB, ein Versions-Zwilling ~8 MB.

**Hier offen: Welle 2.**

| Welle | Repos | Stand |
|---|---|---|
| **1** — TypeScript + @types/node | dreizehn Repos | **erledigt 26.08.2026** |
| **2** — Vite 6 -> 8 | baumkarte, datahub, haushaltvis, moosburghistorisch, council-voting-tool, freshdoc, freshpost, transitmap, moosburg, moosburg-relaunch | offen |
| **3** — React 18 -> 19 | pridemap, dann etymology, dann home_dashboard | offen |
| **4** — Monorepo-Konflikt | sexdiary | offen |

## Bereits erledigt (26.08.2026)

**Welle 1 ist durch.** Dreizehn Repos stehen auf TypeScript ~7.0.2 und
@types/node ^26.3.0, alle Builds und Tests verifiziert gruen. TypeScript liegt
damit nur noch in einer Version im gemeinsamen Store statt in sechs; der
Store-Prune danach hat 797 MB freigegeben.

Zwei Breaking Changes von TypeScript 7 sind dabei aufgetreten:

- **`baseUrl` wurde entfernt** (Fehler TS5102). In sieben Repos stand
  `"baseUrl": "."` neben `"paths": { "@/*": ["./src/*"] }`. Loesung war,
  die `baseUrl`-Zeile ersatzlos zu streichen: TS 7 loest `paths` relativ zur
  tsconfig-Datei auf, die Pfade stimmen also unveraendert weiter.
- **`@types/*` wird nicht mehr automatisch in jeden Scope gezogen.** In
  haushaltvis nutzt eine Testdatei unter `src` `node:fs` und `__dirname`,
  wodurch TS2591 auftrat. Loesung war `"types": ["node"]` in der
  `tsconfig.app.json`.

Beides tritt in diesem Repo nicht mehr auf — hier nur als Kontext, falls beim
weiteren Hochziehen aehnliche Meldungen erscheinen.

## Hausbasis

| Paket | Zielversion | Stand |
|---|---|---|
| typescript | ~7.0.2 | **erledigt 26.08.2026** |
| @types/node | ^26.3.0 | **erledigt 26.08.2026** |
| vite | 8.x | offen (Welle 2) |
| react / react-dom | 19.2.x | offen (Welle 3) |
| tailwindcss | 4.x | offen (Welle 3) |
| react-router-dom | 7.x | offen (Welle 3) |
| vitest | 4.1.x | weitgehend erreicht |

## Noch zu tun in diesem Repo

| Paket | Ist | Ziel | Einordnung |
|---|---|---|---|
| `vite` | ^6.0.0 | ^8.x | Welle 2 — Build-Tool-Major |

## Besonderheit

Vite 6 -> 8 ist der letzte offene Punkt hier. anagram und learnfarsi laufen bereits auf Vite 8 mit demselben React-19-Stack — das Risiko ist damit belegt niedrig.

## Vorgehen

1. Ausgangslage sichern: der Build muss **vor** dem Update gruen sein. Ist er das
   nicht, zuerst das melden statt zu updaten.
2. Pakete einzeln oder in kleinen Gruppen hochziehen, nicht alle auf einmal. Nach
   jeder Gruppe bauen. Bricht etwas, ist die Ursache dann eindeutig.
3. Bei Majors (React, Vite, Tailwind) die jeweilige Migrations-Doku lesen, bevor die
   Version angefasst wird.
4. Zum Schluss `rm -rf node_modules && pnpm install` und `pnpm store prune`,
   sonst bleibt die alte Version im Store liegen (s. Fallstrick 4).

## Verifikation

```bash
pnpm run build
pnpm run test
```

Alle davon muessen gruen sein.

## Fallstricke aus der pnpm-Migration (26.08.2026)

1. **Ein Lockfile-Wechsel ist ein Update.** `pnpm install` loest Ranges neu auf.
   In moosburg brach ein reiner Patch-Sprung `react-map-gl 8.1.1 -> 8.1.2` den
   `maxBounds`-Typ. Bricht nach einem Update etwas: erst pruefen, welche Version
   vorher im Lockfile stand, bevor die eigene Codebasis verdaechtigt wird.
2. **Phantom-Dependencies.** pnpm zeigt Pakete nur, wenn sie deklariert sind. Taucht
   ein "cannot resolve X" auf, obwohl X frueher ging: X war transitiv vorhanden und
   gehoert jetzt korrekt in die package.json (`pnpm add`), nicht ins Hoisting
   zurueckgebogen. In freshpost und home_dashboard war das je einmal der Fall.
3. **Build-Scripts sind per Default blockiert.** Nach einem Update kann
   `ERR_PNPM_IGNORED_BUILDS` erscheinen. Dann `pnpm approve-builds <paket>`
   ausfuehren; das schreibt die Freigabe nach `pnpm-workspace.yaml`.
4. **Alte Versionen bleiben nach einem Upgrade liegen.** Weder `pnpm install` noch
   `pnpm prune` raeumt den alten Eintrag aus `node_modules/.pnpm`. Erst
   `rm -rf node_modules && pnpm install`, dann `pnpm store prune` gibt den
   Platz wirklich frei. Sonst bleibt der Dedup-Gewinn auf dem Papier.
