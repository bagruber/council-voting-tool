/** Reine Logik ohne React: Formatierung, Tastatur-Belegung, Sitz- und
 *  Anwesenheitsableitungen, Protokolltext und Export-Strukturen. */
import JSZip from "jszip";
import { getParty } from "./data";
import type {
  ActiveMember, BodyConfig, LogEntry, MemberLookup, Party,
  PresenceEvent, SeatState, SessionMode, SessionState, TenantConfig, VoteRecord,
} from "./types";

/* ── Kleinkram ───────────────────────────────────────── */

export function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}
export function ts(): string { return new Date().toISOString(); }
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function contrastText(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#2D2D2D" : "#FFFFFF";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function download(content: string, filename: string, type: string): void {
  downloadBlob(new Blob([content], { type }), filename);
}

/* Das Backend liegt unter derselben Domain wie das Tool. Auf dem
   GitHub-Pages-Spiegel gibt es keines — dort erscheint das
   Übermitteln-Feld gar nicht erst, statt einen Knopf anzubieten,
   der nur scheitern kann. */
export const SAVE_ENDPOINT: string | null = (() => {
  const h = location.hostname;
  const reachable = h.endsWith("moosburg.eu") || h === "localhost" || h === "127.0.0.1";
  return reachable ? "/api/sessions" : null;
})();

/* ── Backup ──────────────────────────────────────────────
   Ein Slot je Mandant. Der alte, mandantenlose Schlüssel wird beim Lesen
   weiter berücksichtigt, damit eine Sitzung aus der Vorgänger-Version
   nach dem Update noch wiederherstellbar ist. */
const LEGACY_BACKUP_KEY = "council-session-backup";

export interface BackupData {
  state: SessionState;
  memberLookup: MemberLookup;
  bodyName: string;
  activeMembers: Pick<ActiveMember, "id" | "firstName" | "lastName" | "currentParty">[];
}

function backupKey(tenantId: string): string {
  return LEGACY_BACKUP_KEY + ":" + tenantId;
}

export function readBackup(tenantId: string): BackupData | null {
  try {
    const saved = localStorage.getItem(backupKey(tenantId)) || localStorage.getItem(LEGACY_BACKUP_KEY);
    return saved ? (JSON.parse(saved) as BackupData) : null;
  } catch {
    return null;
  }
}

export function writeBackup(tenantId: string, data: BackupData): void {
  try { localStorage.setItem(backupKey(tenantId), JSON.stringify(data)); } catch { /* voll oder gesperrt */ }
}

export function clearBackup(tenantId: string): void {
  try {
    localStorage.removeItem(backupKey(tenantId));
    localStorage.removeItem(LEGACY_BACKUP_KEY);
  } catch { /* egal */ }
}

/* ── Tastatur ─────────────────────────────────────────── */

/* Die Fraktionen besitzen den Buchstaben-Namensraum. Jede erklärt ihren
   key in members.json — der natürliche Anfangsbuchstabe (fresh F, Freie
   Wähler W) — deshalb braucht das Kürzel keinen Hinweis in der Oberfläche.
   Befehle nehmen, was übrig bleibt; darum liegt "neue Abstimmung" auf "+":
   außerhalb der Buchstaben, keine Partei kann es je beanspruchen. */
export interface Keymap {
  parties: Record<string, string>;
  commands: { newVote: string | null; bulkYes: string | null; bulkNo: string | null; help: string | null };
}

export function buildKeymap(partyIds: string[], parties: Party[]): Keymap {
  const taken = new Set<string>();
  const partyKeys: Record<string, string> = {};

  partyIds.forEach((pid) => {
    const party = getParty(parties, pid);
    const declared = (party.key || "").toLowerCase();
    if (declared && !taken.has(declared)) { partyKeys[pid] = declared; taken.add(declared); return; }
    // Ohne erklärten key: Wortanfänge, dann irgendein Buchstabe.
    const name = (party.name || pid).toLowerCase();
    const candidates = name.split(/\s+/).map((w) => w.charAt(0)).concat([...name]);
    for (const ch of candidates) {
      if (ch >= "a" && ch <= "z" && !taken.has(ch)) { partyKeys[pid] = ch; taken.add(ch); break; }
    }
  });

  const pick = (prefs: string[]): string | null => {
    for (const k of prefs) if (!taken.has(k)) { taken.add(k); return k; }
    return null;
  };
  return {
    parties: partyKeys,
    commands: {
      newVote: pick(["+"]),
      bulkYes: pick(["j", "y"]),
      bulkNo: pick(["n", "x"]),
      help: pick(["?"]),
    },
  };
}

