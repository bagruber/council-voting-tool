/** Übernahme des council-Datenformats (bagruber/council, data/members.json).
 *  Der Stadtrats-Mandant liest seine Stammdaten möglichst live von
 *  /stadtrat/data/members.json und fällt auf die eingecheckte Kopie unter
 *  tenants/moosburg/members.json zurück; beide liegen im council-Rohformat
 *  und laufen durch diese Übersetzung (siehe loadTenant in tenant.ts).
 *
 *  Was übersetzt wird:
 *  - council führt das Mandatsende einschließlich (to = letzter Amtstag),
 *    dieses Tool ausschließlich (ab to inaktiv). Deshalb +1 Tag. Die
 *    partyHistory-Grenzen sind in council bereits ausschließlich.
 *  - Tastenkürzel je Partei kennt council nicht, sie kommen aus der
 *    Mandanten-Config (stadtratQuelle.tasten).
 *  - Die Plenums-Sitzordnung (councilOrder) ergibt sich aus der aktuellen
 *    Belegung der Plenumssitze; council führt sie je Sitz als occupants.
 *  - Gremien mit anderem type als plenum/ausschuss (Aufsichts- und
 *    Verwaltungsräte) sind keine Abstimmungsgremien und entfallen. */
import type { BodyDef, Member, Party, StadtratQuelle } from "./types";

export interface CouncilRawData {
  parties: { id: string; name: string; color: string }[];
  seatOrder?: string[];
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
  const councilOrder = (plenum?.seats ?? [])
    .map((s) => {
      const occupants = s.occupants ?? [];
      const aktuell = occupants.filter((o) => !o.to).at(-1) ?? occupants.at(-1);
      return aktuell?.member;
    })
    .filter((id): id is string => !!id);

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
