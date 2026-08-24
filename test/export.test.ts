/** Der öffentliche Export ist die Schnittstelle zum Posteingang auf
 *  moosburg.eu (POST /api/sessions) und zum ZIP. Dieser Test friert die
 *  Struktur ein: ändert sich hier etwas, muss sich das Backend mitbewegen. */
import { describe, expect, it } from "vitest";
import { buildPartJSON } from "../src/logic";
import type { SessionState, VoteRecord } from "../src/types";

function vote(overrides: Partial<VoteRecord>): VoteRecord {
  return {
    id: "v1", timestamp: "2026-07-13T18:30:00.000Z", title: "Testbeschluss",
    agendaItem: "TOP 1", comment: "",
    votes: { a: "yes", b: "no", c: "absent" },
    memberNames: { a: "Aigner, Anna", b: "Berger, Bernd", c: "Cramer, Clara" },
    result: { yes: 1, no: 1, absent: 1, eligible: 2, passed: false },
    yesVoters: ["Aigner, Anna"], noVoters: ["Berger, Bernd"], absentVoters: ["Cramer, Clara"],
    mode: "public",
    ...overrides,
  };
}

const state: SessionState = {
  bodyId: "plenum",
  session: {
    id: "s1", title: "Stadtratssitzung", date: "2026-07-13",
    location: "Rathaus", status: "ended", mode: "public",
  },
  seatStates: {},
  presenceHistory: {
    a: [{ state: "present", ts: "2026-07-13T18:00:00.000Z" }],
    b: [{ state: "present", ts: "2026-07-13T18:00:00.000Z" }],
    // Clara war vor und nach der Abstimmung da: kurzzeitig abwesend.
    c: [
      { state: "present", ts: "2026-07-13T18:00:00.000Z" },
      { state: "absent", ts: "2026-07-13T18:20:00.000Z" },
      { state: "present", ts: "2026-07-13T18:40:00.000Z" },
    ],
  },
  currentVote: null,
  votes: [vote({}), vote({ id: "v2", title: "Interner Beschluss", mode: "nonpublic" })],
  log: [],
  agenda: [],
};

const lookup = { a: "Aigner, Anna", b: "Berger, Bernd", c: "Cramer, Clara" };

describe("buildPartJSON", () => {
  it("trägt die Felder, die der Posteingang erwartet", () => {
    const part = buildPartJSON(state, lookup, "Stadtrat", "public");
    expect(Object.keys(part).sort()).toEqual(["abstimmungen", "anwesenheit", "sitzung", "teil"]);
    expect(part.sitzung).toEqual({
      titel: "Stadtratssitzung", datum: "2026-07-13", ort: "Rathaus", gremium: "Stadtrat",
    });
    expect(part.teil).toBe("öffentlich");
  });

  it("filtert strikt nach Sitzungsteil", () => {
    const pub = buildPartJSON(state, lookup, "Stadtrat", "public");
    const non = buildPartJSON(state, lookup, "Stadtrat", "nonpublic");
    expect(pub.abstimmungen.map((a) => a.titel)).toEqual(["Testbeschluss"]);
    expect(non.abstimmungen.map((a) => a.titel)).toEqual(["Interner Beschluss"]);
  });

  it("unterscheidet kurzzeitige von genereller Abwesenheit", () => {
    const [a] = buildPartJSON(state, lookup, "Stadtrat", "public").abstimmungen;
    expect(a.kurzzeitig_abwesend).toEqual(["Cramer, Clara"]);
    expect(a.abwesend).toEqual([]);
    expect(a.ergebnis).toEqual({ ja: 1, nein: 1, abwesend: 1, angenommen: false });
  });
});
