// Erzeugt public/tenants/moosburg/members.json als Kopie der Datenautorität
// bagruber/council (data/members.json, Geschwister-Checkout erwartet unter
// ../council). Die Kopie bleibt im council-Rohformat und ist der Rückfall,
// wenn das Tool die Live-Quelle /stadtrat/data/members.json nicht erreicht;
// übersetzt wird in beiden Fällen erst beim Laden (src/council.ts).
//
// Idempotent: der Stand im Herkunftskopf ist das letzte Commit-Datum der
// Quelldatei, nicht das Laufdatum. Ein zweiter Lauf ändert nichts.
//
//   node scripts/hole-stadtrat.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COUNCIL = path.resolve(ROOT, "..", "council");
const QUELLE = path.join(COUNCIL, "data", "members.json");
const ZIEL = path.join(ROOT, "public", "tenants", "moosburg", "members.json");

const daten = JSON.parse(fs.readFileSync(QUELLE, "utf8"));

const stand = execFileSync(
  "git", ["-C", COUNCIL, "log", "-1", "--format=%cs", "--", "data/members.json"],
  { encoding: "utf8" },
).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(stand)) {
  throw new Error("Kein Commit-Datum für die Quelle gefunden: " + stand);
}

const kopie = {
  _herkunft: {
    quelle: "bagruber/council · data/members.json",
    stand,
    skript: "scripts/hole-stadtrat.mjs",
    hinweis: "GENERIERT, nicht von Hand ändern. Neu erzeugen: node scripts/hole-stadtrat.mjs",
  },
  ...daten,
};

fs.writeFileSync(ZIEL, JSON.stringify(kopie, null, 2) + "\n");
console.log("geschrieben:", path.relative(ROOT, ZIEL), "· Stand", stand);