export function commandShortcuts(cmd: Keymap["commands"]): { key: string; label: string }[] {
  return [
    { key: cmd.newVote, label: "Neue Abstimmung starten" },
    { key: cmd.bulkYes ? cmd.bulkYes.toUpperCase() : null, label: "Alle Ja" },
    { key: cmd.bulkNo ? cmd.bulkNo.toUpperCase() : null, label: "Alle Nein" },
    { key: "↵", label: "Abstimmung speichern" },
    { key: "Esc", label: "Dialog schließen / Abstimmung abbrechen" },
    { key: cmd.help, label: "Diese Übersicht" },
  ].filter((s): s is { key: string; label: string } => !!s.key);
}

/* ── Abgeleitete Zustände ────────────────────────────── */

export function getPresentIds(
  seatStates: Record<string, SeatState>,
  bodyConfig: BodyConfig | null,
): Set<string> {
  const s = new Set<string>();
  if (!bodyConfig) return s;
  if (bodyConfig.type === "plenum") {
    Object.entries(seatStates).forEach(([id, st]) => { if (st === "present") s.add(id); });
  } else {
    bodyConfig.seatPairs.forEach((p) => {
      const st = seatStates[p.regular] || "regular";
      if (st === "regular") s.add(p.regular);
      else if (st === "substitute" && p.substitute) s.add(p.substitute);
    });
  }
  return s;
}

export interface SeatInfo {
  eligible: boolean;
  active: boolean;
  role: "chair" | "vicechair" | "member" | "substitute" | "none";
  substituteFor: string | null;
}

export function getSeatInfo(
  memberId: string,
  bodyConfig: BodyConfig | null,
  seatStates: Record<string, SeatState>,
): SeatInfo {
  if (!bodyConfig) return { eligible: false, active: false, role: "none", substituteFor: null };
  if (bodyConfig.type === "plenum") {
    return { eligible: true, active: seatStates[memberId] === "present", role: "member", substituteFor: null };
  }
  const regPair = bodyConfig.seatPairs.find((p) => p.regular === memberId);
  if (regPair) {
    const st = seatStates[regPair.regular] || "regular";
    return { eligible: true, active: st === "regular", role: regPair.role || "member", substituteFor: null };
  }
  const subPair = bodyConfig.seatPairs.find((p) => p.substitute === memberId);
  if (subPair) {
    const st = seatStates[subPair.regular] || "regular";
    return { eligible: true, active: st === "substitute", role: "substitute", substituteFor: subPair.regular };
  }
  return { eligible: false, active: false, role: "none", substituteFor: null };
}

/* Die Bezeichnungen sind Mandanten-Sache: Stadtrat oder Gemeinderat,
   Bürgermeister/in oder ein anderer Vorsitz-Titel. */
export function getMemberRoleText(
  member: ActiveMember,
  bodyConfig: BodyConfig,
  seatInfo: SeatInfo,
  begriffe: TenantConfig["begriffe"],
): string {
  if (bodyConfig.type === "plenum") {
    if (member.role === "mayor") return member.title || begriffe.vorsitz;
    return member.title ? begriffe.mitglied + " · " + member.title : begriffe.mitglied;
  }
  if (!seatInfo.eligible) return "—";
  if (seatInfo.role === "chair") return "Vorsitz";
  if (seatInfo.role === "vicechair") return "Stellv. Vorsitz";
  if (seatInfo.role === "substitute") return "Stellvertretung";
  return "Mitglied";
}

export function classifyAbsence(
  memberId: string,
  voteTimestamp: string,
  presenceHistory: Record<string, PresenceEvent[]>,
): "short" | "general" {
  const h = presenceHistory[memberId] || [];
  const wasPresentBefore = h.some((e) => e.state === "present" && e.ts <= voteTimestamp);
  const wasPresentAfter = h.some((e) => e.state === "present" && e.ts > voteTimestamp);
  return wasPresentBefore && wasPresentAfter ? "short" : "general";
}

/* Zwei Ratsmitglieder können denselben Nachnamen tragen — Karin Linz (CSU)
   und Kilian Linz (Grüne) sitzen beide in diesem Rat, und schlichte
   Initialen machen aus beiden "KL". Wo ein Nachname doppelt vorkommt,
   verlängert der kürzeste unterscheidende Vornamen-Präfix Label und Kreis. */
