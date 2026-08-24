/** Datenschicht: Verarbeitung von members.json.
 *  Keine eingebauten Daten; alles kommt zur Laufzeit aus dem JSON. */
import type {
  ActiveMember, BodyConfig, BodyDef, CouncilData, Member, Party, SeatPair,
} from "./types";

/* ── Datums-Helfer ───────────────────────────────────── */

function parseDate(str?: string | null): Date | null {
  if (!str) return null;
  const p = str.split("-");
  return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
}

function isActiveOn(item: { from?: string; to?: string | null }, date: Date): boolean {
  const from = parseDate(item.from);
  const to = parseDate(item.to);
  if (from && date < from) return false;
  if (to && date >= to) return false;
  return true;
}

function getCurrentParty(member: Member, date: Date): string {
  if (member.partyHistory) {
    for (let i = member.partyHistory.length - 1; i >= 0; i--) {
      const h = member.partyHistory[i];
      const from = parseDate(h.from);
      const to = parseDate(h.to);
      if ((!from || date >= from) && (!to || date < to)) return h.party;
    }
  }
  return member.party;
}

/* ── Rohes JSON in den Datenbestand überführen ───────── */

export function processRawData(json: {
  parties: Party[];
  members: Member[];
  bodies: (BodyDef & { type: string })[];
  seatOrder?: string[];
  councilOrder?: string[];
}): CouncilData {
  const parties: Party[] = json.parties.map((p) => ({
    id: p.id, name: p.name, color: p.color, key: p.key || null,
  }));

  const members: Member[] = json.members.map((m) => {
    const out: Member = {
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      party: m.party,
      role: m.role,
      from: m.from,
      to: m.to || null,
    };
    if (m.partyHistory) out.partyHistory = m.partyHistory;
    if (m.title) out.title = m.title;
    return out;
  });

  const bodies: BodyDef[] = json.bodies
    .filter((b): b is BodyDef => b.type === "plenum" || b.type === "ausschuss")
    .map((b) => {
      const out: BodyDef = {
        id: b.id, name: b.name, shortName: b.shortName, type: b.type,
      };
      if (b.chair) out.chair = b.chair;
      if (b.chairSub) out.chairSub = b.chairSub;
      if (b.vicechairs) out.vicechairs = b.vicechairs;
      if (b.seats) {
        out.seats = b.seats.map((s) => ({ member: s.member, sub: s.sub || null }));
      }
      return out;
    });

  return {
    parties,
    members,
    bodies,
    seatOrder: json.seatOrder || [],
    councilOrder: json.councilOrder || [],
  };
}

/* ── Laufzeit-Helfer ─────────────────────────────────── */

export function getActiveMembers(members: Member[], date: Date): ActiveMember[] {
  return members
    .filter((m) => isActiveOn(m, date))
    .map((m) => ({ ...m, currentParty: getCurrentParty(m, date) }));
}

export function buildSeatOrder(
  councillors: ActiveMember[],
  seatOrder: string[],
  memberOrder: string[] = [],
): ActiveMember[] {
  const byId: Record<string, ActiveMember> = {};
  councillors.forEach((m) => { byId[m.id] = m; });

  const ordered: ActiveMember[] = [];
  const used = new Set<string>();

  // Explizite Reihenfolge einzelner Mitglieder hat Vorrang
  memberOrder.forEach((id) => {
    if (byId[id] && !used.has(id)) {
      ordered.push(byId[id]);
      used.add(id);
    }
  });

  // Rest: nach Partei gruppiert, darin alphabetisch
  const order = seatOrder.concat(["parteilos", "umb"]);
  order.forEach((pid) => {
    const group = councillors
      .filter((m) => m.party === pid && !used.has(m.id))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    group.forEach((m) => { ordered.push(m); used.add(m.id); });
  });

  councillors.forEach((m) => { if (!used.has(m.id)) ordered.push(m); });
  return ordered;
}

export function getBodyConfig(
  bodyDef: BodyDef | null | undefined,
  activeMembers: ActiveMember[],
): BodyConfig | null {
  if (!bodyDef) return null;
  const activeIds = new Set(activeMembers.map((m) => m.id));

  if (bodyDef.type === "plenum") {
    const councillors = activeMembers.filter((m) => m.role === "councillor");
    const mayor = activeMembers.find((m) => m.role === "mayor");
    return {
      id: bodyDef.id, name: bodyDef.name, shortName: bodyDef.shortName, type: "plenum",
      chairId: mayor ? mayor.id : null,
      seatPairs: councillors.map((m) => ({ regular: m.id, substitute: null, role: "member" })),
      allRegularIds: new Set(councillors.map((m) => m.id).concat(mayor ? [mayor.id] : [])),
      allSubstituteIds: new Set(),
    };
  }

  // Ausschuss
  const pairs: SeatPair[] = [];
  if (bodyDef.chair && activeIds.has(bodyDef.chair)) {
    pairs.push({
      regular: bodyDef.chair,
      substitute: bodyDef.chairSub && activeIds.has(bodyDef.chairSub) ? bodyDef.chairSub : null,
      role: "chair",
    });
  }
  if (bodyDef.vicechairs) {
    bodyDef.vicechairs.forEach((vc) => {
      if (activeIds.has(vc.member)) {
        pairs.push({
          regular: vc.member,
          substitute: vc.sub && activeIds.has(vc.sub) ? vc.sub : null,
          role: "vicechair",
        });
      }
    });
  }
  if (bodyDef.seats) {
    bodyDef.seats.forEach((s) => {
      if (activeIds.has(s.member)) {
        pairs.push({
          regular: s.member,
          substitute: s.sub && activeIds.has(s.sub) ? s.sub : null,
          role: "member",
        });
      }
    });
  }

  const regIds = new Set<string>();
  const subIds = new Set<string>();
  pairs.forEach((p) => {
    regIds.add(p.regular);
    if (p.substitute) subIds.add(p.substitute);
  });

  return {
    id: bodyDef.id, name: bodyDef.name, shortName: bodyDef.shortName, type: bodyDef.type,
    chairId: bodyDef.chair || null,
    seatPairs: pairs,
    allRegularIds: regIds,
    allSubstituteIds: subIds,
  };
}

export function getParty(parties: Party[], id: string): Party {
  return parties.find((p) => p.id === id) || { id, name: id, color: "#999999", key: null };
}
