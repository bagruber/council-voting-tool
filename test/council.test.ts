/** ausMandaten leitet aus council's mandates die Felder ab, die die Übernahme
 *  liest. Die drei Fälle stammen aus den echten Daten und decken die Regeln
 *  ab: Berührung ist ein Wechsel, eine Lücke eine Unterbrechung. Am Umbau-Commit
 *  68ac352 ergab die Ableitung für 52 von 54 Mitgliedern Feld für Feld das alte
 *  Format; bei den übrigen zwei stand dort im Feld party noch die frühere Partei. */
import { describe, expect, it } from "vitest";
import { ausMandaten, type CouncilQuelle } from "../src/council";

const quelle: CouncilQuelle = {
  parties: [],
  bodies: [],
  members: [
    { id: "dollinger", firstName: "J.", lastName: "Dollinger", mandates: [
      { from: "2014-05-01", to: "2020-05-01", party: "fw", role: "councillor" },
      { from: "2020-05-01", to: "2025-01", party: "fw", role: "mayor" },
      { from: "2025-01", to: "2026-04-30", party: "parteilos", role: "mayor" },
    ] },
    { id: "hadersdorfer", firstName: "G.", lastName: "Hadersdorfer", mandates: [
      { from: "2014-05-01", to: "2017-10-06", party: "fw", role: "councillor" },
      { from: "2017-10-06", party: "csu", role: "councillor" },
    ] },
    { id: "marschoun", firstName: "C.", lastName: "Marschoun", mandates: [
      { from: "2014-05-01", to: "2020-04-30", party: "spd", role: "councillor" },
      { from: "2026-05-01", party: "spd", role: "councillor" },
    ] },
  ],
};

describe("ausMandaten", () => {
  const [dollinger, hadersdorfer, marschoun] = ausMandaten(quelle).members;

  it("nimmt Partei und Rolle aus dem letzten Abschnitt, Beginn und Ende aus erstem und letztem", () => {
    expect(dollinger).toMatchObject({ party: "parteilos", role: "mayor", from: "2014-05-01", to: "2026-04-30" });
    expect(hadersdorfer).toMatchObject({ party: "csu", from: "2014-05-01", to: null });
  });

  it("fasst Abschnitte derselben Partei zusammen, mit ausschließlichen Grenzen", () => {
    expect(dollinger.partyHistory).toEqual([
      { party: "fw", from: "2014-05-01", to: "2025-01" },
      { party: "parteilos", from: "2025-01", to: null },
    ]);
    expect(hadersdorfer.partyHistory).toEqual([
      { party: "fw", from: "2014-05-01", to: "2017-10-06" },
      { party: "csu", from: "2017-10-06", to: null },
    ]);
  });

  it("überbrückt eine Unterbrechung ohne Parteiwechsel, wie das Tool es schon vorher sah", () => {
    expect(marschoun).toMatchObject({ party: "spd", from: "2014-05-01", to: null });
    expect(marschoun.partyHistory).toBeUndefined();
  });
});