export interface SeatNames { label: string; initials: string }

export function buildSeatNames(members: ActiveMember[]): Record<string, SeatNames> {
  const bySurname: Record<string, ActiveMember[]> = {};
  members.forEach((m) => { (bySurname[m.lastName] = bySurname[m.lastName] || []).push(m); });

  const out: Record<string, SeatNames> = {};
  members.forEach((m) => {
    const group = bySurname[m.lastName];
    if (group.length === 1) {
      out[m.id] = { label: m.lastName, initials: m.firstName.charAt(0) + m.lastName.charAt(0) };
      return;
    }
    const clashes = (n: number) => group.some((o) =>
      o.id !== m.id && o.firstName.slice(0, n).toLowerCase() === m.firstName.slice(0, n).toLowerCase());
    let n = 1;
    while (n < m.firstName.length && clashes(n)) n++;
    const prefix = m.firstName.slice(0, n);
    out[m.id] = { label: prefix + ". " + m.lastName, initials: prefix + m.lastName.charAt(0) };
  });
  return out;
}

export function getLabelPlacement(x: number, y: number): "above" | "left" | "right" {
  const dx = x - 50;
  if (y > 70) return dx >= 0 ? "right" : "left";
  if (Math.abs(dx) > 12) return dx > 0 ? "right" : "left";
  if (y < 30) return "above";
  return dx >= 0 ? "right" : "left";
}

/* Kanonische deutsche Formulierung eines Log-Eintrags. Bildschirm-Protokoll
   und TXT/MD-Export lesen beide von hier, damit der Wortlaut nicht
   auseinanderläuft. null für Einträge ohne erzählende Zeile. */
export function logEntryText(entry: LogEntry): string | null {
  const p = entry.payload as any;
  switch (entry.type) {
    case "presence_change":
      if (!p) return null;
      return p.newState === "present"
        ? p.memberName + " ist der Sitzung beigetreten"
        : p.memberName + " hat die Sitzung verlassen";
    case "vote": {
      if (!p) return null;
      let s = "Abstimmung: " + p.title;
      if (p.agendaItem) s += " (" + p.agendaItem + ")";
      s += " – " + (p.result.passed ? "angenommen" : "abgelehnt") +
        " (" + p.result.yes + " Ja, " + p.result.no + " Nein" +
        (p.result.absent ? ", " + p.result.absent + " Abwesend" : "") + ")";
      return s;
    }
    case "session_end": return "Sitzung beendet";
    case "session_pause": return "Sitzung unterbrochen";
    case "session_resume": return "Sitzung fortgesetzt";
    case "session_public": return "Öffentlicher Teil";
    case "session_nonpublic": return "Nichtöffentlicher Teil";
    default: return null;
  }
}

/* ── Lesbares Protokoll ──────────────────────────────── */

export function generateHumanProtocol(state: SessionState, bodyName: string): string {
  let t = "";
  t += "SITZUNGSPROTOKOLL\n==================\n\n";
  t += state.session.title + "\n";
  t += "Datum: " + fmtDate(state.session.date) + "\n";
  t += "Ort:   " + state.session.location + "\n";
  t += "Gremium: " + bodyName + "\n\n";

  const startEntry = state.log.find((e) => e.type === "session_start");
  if (startEntry && startEntry.payload) {
    const p = startEntry.payload as any;
    t += "ANWESENHEIT ZU BEGINN (" + fmtTime(startEntry.timestamp) + ")\n";
    t += "Anwesend (" + p.presentCount + "):\n";
    p.presentNames.forEach((n: string) => { t += "  " + n + "\n"; });
    if (p.absentCount > 0) {
      t += "Abwesend (" + p.absentCount + "):\n";
      p.absentNames.forEach((n: string) => { t += "  " + n + "\n"; });
    }
    t += "\n";
  }

  t += "VERLAUF\n-------\n\n";
  state.log.forEach((entry) => {
    const text = logEntryText(entry);
    if (text) t += fmtTime(entry.timestamp) + "  " + text + "\n";
  });

  if (state.votes.length) {
    t += "\nABSTIMMUNGEN (DETAIL)\n---------------------\n\n";
    state.votes.forEach((v, i) => {
      t += (i + 1) + ". " + v.title + "\n";
      if (v.agendaItem) t += "   TOP: " + v.agendaItem + "\n";
      t += "   Ergebnis: " + v.result.yes + " Ja, " + v.result.no + " Nein";
      if (v.result.absent) t += ", " + v.result.absent + " Abwesend";
      t += " – " + (v.result.passed ? "angenommen" : "abgelehnt") + "\n";
      if (v.comment) t += "   Kommentar: " + v.comment + "\n";
      if (v.yesVoters.length) { t += "   Ja (" + v.yesVoters.length + "):\n"; v.yesVoters.forEach((n) => { t += "     " + n + "\n"; }); }
      if (v.noVoters.length) { t += "   Nein (" + v.noVoters.length + "):\n"; v.noVoters.forEach((n) => { t += "     " + n + "\n"; }); }
      if (v.absentVoters.length) { t += "   Abwesend (" + v.absentVoters.length + "):\n"; v.absentVoters.forEach((n) => { t += "     " + n + "\n"; }); }
      t += "\n";
    });
  }
  return t;
}

