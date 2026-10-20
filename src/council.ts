/** Übernahme des council-Datenformats (bagruber/council, data/).
 *  Der Stadtrats-Mandant liest seine Stammdaten möglichst live aus
 *  /stadtrat/data/ (members.json, parties.json, bodies.json) und fällt auf
 *  die eingecheckte Kopie tenants/moosburg/members.json zurück, die alle drei
 *  zusammenfasst. Beide laufen durch ausMandaten und diese Übersetzung (siehe
 *  loadTenant in tenant.ts).
 *
 *  Was übersetzt wird:
 *  - council führt das Mandatsende einschließlich (to = letzter Amtstag),
 *    dieses Tool ausschließlich (ab to inaktiv). Deshalb +1 Tag. Die
 *    partyHistory-Grenzen sind in council bereits ausschließlich.
 *  - Tastenkürzel je Partei kennt council nicht, sie kommen aus der
 *    Mandanten-Config (stadtratQuelle.tasten).
 *  - Die Sitzordnung im Kreis kommt als councilOrder aus council. Fehlt sie,
 *    bleibt die Belegung der Plenumssitze als Rückfall — die ist dort aber
 *    fürs zweireihige Halbrund sortiert und ergibt im Kreis keine Runde.
 *  - Gremien mit anderem type als plenum/ausschuss (Aufsichts- und
 *    Verwaltungsräte) sind keine Abstimmungsgremien und entfallen. */
import type { BodyDef, Member, Party, StadtratQuelle } from "./types";

export interface CouncilRawData {
  parties: { id: string; name: string; color: string }[];
  seatOrder?: string[];
  councilOrder?: string[];
  members: {
    id: string;
    firstName: string;
    lastName: string;
    party: string;
    role: "mayor" | "councillor";
    from?: string;
    to?: string | null;
    title?: string;
    partyHistory?: { party: string; from?: string; to?: string | null }[];
  }[];
  bodies: {
    id: string;
    name: string;
    shortName?: string;
    type: string;
    chair?: string | null;
    chairSub?: string;
    vicechairs?: { member: string; sub?: string }[];
    seats?: {
      member?: string;
      sub?: string | null;
      occupants?: { member: string; from?: string; to?: string | null }[];
    }[];
  }[];
}

/** Ein Abschnitt aus council's mandates (seit 06.10.2026). Berühren sich zwei
 *  (to des einen = from des nächsten), ist das ein Partei- oder Rollenwechsel;
 *  eine Lücke dazwischen ist eine Unterbrechung des Mandats. */
export interface CouncilMandat {
  from: string;
  to?: string | null;
  party: string;
  role: "mayor" | "councillor";
}

/** council's members.json, parties.json und bodies.json zusammengefasst. In
 *  dieser Form liegt auch die eingecheckte Kopie vor. */
export type CouncilQuelle = Omit<CouncilRawData, "members"> & {
  members: { id: string; firstName: string; lastName: string; title?: string; mandates: CouncilMandat[] }[];
};

/** Leitet aus den Mandaten die Felder ab, die fromCouncilFormat liest: Partei
 *  und Rolle des letzten Abschnitts, Beginn des ersten, Ende des letzten.
 *  partyHistory fasst aufeinanderfolgende Abschnitte derselben Partei zusammen,
 *  mit ausschließlichen Grenzen wie bisher. Unterbrechungen kennt das Tool
 *  nicht; es sah auch vor dem Umbau in council nur Beginn und Ende. */
export function ausMandaten(quelle: CouncilQuelle): CouncilRawData {
  const members = quelle.members.map((m) => {
    const erster = m.mandates[0];
    const letzter = m.mandates[m.mandates.length - 1];
    const parteien: { party: string; from: string; to: string | null }[] = [];
    for (const abschnitt of m.mandates) {
      const vorher = parteien.at(-1);
      if (vorher?.party === abschnitt.party) continue;
      if (vorher) vorher.to = abschnitt.from;
      parteien.push({ party: abschnitt.party, from: abschnitt.from, to: null });
    }
    return {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      party: letzter.party,
      role: letzter.role,
      from: erster.from,
      to: letzter.to ?? null,
      ...(m.title ? { title: m.title } : {}),
      ...(parteien.length > 1 ? { partyHistory: parteien } : {}),
    };
  });
  return { ...quelle, members };
}

export interface CouncilRawResult {
  parties: Party[];
  members: Member[];
  bodies: (BodyDef & { type: string })[];
  seatOrder: string[];
  councilOrder: string[];
}

export function fromCouncilFormat(raw: CouncilRawData, quelle: StadtratQuelle): CouncilRawResult {
  const tasten = quelle.tasten ?? {};
  const parties: Party[] = raw.parties.map((p) => ({
    id: p.id, name: p.name, color: p.color, key: tasten[p.id] ?? null,
  }));

  const basis = raw.seatOrder ?? [];
  const seatOrder = basis.concat(
    (quelle.seatOrderZusatz ?? []).filter((id) => !basis.includes(id)),
  );

  const plenum = raw.bodies.find((b) => b.type === "plenum");
  const ausSitzen = (plenum?.seats ?? [])
    .map((s) => {
      const occupants = s.occupants ?? [];
      const aktuell = occupants.filter((o) => !o.to).at(-1) ?? occupants.at(-1);
      return aktuell?.member;
    })
    .filter((id): id is string => !!id);
  const councilOrder = raw.councilOrder?.length ? raw.councilOrder : ausSitzen;

  const members: Member[] = raw.members.map((m) => {
    const out: Member = {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      party: m.party,
      role: m.role,
      from: m.from,
      to: mandatsendeExklusiv(m.to),
    };
    if (m.partyHistory) out.partyHistory = m.partyHistory;
    if (m.title) out.title = m.title;
    return out;
  });

  const bodies = raw.bodies
    .filter((b) => b.type === "plenum" || b.type === "ausschuss")
    .map((b) => {
      const out: BodyDef & { type: string } = {
        id: b.id, name: b.name, shortName: b.shortName, type: b.type as BodyDef["type"],
      };
      if (b.type === "ausschuss") {
        if (b.chair) out.chair = b.chair;
        if (b.chairSub) out.chairSub = b.chairSub;
        if (b.vicechairs) out.vicechairs = b.vicechairs;
        out.seats = (b.seats ?? []).flatMap((s) =>
          s.member ? [{ member: s.member, sub: s.sub ?? null }] : [],
        );
      }
      return out;
    });

  return { parties, members, bodies, seatOrder, councilOrder };
}

/** council: letzter Amtstag (einschließlich) → Tool: ab wann inaktiv (+1 Tag). */
function mandatsendeExklusiv(to?: string | null): string | null {
  if (!to) return null;
  const [j, m, t] = to.split("-").map(Number);
  const d = new Date(Date.UTC(j, (m || 1) - 1, (t || 1) + 1));
  return d.toISOString().slice(0, 10);
}
