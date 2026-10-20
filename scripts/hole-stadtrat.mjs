// Erzeugt public/tenants/moosburg/members.json als Kopie der Datenautorität
// bagruber/council (Geschwister-Checkout erwartet unter ../council). Seit
// council members.json geteilt hat (06.10.2026), fasst die Kopie dessen
// members.json, parties.json und bodies.json zu einer Datei zusammen — in
// derselben Form, die das Tool live aus /stadtrat/data/ zusammensetzt. Sie ist
// der Rückfall, wenn das Tool die Live-Quelle nicht erreicht; übersetzt wird in
// beiden Fällen erst beim Laden (src/council.ts).
//
// Idempotent: der Stand im Herkunftskopf ist das letzte Commit-Datum der
// Quelldateien, nicht das Laufdatum. Ein zweiter Lauf ändert nichts.
//
//   node scripts/hole-stadtrat.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COUNCIL = path.resolve(ROOT, "..", "council");
const QUELLEN = ["data/members.json", "data/parties.json", "data/bodies.json"];
const ZIEL = path.join(ROOT, "public", "tenants", "moosburg", "members.json");

const [members, parteien, bodies] = QUELLEN.map((q) =>
  JSON.parse(fs.readFileSync(path.join(COUNCIL, q), "utf8")));

const stand = execFileSync(
  "git", ["-C", COUNCIL, "log", "-1", "--format=%cs", "--", ...QUELLEN],
  { encoding: "utf8" },
).trim();
if (!/^\d{4}-\d{2}-\d{2}$/.test(stand)) {
  throw new Error("Kein Commit-Datum für die Quelle gefunden: " + stand);
}

const kopie = {
  _herkunft: {
    quelle: "bagruber/council · " + QUELLEN.join(", "),
    stand,
    skript: "scripts/hole-stadtrat.mjs",
    hinweis: "GENERIERT, nicht von Hand ändern. Neu erzeugen: node scripts/hole-stadtrat.mjs",
  },
  ...parteien,
  members,
  bodies,
};

fs.writeFileSync(ZIEL, JSON.stringify(kopie, null, 2) + "\n");
console.log("geschrieben:", path.relative(ROOT, ZIEL), "· Stand", stand);