/* ── Export-Strukturen ───────────────────────────────── */

export function buildPresenceJSON(state: SessionState, memberLookup: MemberLookup) {
  const entries: { id: string; name: string; verlauf: { status: string; zeit: string }[] }[] = [];
  Object.entries(state.presenceHistory).forEach(([id, history]) => {
    const name = memberLookup[id] || id;
    const verlauf = history.map((h) => ({
      status: h.state === "present" ? "anwesend" : "abwesend",
      zeit: fmtTime(h.ts),
    }));
    entries.push({ id, name, verlauf });
  });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function buildVoteJSON(vote: VoteRecord, presenceHistory: Record<string, PresenceEvent[]>) {
  const shortAbsent: string[] = [];
  const generalAbsent: string[] = [];
  if (vote.absentVoters) {
    vote.absentVoters.forEach((name) => {
      const id = Object.entries(vote.memberNames || {}).find(([, n]) => n === name)?.[0];
      if (id) {
        const type = classifyAbsence(id, vote.timestamp, presenceHistory);
        (type === "short" ? shortAbsent : generalAbsent).push(name);
      } else {
        generalAbsent.push(name);
      }
    });
  }
  return {
    titel: vote.title, top: vote.agendaItem || "", kommentar: vote.comment || "",
    ergebnis: { ja: vote.result.yes, nein: vote.result.no, abwesend: vote.result.absent, angenommen: vote.result.passed },
    ja: vote.yesVoters || [], nein: vote.noVoters || [],
    kurzzeitig_abwesend: shortAbsent.sort(), abwesend: generalAbsent.sort(),
  };
}

/* Eine Hälfte der Sitzung als schlichtes Objekt. Trägt sowohl die beiden
   JSON-Dateien im ZIP als auch — nur für den öffentlichen Teil — den
   Upload nach moosburg.eu/api/sessions. Eine Quelle für beides, damit
   Datei und Serverstand nicht auseinanderlaufen können. */
export function buildPartJSON(
  state: SessionState, memberLookup: MemberLookup, bodyName: string, mode: SessionMode,
) {
  return {
    sitzung: {
      titel: state.session.title, datum: state.session.date,
      ort: state.session.location, gremium: bodyName,
    },
    anwesenheit: buildPresenceJSON(state, memberLookup),
    teil: mode === "public" ? "öffentlich" : "nichtöffentlich",
    abstimmungen: state.votes
      .filter((v) => v.mode === mode)
      .map((v) => buildVoteJSON(v, state.presenceHistory)),
  };
}

/* Das volle ZIP-Paket: lesbares Protokoll plus die öffentlichen und
   nichtöffentlichen Abstimmungen in getrennten Dateien. Genutzt vom
   Export-Panel und vom Wiederherstellungs-Dialog. */
export function buildZipBlob(
  state: SessionState, memberLookup: MemberLookup, bodyName: string,
): Promise<Blob> {
  const zip = new JSZip();
  zip.file("protokoll.txt", generateHumanProtocol(state, bodyName));
  zip.file("oeffentlich.json",
    JSON.stringify(buildPartJSON(state, memberLookup, bodyName, "public"), null, 2));
  zip.file("nichtoeffentlich.json",
    JSON.stringify(buildPartJSON(state, memberLookup, bodyName, "nonpublic"), null, 2));

  return zip.generateAsync({ type: "blob" });
}
