/** Domänenmodell. Deckt das members.json-Format ab, das auch
 *  bagruber/council verwendet, plus den Sitzungszustand des Reducers. */

export interface Party {
  id: string;
  name: string;
  color: string;
  key: string | null;
}

export interface PartyHistoryEntry {
  party: string;
  from?: string;
  to?: string | null;
}

export interface Member {
  id: string;
  firstName: string;
  lastName: string;
  party: string;
  role: "mayor" | "councillor";
  from?: string;
  to?: string | null;
  partyHistory?: PartyHistoryEntry[];
  title?: string;
}

/** Ein Mitglied mit der am Stichtag gültigen Partei. */
export interface ActiveMember extends Member {
  currentParty: string;
}

export interface Vicechair {
  member: string;
  sub?: string;
}

export interface BodyDef {
  id: string;
  name: string;
  shortName?: string;
  type: "plenum" | "ausschuss";
  chair?: string;
  chairSub?: string;
  vicechairs?: Vicechair[];
  seats?: { member: string; sub: string | null }[];
}

export interface CouncilData {
  parties: Party[];
  members: Member[];
  bodies: BodyDef[];
  seatOrder: string[];
  councilOrder: string[];
}

export type SeatRole = "chair" | "vicechair" | "member";

export interface SeatPair {
  regular: string;
  substitute: string | null;
  role: SeatRole;
}

export interface BodyConfig {
  id: string;
  name: string;
  shortName?: string;
  type: "plenum" | "ausschuss";
  chairId: string | null;
  seatPairs: SeatPair[];
  allRegularIds: Set<string>;
  allSubstituteIds: Set<string>;
}

/** plenum: present/absent · ausschuss: regular/substitute/empty */
export type SeatState = "present" | "absent" | "regular" | "substitute" | "empty";

export type VoteValue = "yes" | "no" | "absent";

export interface CurrentVote {
  id: string;
  title: string;
  agendaItem: string;
  comment: string;
  votes: Record<string, VoteValue>;
  memberNames: Record<string, string>;
}

export interface VoteResult {
  yes: number;
  no: number;
  absent: number;
  eligible: number;
  passed: boolean;
}

export interface VoteRecord {
  id: string;
  timestamp: string;
  title: string;
  agendaItem: string;
  comment: string;
  votes: Record<string, VoteValue>;
  memberNames: Record<string, string>;
  result: VoteResult;
  yesVoters: string[];
  noVoters: string[];
  absentVoters: string[];
  mode: SessionMode;
}

export type SessionMode = "public" | "nonpublic";
export type SessionStatus = "idle" | "active" | "paused" | "ended";

export type LogType =
  | "session_start" | "session_pause" | "session_resume" | "session_end"
  | "session_public" | "session_nonpublic" | "presence_change" | "vote";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
  /* je nach type: Anwesenheitsliste, VoteRecord oder nichts */
  payload: unknown;
  comment: string;
  mode: SessionMode;
}

export interface PresenceEvent {
  state: "present" | "absent";
  ts: string;
}

export interface AgendaItem {
  id: string;
  title: string;
}

export interface SessionState {
  bodyId: string;
  session: {
    id: string | null;
    title: string;
    date: string;
    location: string;
    status: SessionStatus;
    mode: SessionMode;
  };
  seatStates: Record<string, SeatState>;
  presenceHistory: Record<string, PresenceEvent[]>;
  currentVote: CurrentVote | null;
  votes: VoteRecord[];
  log: LogEntry[];
  agenda: AgendaItem[];
}

export type MemberLookup = Record<string, string>;

export type Action =
  | { type: "SELECT_BODY"; bodyId: string; bodyName: string }
  | { type: "INIT_SEATS"; bodyConfig: BodyConfig; activeMembers: ActiveMember[] }
  | { type: "SET_AGENDA"; items: string[] }
  | { type: "UPDATE_SESSION"; fields: Partial<SessionState["session"]> }
  | { type: "START_SESSION"; bodyConfig: BodyConfig; memberLookup: MemberLookup }
  | { type: "PAUSE_SESSION" }
  | { type: "RESUME_SESSION" }
  | { type: "END_SESSION" }
  | { type: "SET_MODE"; mode: SessionMode }
  | { type: "CYCLE_SEAT"; seatKey: string; bodyConfig: BodyConfig; memberLookup: MemberLookup }
  | { type: "START_VOTE"; presentIds: string[]; memberNames: Record<string, string>; agendaItem?: string }
  | { type: "UPDATE_VOTE"; fields: Partial<Pick<CurrentVote, "title" | "agendaItem" | "comment">> }
  | { type: "CAST_VOTE"; memberId: string }
  | { type: "BULK_VOTE"; value: "yes" | "no"; memberIds?: string[] }
  | { type: "CONFIRM_VOTE" }
  | { type: "CANCEL_VOTE" }
  | { type: "ADD_LOG_COMMENT"; logId: string; comment: string }
  | { type: "ADD_AGENDA"; title: string }
  | { type: "REMOVE_AGENDA"; id: string };

/* ── Mandanten ───────────────────────────────────────── */

/** Verweis auf die Datenautorität bagruber/council. Steht der Block in der
 *  Mandanten-Config, liegt members.json (live wie eingecheckt) im
 *  council-Rohformat und wird beim Laden übersetzt (src/council.ts). */
export interface StadtratQuelle {
  /** Live-Quelle, z. B. "/stadtrat/data/members.json" auf moosburg.eu. */
  url: string;
  /** Tastenkürzel je Partei-id; council kennt keine Kürzel. */
  tasten?: Record<string, string>;
  /** Parteien, die council nicht mehr führt, für historische Sitzordnungen. */
  seatOrderZusatz?: string[];
}

export interface TenantDemo {
  bodyId: string;
  date: string;
  title: string;
}

export interface TenantConfig {
  /** Name des Rats, z. B. "Stadtrat Moosburg a. d. Isar" */
  name: string;
  /** Browser-Titel */
  htmlTitle: string;
  sitzung: { titel: string; ort: string };
  /** Bezeichnungen im Plenum: "Stadtrat"/"Gemeinderat" und der Vorsitz. */
  begriffe: { mitglied: string; vorsitz: string };
  /** Ersetzt die --t-*-Farbwerte, Schlüssel wie in src/index.css. */
  farben?: Record<string, string>;
  /** Wenn gesetzt: members.json kommt aus bagruber/council, siehe StadtratQuelle. */
  stadtratQuelle?: StadtratQuelle;
  /** Ohne diesen Block gibt es für den Mandanten keinen Demo-Modus. */
  demo?: TenantDemo;
}

export interface Tenant {
  id: string;
  config: TenantConfig;
  data: CouncilData;
}
