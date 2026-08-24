import {
  useCallback, useEffect, useMemo, useReducer, useRef, useState,
  type Dispatch,
} from "react";
import { buildSeatOrder, getActiveMembers, getBodyConfig, getParty } from "./data";
import {
  SAVE_ENDPOINT, buildKeymap, buildPartJSON, buildZipBlob, clearBackup,
  commandShortcuts, contrastText, download, downloadBlob, fmtDate, fmtTime,
  generateHumanProtocol, getLabelPlacement, getMemberRoleText, getPresentIds,
  getSeatInfo, logEntryText, buildSeatNames, readBackup, writeBackup,
  type BackupData, type Keymap, type SeatInfo, type SeatNames,
} from "./logic";
import { buildInitialState, reducer } from "./reducer";
import { DEMO_STEPS } from "./demo";
import { agendaUrl, applyTenantChrome, loadTenant, tenantIdFromUrl } from "./tenant";
import type {
  Action, ActiveMember, BodyConfig, BodyDef, CouncilData, CurrentVote,
  LogEntry, MemberLookup, SessionState, Tenant, TenantConfig, VoteValue,
} from "./types";

/* Der Demo-Modus läuft über denselben Reducer wie eine echte Sitzung und
   darf deshalb deren Backup-Slot weder beschreiben noch wiederherstellen. */
const DEMO_MODE = new URLSearchParams(location.search).has("demo");

/* ── Tastatur-Hook ────────────────────────────────────── */
/* Die Handler werden über eine Ref gelesen: der Listener bindet einmal und
   sieht trotzdem frischen Zustand. Buchstaben pausieren, solange ein Feld
   den Fokus hat; Enter und Escape arbeiten dort weiter, wo sie hingehören. */
interface HotkeyHandlers {
  onKey?: (key: string) => boolean;
  onSave?: () => boolean;
  onCancel?: () => void;
}

function useHotkeys(handlers: HotkeyHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t ? t.tagName : "";
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable);
      const h = ref.current;

      if (e.key === "Escape") { h.onCancel && h.onCancel(); return; }
      // Buttons, Links und die Tagesordnungs-Textarea besitzen Enter selbst.
      if (e.key === "Enter" && tag !== "TEXTAREA" && tag !== "BUTTON" && tag !== "A") {
        if (h.onSave && h.onSave()) e.preventDefault();
        return;
      }
      if (typing) return;

      if (e.key.length === 1 && h.onKey && h.onKey(e.key.toLowerCase())) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/* Ein Sitz-Klick wirkt immer auf den Sitzschlüssel des ordentlichen
   Mitglieds, auch wenn die Stellvertretung angeklickt wurde. Geteilt von
   Kreis und Karten. */
function usePresenceToggle(bodyConfig: BodyConfig, dispatch: Dispatch<Action>, memberLookup: MemberLookup) {
  return useCallback((id: string) => {
    if (bodyConfig.type !== "plenum") {
      const pair = bodyConfig.seatPairs.find((p) => p.substitute === id);
      if (pair) { dispatch({ type: "CYCLE_SEAT", seatKey: pair.regular, bodyConfig, memberLookup }); return; }
    }
    dispatch({ type: "CYCLE_SEAT", seatKey: id, bodyConfig, memberLookup });
  }, [bodyConfig, dispatch, memberLookup]);
}

/* ── Kopf ─────────────────────────────────────────────── */

function BodySelector({ bodyId, bodies, onChange }: {
  bodyId: string; bodies: BodyDef[]; onChange: (id: string) => void;
}) {
  return (
    <select value={bodyId} onChange={(e) => onChange(e.target.value)}
      className="bg-white/20 border border-white/30 rounded-lg px-3 py-2 font-serif font-bold text-white focus:outline-none focus:ring-2 focus:ring-white/50">
      {bodies.map((b) => <option key={b.id} value={b.id} className="text-tx bg-surface">{b.shortName || b.name}</option>)}
    </select>
  );
}

function SessionControls({ session, dispatch, bodyConfig, memberLookup }: {
  session: SessionState["session"]; dispatch: Dispatch<Action>;
  bodyConfig: BodyConfig; memberLookup: MemberLookup;
}) {
  const { status, mode } = session;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "idle" && (
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light transition-colors shadow"
          data-demo="open"
          onClick={() => dispatch({ type: "START_SESSION", bodyConfig, memberLookup })}>Sitzung eröffnen</button>
      )}
      {status === "active" && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-yellow-300 text-yellow-900 hover:bg-yellow-200 shadow"
          onClick={() => dispatch({ type: "PAUSE_SESSION" })}>Unterbrechen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 shadow border border-red-200"
          data-demo="end"
          onClick={() => dispatch({ type: "END_SESSION" })}>Beenden</button>
      </>}
      {status === "paused" && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light shadow"
          onClick={() => dispatch({ type: "RESUME_SESSION" })}>Fortsetzen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 shadow border border-red-200"
          data-demo="end"
          onClick={() => dispatch({ type: "END_SESSION" })}>Beenden</button>
      </>}
      {(status === "active" || status === "paused") && (
        <button className={"px-4 py-2 rounded-lg font-semibold text-sm shadow " +
          (mode === "public" ? "bg-white/80 text-tx" : "bg-gray-700 text-white")}
          data-demo="nonpublic"
          onClick={() => dispatch({ type: "SET_MODE", mode: mode === "public" ? "nonpublic" : "public" })}>
          {mode === "public" ? "Öffentlich" : "Nichtöffentlich"}
        </button>
      )}
      {status === "ended" && <span className="text-white/70 font-serif italic">Sitzung beendet</span>}
    </div>
  );
}

function SessionHeader({ session, bodyId, bodies, dispatch, bodyConfig, memberLookup, onShowHelp }: {
  session: SessionState["session"]; bodyId: string; bodies: BodyDef[];
  dispatch: Dispatch<Action>; bodyConfig: BodyConfig; memberLookup: MemberLookup;
  onShowHelp: () => void;
}) {
  return (
    <header className="bg-gradient-to-r from-primary-dark to-primary text-white px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <BodySelector bodyId={bodyId} bodies={bodies} onChange={(id) => {
            const b = bodies.find((x) => x.id === id);
            dispatch({ type: "SELECT_BODY", bodyId: id, bodyName: b ? b.name : "" });
          }} />
          <div>
            <h1 className="font-serif font-bold text-lg leading-tight">{session.title}</h1>
            <p className="text-sm opacity-90">{fmtDate(session.date)} &middot; {session.location}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SessionControls session={session} dispatch={dispatch} bodyConfig={bodyConfig} memberLookup={memberLookup} />
          <button type="button" onClick={onShowHelp}
            className="w-9 h-9 flex-shrink-0 rounded-lg border border-white/40 font-bold hover:bg-white/15"
            aria-label="Bedienung und Tastaturkürzel anzeigen" title="Bedienung (?)">?</button>
        </div>
      </div>
    </header>
  );
}

/* ── Sitzkreis ────────────────────────────────────────── */

function SeatCircle({ member, names, partyColor, seatInfo, voting, voteValue, onPresence, onVote, labelPlacement }: {
  member: ActiveMember; names: SeatNames; partyColor: string; seatInfo: SeatInfo;
  voting: boolean; voteValue: VoteValue | undefined;
  onPresence: (id: string) => void; onVote: (id: string) => void;
  labelPlacement?: string;
}) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isAbsentInVote = voting && voteValue === "absent";
  // Solange eine Abstimmung offen ist, stimmt der Sitz ab — das meint fast
  // jeder Klick in dieser Phase. Anwesenheit wandert zu den Karten unten.
  const castsVote = voting && voteValue !== undefined && !isAbsentInVote;
  const isSub = seatInfo.role === "substitute";
  const fullName = member.firstName + " " + member.lastName;
  const label = names.label.length > 14 ? names.label.substring(0, 13) + "." : names.label;

  // Abwesende Mitglieder dieses Gremiums lesen sich als Lücke im Ring:
  // vom Elternteil nach außen gerückt, hohl und gedimmt.
  const hollow = eligible && !active;
  const style = !eligible
    ? { backgroundColor: "#DDDCD8", color: "#8A8A87", border: "none" }
    : hollow
      ? { backgroundColor: "#FFFFFF", color: "#6B6B68", border: (isSub ? "2px dashed " : "2px solid ") + "#B9B8B3" }
      : { backgroundColor: partyColor, color: contrastText(partyColor), border: isSub ? "2px dashed #5A5A57" : "none" };

  return (
    <div className="relative inline-flex items-center justify-center">
      <button type="button" disabled={!eligible || (voting && !castsVote)}
        className={"seat-node relative " + (eligible ? "" : "disabled ") + (hollow ? "absent-seat" : "")}
        onClick={() => (castsVote ? onVote(member.id) : onPresence(member.id))}
        aria-pressed={castsVote ? voteValue === "yes" : (eligible ? active : undefined)}
        aria-label={castsVote
          ? fullName + " – Stimme " + (voteValue === "yes" ? "Ja" : "Nein") + ", klicken zum Wechseln"
          : fullName + (isSub ? " (Vertretung)" : "") + " – " + (active ? "anwesend" : "abwesend")}
        title={fullName + (isSub ? " [Vertretung]" : "")}>
        <span className={"seat-circle rounded-full flex items-center justify-center font-bold" + (hollow ? "" : " shadow-card")}
          style={style}>
          <span className="seat-initials">{names.initials}</span>
        </span>
        {/* Im Button, damit auch die Fläche des Badges die Stimme umschaltet —
            als Nachbar schluckte sie Klicks und tat nichts. */}
        {castsVote && (
          <span className={"vote-badge seat-vote-badge absolute -bottom-1 -right-1 flex items-center justify-center rounded " +
            (voteValue === "yes" ? "bg-vote-yes" : "bg-vote-no")} aria-hidden="true">
            <span className="text-white font-bold">{voteValue === "yes" ? "✓" : "✗"}</span>
          </span>
        )}
        {isAbsentInVote && (
          <span className="seat-vote-badge absolute -bottom-1 -right-1 flex items-center justify-center rounded bg-absent"
            aria-hidden="true">
            <span className="text-white font-bold">—</span>
          </span>
        )}
        <span className={"seat-label-outside lbl-" + (labelPlacement || "above")}
          style={{ color: eligible ? "#2D2D2D" : "#8A8A87" }}>
          {label}
        </span>
      </button>
    </div>
  );
}

function CouncilCircle({ councillors, mayor, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup, seatNames }: {
  councillors: ActiveMember[]; mayor: ActiveMember | undefined; bodyConfig: BodyConfig;
  seatStates: SessionState["seatStates"]; currentVote: CurrentVote | null;
  dispatch: Dispatch<Action>; data: CouncilData; memberLookup: MemberLookup;
  seatNames: Record<string, SeatNames>;
}) {
  // Umgekehrte Reihenfolge: aus der Perspektive des Vorsitzes
  const ordered = useMemo(
    () => buildSeatOrder(councillors, data.seatOrder, data.councilOrder).reverse(),
    [councillors, data.seatOrder, data.councilOrder],
  );
  const n = ordered.length;

  // 27 symmetrische Plätze: Platz 0 der Vorsitz (unten Mitte), Plätze 1 und
  // 26 bewusst leer als Puffer, die Mitglieder füllen 2..25.
  const SLOT_DEG = 360 / 27;
  const MAX_COUNCIL_SLOTS = 24;
  const startSlot = 2 + Math.max(0, Math.floor((MAX_COUNCIL_SLOTS - n) / 2));

  // Radien in Prozent des Containers. Abwesende Mitglieder dieses Gremiums
  // sitzen auf dem äußeren Radius, der Ring zeigt eine sichtbare Lücke.
  const R_SEATED = 41;
  const R_AWAY = 46;

  function slotToPos(slot: number, radius: number) {
    const deg = 90 - slot * SLOT_DEG;
    const rad = (deg * Math.PI) / 180;
    return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) };
  }

  const handlePresence = usePresenceToggle(bodyConfig, dispatch, memberLookup);

  const handleVote = useCallback((id: string) => {
    dispatch({ type: "CAST_VOTE", memberId: id });
  }, [dispatch]);

  const voting = !!currentVote;

  // Größen stehen im CSS — ein Inline-max-width würde die Media-Query
  // überstimmen, die den Ring auf großen Displays weitet.
  return (
    <div className="relative council-circle-container" data-demo="presence cast">
      {ordered.map((m, i) => {
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const away = info.eligible && !info.active;
        const seated = slotToPos(startSlot + i, R_SEATED);
        const pos = away ? slotToPos(startSlot + i, R_AWAY) : seated;
        const party = getParty(data.parties, m.currentParty);
        // Die Platzierung folgt der Sitzposition, damit ein Label nie die
        // Seite wechselt, nur weil jemand hinausgetreten ist.
        const lbl = getLabelPlacement(seated.x, seated.y);
        return (
          <div key={m.id} className="seat-slot" style={{ left: pos.x + "%", top: pos.y + "%" }}>
            <SeatCircle member={m} names={seatNames[m.id]} partyColor={party.color} seatInfo={info}
              voting={voting} voteValue={currentVote?.votes[m.id]} labelPlacement={lbl}
              onPresence={handlePresence} onVote={handleVote} />
          </div>
        );
      })}

      {mayor && (() => {
        const info = getSeatInfo(mayor.id, bodyConfig, seatStates);
        const away = info.eligible && !info.active;
        const party = getParty(data.parties, mayor.currentParty);
        const mp = slotToPos(0, away ? R_AWAY : R_SEATED);
        return (
          <div className="seat-slot" style={{ left: mp.x + "%", top: mp.y + "%" }}>
            <SeatCircle member={mayor} names={seatNames[mayor.id]} partyColor={party.color} seatInfo={info}
              voting={voting} voteValue={currentVote?.votes[mayor.id]} labelPlacement="below"
              onPresence={handlePresence} onVote={handleVote} />
          </div>
        );
      })()}

      <CenterStats seatStates={seatStates} bodyConfig={bodyConfig} currentVote={currentVote} />
    </div>
  );
}

function CenterStats({ seatStates, bodyConfig, currentVote }: {
  seatStates: SessionState["seatStates"]; bodyConfig: BodyConfig; currentVote: CurrentVote | null;
}) {
  const present = getPresentIds(seatStates, bodyConfig);
  const total = bodyConfig.type === "plenum"
    ? bodyConfig.seatPairs.length + (bodyConfig.chairId ? 1 : 0)
    : bodyConfig.seatPairs.length + (bodyConfig.seatPairs.find((p) => p.role === "chair") ? 0 : bodyConfig.chairId ? 1 : 0);

  if (currentVote) {
    const yes = Object.values(currentVote.votes).filter((v) => v === "yes").length;
    const no = Object.values(currentVote.votes).filter((v) => v === "no").length;
    const absent = Object.values(currentVote.votes).filter((v) => v === "absent").length;
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-3xl font-bold text-vote-yes">{yes}</div>
          <div className="text-xs text-tx-m">Ja</div>
          <div className="w-12 h-px bg-brd mx-auto my-1"></div>
          <div className="text-3xl font-bold text-vote-no">{no}</div>
          <div className="text-xs text-tx-m">Nein</div>
          {absent > 0 && <>
            <div className="w-12 h-px bg-brd mx-auto my-1"></div>
            <div className="text-lg font-bold text-absent">{absent}</div>
            <div className="text-xs text-tx-m">Abwesend</div>
          </>}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className="text-4xl font-bold text-primary">{present.size}</div>
        <div className="text-xs text-tx-m">von {total} anwesend</div>
      </div>
    </div>
  );
}

/* ── Mitgliederkarten ─────────────────────────────────── */

function MemberCard({ member, partyColor, partyName, seatInfo, voting, voteValue, onPresence, onVote, bodyConfig, begriffe }: {
  member: ActiveMember; partyColor: string; partyName: string; seatInfo: SeatInfo;
  voting: boolean; voteValue: VoteValue | undefined;
  onPresence: (id: string) => void; onVote: (id: string) => void;
  bodyConfig: BodyConfig; begriffe: TenantConfig["begriffe"];
}) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isInVote = voting && voteValue !== undefined;
  const isAbsentInVote = voting && voteValue === "absent";
  const roleText = getMemberRoleText(member, bodyConfig, seatInfo, begriffe);
  const dimmed = !eligible || (!active && !voting) || isAbsentInVote ? "opacity-55" : "";
  const fullName = member.firstName + " " + member.lastName;

  return (
    <div className={"relative bg-surface rounded-lg border border-brd " + dimmed}>
      <button type="button" disabled={!eligible}
        className="card-btn w-full text-left p-3 pr-14 disabled:cursor-default"
        onClick={() => onPresence(member.id)}
        aria-pressed={eligible ? active : undefined}
        aria-label={fullName + " – " + (active ? "anwesend" : "abwesend")}>
        <div className="t-strong truncate">{fullName}</div>
        <div className="flex items-center gap-1.5 mt-1 t-meta text-tx-m">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: partyColor }}></span>
          <span className="truncate">{partyName}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{roleText}</span>
        </div>
      </button>
      <div className="absolute top-1/2 right-3 -translate-y-1/2">
        {voting && isInVote && !isAbsentInVote && (
          <button type="button"
            className={"vote-indicator flex items-center justify-center rounded w-8 h-8 " +
              (voteValue === "yes" ? "bg-vote-yes" : "bg-vote-no")}
            onClick={() => onVote(member.id)}
            aria-label={fullName + " – Stimme " + (voteValue === "yes" ? "Ja" : "Nein") + ", klicken zum Wechseln"}>
            <span className="text-white font-bold t-body">{voteValue === "yes" ? "✓" : "✗"}</span>
          </button>
        )}
        {voting && isAbsentInVote && (
          <span className="flex items-center justify-center rounded w-8 h-8 bg-absent" title={fullName + " – abwesend"}>
            <span className="text-white font-bold t-body">—</span>
          </span>
        )}
        {!voting && eligible && (
          <span className={"block w-3 h-3 rounded-full " + (active ? "bg-vote-yes" : "bg-absent")}></span>
        )}
      </div>
    </div>
  );
}

function MemberCards({ allMembers, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup, begriffe }: {
  allMembers: ActiveMember[]; bodyConfig: BodyConfig; seatStates: SessionState["seatStates"];
  currentVote: CurrentVote | null; dispatch: Dispatch<Action>; data: CouncilData;
  memberLookup: MemberLookup; begriffe: TenantConfig["begriffe"];
}) {
  const voting = !!currentVote;

  const handlePresence = usePresenceToggle(bodyConfig, dispatch, memberLookup);

  const handleVote = useCallback((id: string) => {
    dispatch({ type: "CAST_VOTE", memberId: id });
  }, [dispatch]);

  // Streng alphabetisch nach Nachnamen
  const sorted = useMemo(() => [...allMembers].sort((a, b) => a.lastName.localeCompare(b.lastName)), [allMembers]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {sorted.map((m) => {
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const party = getParty(data.parties, m.currentParty);
        return (
          <MemberCard key={m.id} member={m} partyColor={party.color} partyName={party.name}
            seatInfo={info} voting={voting} voteValue={currentVote?.votes[m.id]}
            onPresence={handlePresence} onVote={handleVote} bodyConfig={bodyConfig} begriffe={begriffe} />
        );
      })}
    </div>
  );
}

/* ── Abstimmung ───────────────────────────────────────── */

function VotePanel({ currentVote, session, dispatch, agenda, startVote, cmdKeys, showConfirm, onRequestConfirm, onCancelConfirm }: {
  currentVote: CurrentVote | null; session: SessionState["session"]; dispatch: Dispatch<Action>;
  agenda: SessionState["agenda"]; startVote: (agendaItem?: string) => void;
  cmdKeys: Keymap["commands"]; showConfirm: boolean;
  onRequestConfirm: () => void; onCancelConfirm: () => void;
}) {
  if (session.status !== "active" && session.status !== "paused") return null;

  if (!currentVote) {
    return (
      <div className="bg-surface rounded-lg border border-brd p-4">
        <button className="w-full py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary-dark transition-colors"
          onClick={() => startVote()}>
          Neue Abstimmung{cmdKeys.newVote && <kbd className="kbd-hint ml-1 align-middle">{cmdKeys.newVote}</kbd>}
        </button>
      </div>
    );
  }

  const yes = Object.values(currentVote.votes).filter((v) => v === "yes").length;
  const no = Object.values(currentVote.votes).filter((v) => v === "no").length;
  const absent = Object.values(currentVote.votes).filter((v) => v === "absent").length;
  const voting = yes + no;

  return (
    <div className="bg-surface rounded-lg border border-brd p-4 space-y-3">
      <h3 className="panel-title">Abstimmung</h3>
      <input type="text" placeholder="Titel der Abstimmung *" value={currentVote.title} data-demo="title"
        onChange={(e) => dispatch({ type: "UPDATE_VOTE", fields: { title: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="text" placeholder="Tagesordnungspunkt" value={currentVote.agendaItem} list="agenda-list"
        onChange={(e) => dispatch({ type: "UPDATE_VOTE", fields: { agendaItem: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <datalist id="agenda-list">{agenda.map((a) => <option key={a.id} value={a.title} />)}</datalist>
      <textarea placeholder="Kommentar (optional)" value={currentVote.comment} rows={2}
        onChange={(e) => dispatch({ type: "UPDATE_VOTE", fields: { comment: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:outline-none" />
      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-vote-yes text-white rounded-lg font-bold text-sm hover:opacity-90"
          onClick={() => dispatch({ type: "BULK_VOTE", value: "yes" })}>Alle Ja{cmdKeys.bulkYes && <kbd className="kbd-hint ml-1 align-middle">{cmdKeys.bulkYes.toUpperCase()}</kbd>}</button>
        <button className="flex-1 py-2 bg-vote-no text-white rounded-lg font-bold text-sm hover:opacity-90"
          onClick={() => dispatch({ type: "BULK_VOTE", value: "no" })}>Alle Nein{cmdKeys.bulkNo && <kbd className="kbd-hint ml-1 align-middle">{cmdKeys.bulkNo.toUpperCase()}</kbd>}</button>
      </div>
      <div className="text-center text-sm space-x-2">
        <span className="text-vote-yes font-bold">{yes} Ja</span>
        <span className="text-tx-m">|</span>
        <span className="text-vote-no font-bold">{no} Nein</span>
        {absent > 0 && <><span className="text-tx-m">|</span><span className="text-absent font-bold">{absent} Abw.</span></>}
        <span className="text-tx-m">|</span>
        <span className="text-tx-m">{voting} Stimmberechtigte</span>
      </div>
      <p className="text-xs text-tx-m text-center">
        Sitz anklicken = Ja/Nein. Anwesenheit ändern über die Mitgliederkarten.
      </p>
      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-gray-200 text-tx rounded-lg font-semibold text-sm hover:bg-gray-300"
          onClick={() => dispatch({ type: "CANCEL_VOTE" })}>Abbrechen</button>
        <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark disabled:opacity-40"
          disabled={!currentVote.title.trim()} onClick={onRequestConfirm} data-demo="save">Speichern</button>
      </div>
      {showConfirm && (
        <VoteConfirmModal vote={currentVote} yes={yes} no={no} absent={absent} voting={voting}
          passed={yes > no}
          onConfirm={() => { onCancelConfirm(); dispatch({ type: "CONFIRM_VOTE" }); }}
          onCancel={onCancelConfirm} />
      )}
    </div>
  );
}

function VoteConfirmModal({ vote, yes, no, absent, voting, passed, onConfirm, onCancel }: {
  vote: CurrentVote; yes: number; no: number; absent: number; voting: number;
  passed: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-surface rounded-xl shadow-card-lg p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif font-bold text-lg text-primary-dark mb-4">Abstimmung bestätigen</h3>
        <p className="font-semibold mb-2">{vote.title}</p>
        {vote.agendaItem && <p className="text-sm text-tx-m mb-2">{vote.agendaItem}</p>}
        <div className="flex justify-around py-4 border-y border-brd my-3">
          <div className="text-center"><div className="text-2xl font-bold text-vote-yes">{yes}</div><div className="text-xs text-tx-m">Ja</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-vote-no">{no}</div><div className="text-xs text-tx-m">Nein</div></div>
          {absent > 0 && <div className="text-center"><div className="text-2xl font-bold text-absent">{absent}</div><div className="text-xs text-tx-m">Abwesend</div></div>}
          <div className="text-center"><div className="text-2xl font-bold">{voting}</div><div className="text-xs text-tx-m">Abstimmende</div></div>
        </div>
        <div className={"text-center font-bold text-lg mb-4 " + (passed ? "text-vote-yes" : "text-vote-no")}>
          {passed ? "ANGENOMMEN" : "ABGELEHNT"}
        </div>
        <div className="flex gap-2">
          <button className="flex-1 py-2 bg-gray-200 rounded-lg font-semibold" onClick={onCancel}>Zurück</button>
          <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold" onClick={onConfirm}>Bestätigen</button>
        </div>
      </div>
    </div>
  );
}

/* ── Tagesordnung ─────────────────────────────────────── */
function AgendaPanel({ agenda, dispatch, startVote, canStartVote, votedItems }: {
  agenda: SessionState["agenda"]; dispatch: Dispatch<Action>;
  startVote: (agendaItem?: string) => void; canStartVote: boolean; votedItems: Set<string>;
}) {
  const [val, setVal] = useState("");
  const submit = () => {
    const titles = val.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!titles.length) return;
    titles.forEach((title) => dispatch({ type: "ADD_AGENDA", title }));
    setVal("");
  };
  return (
    <div className="bg-surface rounded-lg border border-brd p-4" data-demo="agenda">
      <h3 className="panel-title mb-2">Tagesordnung</h3>
      <div className="flex gap-2 mb-1">
        <textarea value={val} placeholder="Neuer TOP… (Enter = hinzufügen, Shift+Enter = neue Zeile)" rows={1}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 border border-brd rounded-lg px-3 py-1.5 text-sm resize-y focus:ring-2 focus:ring-primary focus:outline-none" />
        <button className="px-3 py-1.5 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30 self-start"
          onClick={submit}>+</button>
      </div>
      <p className="text-xs text-tx-m mb-2">
        {canStartVote
          ? "TOP anklicken startet eine Abstimmung dazu."
          : "Mehrere Zeilen = mehrere TOPs auf einmal."}
      </p>
      <ul className="space-y-0.5 t-body max-h-56 overflow-y-auto">
        {agenda.map((a) => {
          const voted = votedItems.has(a.title);
          return (
            <li key={a.id} className="flex items-start gap-1 group">
              <button type="button" disabled={!canStartVote}
                className={"agenda-btn flex-1 text-left rounded px-1.5 py-1 -ml-1.5 " +
                  (canStartVote ? "hover:bg-accent-light cursor-pointer" : "cursor-default") +
                  (voted ? " text-tx-m" : "")}
                onClick={() => startVote(a.title)}
                title={canStartVote ? "Abstimmung zu diesem TOP starten" : undefined}>
                {voted && <span className="text-vote-yes mr-1" aria-label="bereits abgestimmt">✓</span>}
                {a.title}
              </button>
              <button className="text-tx-m hover:text-vote-no opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs px-1 pt-1.5"
                aria-label={"TOP entfernen: " + a.title}
                onClick={() => dispatch({ type: "REMOVE_AGENDA", id: a.id })}>&times;</button>
            </li>
          );
        })}
        {agenda.length === 0 && <li className="text-tx-m italic">Keine Einträge</li>}
      </ul>
    </div>
  );
}

/* ── Protokoll ────────────────────────────────────────── */
function ProtocolLog({ log, dispatch }: {
  log: LogEntry[]; dispatch: Dispatch<Action>;
}) {
  const [tab, setTab] = useState<"human" | "tech">("human");
  if (log.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg border border-brd p-4">
      <div className="flex gap-4 mb-3 border-b border-brd">
        <button className={"pb-2 text-sm " + (tab === "human" ? "tab-active" : "tab-inactive")}
          onClick={() => setTab("human")}>Protokoll</button>
        <button className={"pb-2 text-sm " + (tab === "tech" ? "tab-active" : "tab-inactive")}
          onClick={() => setTab("tech")}>Technisches Log</button>
      </div>

      {tab === "human" && <HumanProtocol log={log} />}
      {tab === "tech" && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...log].reverse().map((entry) => <LogEntryRow key={entry.id} entry={entry} dispatch={dispatch} />)}
        </div>
      )}
    </div>
  );
}

function HumanProtocol({ log }: { log: LogEntry[] }) {
  const startEntry = log.find((e) => e.type === "session_start");
  const startPayload = startEntry?.payload as
    | { presentNames: string[]; absentNames: string[]; presentCount: number; absentCount: number }
    | undefined;
  return (
    <div className="space-y-4 text-sm max-h-96 overflow-y-auto">
      {startEntry && startPayload && (
        <div>
          <h4 className="panel-title mb-1">
            Anwesenheit zu Beginn ({fmtTime(startEntry.timestamp)})
          </h4>
          <p className="text-vote-yes">
            <span className="font-semibold">Anwesend ({startPayload.presentCount}):</span>{" "}
            {startPayload.presentNames.join("; ")}
          </p>
          {startPayload.absentCount > 0 && (
            <p className="text-absent">
              <span className="font-semibold">Abwesend ({startPayload.absentCount}):</span>{" "}
              {startPayload.absentNames.join("; ")}
            </p>
          )}
        </div>
      )}
      <div>
        <h4 className="panel-title mb-1">Verlauf</h4>
        <div className="space-y-1">
          {log.map((entry) => {
            const text = logEntryText(entry);
            if (!text) return null;
            return (
              <div key={entry.id} className="flex gap-2 log-enter">
                <span className="text-tx-m whitespace-nowrap tabular-nums">{fmtTime(entry.timestamp)}</span>
                <span>{text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LogEntryRow({ entry, dispatch }: { entry: LogEntry; dispatch: Dispatch<Action> }) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(entry.comment);
  const typeLabels: Record<string, string> = {
    session_start: "Start", session_pause: "Pause", session_resume: "Weiter", session_end: "Ende",
    session_public: "Modus", session_nonpublic: "Modus", presence_change: "Anwesenheit", vote: "Abstimmung",
  };
  const typeColors: Record<string, string> = {
    session_start: "bg-vote-yes", session_end: "bg-vote-no", vote: "bg-info",
    session_pause: "bg-yellow-400", session_resume: "bg-vote-yes", presence_change: "bg-accent",
    session_public: "bg-accent-light", session_nonpublic: "bg-gray-500",
  };
  return (
    <div className="log-enter flex gap-3 items-start text-sm border-b border-brd/50 pb-2">
      <span className="text-tx-m text-xs whitespace-nowrap pt-0.5">{fmtTime(entry.timestamp)}</span>
      <span className={"text-xs uppercase font-bold px-2 py-0.5 rounded text-white " + (typeColors[entry.type] || "bg-gray-400")}>
        {typeLabels[entry.type] || entry.type}
      </span>
      <div className="flex-1">
        <span>{entry.message}</span>
        {entry.mode && <span className="text-xs text-tx-m ml-1">[{entry.mode === "public" ? "öff." : "n.öff."}]</span>}
        {entry.comment && !editing && (
          <p className="text-tx-m text-xs italic mt-0.5 cursor-pointer" onClick={() => setEditing(true)}>
            Kommentar: {entry.comment}
          </p>
        )}
        {editing ? (
          <div className="flex gap-1 mt-1">
            <input type="text" value={comment} onChange={(e) => setComment(e.target.value)}
              className="flex-1 border border-brd rounded px-2 py-0.5 text-xs" autoFocus />
            <button className="text-xs text-primary font-bold" onClick={() => {
              dispatch({ type: "ADD_LOG_COMMENT", logId: entry.id, comment }); setEditing(false);
            }}>OK</button>
          </div>
        ) : (
          <button className="text-xs text-tx-m hover:text-primary ml-2" onClick={() => setEditing(true)}>[Kommentar]</button>
        )}
      </div>
    </div>
  );
}

/* ── Übermitteln und Export ───────────────────────────── */
/* Übermittelt den öffentlichen Teil der Sitzung an moosburg.eu, wo er als
   nachvollziehbare Quelle für die Stadtratstransparenz-App landet.
   Ersetzt den Export nicht — der bleibt die Sicherung, und diese
   Reihenfolge steht so auch in der Oberfläche.

   Zugangsdaten stehen nur im Komponenten-State: kein LocalStorage, keine
   Wiederverwendung nach dem Neuladen. Das Passwort wird nach Erfolg
   verworfen. */
function SubmitPanel({ state, memberLookup, bodyName }: {
  state: SessionState; memberLookup: MemberLookup; bodyName: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "ok"; text: string } | { kind: "error"; text: string }
  >({ kind: "idle" });

  const publicVotes = state.votes.filter((v) => v.mode === "public").length;
  const busy = status.kind === "sending";
  const ready = email.trim() !== "" && password !== "" && publicVotes > 0 && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !SAVE_ENDPOINT) return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(SAVE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(unescape(encodeURIComponent(email.trim() + ":" + password))),
        },
        body: JSON.stringify(buildPartJSON(state, memberLookup, bodyName, "public")),
      });
      const data = await res.json().catch(() => ({} as { erfasstVon?: string; abstimmungen?: number; error?: string }));
      if (res.ok) {
        setPassword("");
        setStatus({ kind: "ok", text: `Übermittelt als ${data.erfasstVon} — ${data.abstimmungen} Abstimmung${data.abstimmungen === 1 ? "" : "en"}.` });
      } else if (res.status === 401) {
        setStatus({ kind: "error", text: "E-Mail oder Passwort stimmt nicht." });
      } else {
        setStatus({ kind: "error", text: data.error || `Der Server hat abgelehnt (${res.status}).` });
      }
    } catch (err) {
      console.error("Übermittlung fehlgeschlagen", err);
      setStatus({ kind: "error", text: "Keine Verbindung. Das ZIP-Paket sichert die Sitzung." });
    }
  };

  return (
    <form className="bg-surface rounded-lg border border-brd p-4" onSubmit={submit}>
      <h3 className="panel-title mb-2">An moosburg.eu übermitteln</h3>
      <p className="text-xs text-tx-m mb-3">
        Übertragen wird ausschließlich der öffentliche Teil
        {publicVotes > 0
          ? <> — derzeit <b>{publicVotes} Abstimmung{publicVotes === 1 ? "" : "en"}</b>.</>
          : <>. Bisher wurde im öffentlichen Teil nichts abgestimmt.</>}
        {" "}Der nichtöffentliche Teil verlässt dieses Gerät nicht.
      </p>
      <div className="space-y-2">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="E-Mail" autoComplete="username" disabled={busy}
          className="w-full px-3 py-2 rounded-lg border border-brd text-sm" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort" autoComplete="current-password" disabled={busy}
          className="w-full px-3 py-2 rounded-lg border border-brd text-sm" />
        <button type="submit" disabled={!ready}
          className="w-full py-2.5 rounded-lg font-bold text-sm transition-colors bg-primary text-white hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? "Wird übermittelt …" : "Öffentlichen Teil übermitteln"}
        </button>
      </div>
      {status.kind === "ok" && <p className="text-xs mt-2 font-semibold text-green-700">{status.text}</p>}
      {status.kind === "error" && <p className="text-xs mt-2 font-semibold text-primary">{status.text}</p>}
    </form>
  );
}

function ExportPanel({ state, activeMembers, memberLookup, bodyName, onDownloaded }: {
  state: SessionState; activeMembers: ActiveMember[]; memberLookup: MemberLookup;
  bodyName: string; onDownloaded?: () => void;
}) {
  const doTxt = () => {
    const txt = generateHumanProtocol(state, bodyName);
    download(txt, "protokoll-" + state.session.date + ".txt", "text/plain");
    if (onDownloaded) onDownloaded();
  };

  const doJSON = () => {
    const data = {
      session: { id: state.session.id, date: state.session.date, title: state.session.title,
        location: state.session.location, body: state.bodyId },
      members: activeMembers.map((m) => ({ id: m.id, name: m.firstName + " " + m.lastName, party: m.currentParty })),
      log: state.log, votes: state.votes,
    };
    download(JSON.stringify(data, null, 2), "protokoll-" + state.session.date + ".json", "application/json");
    if (onDownloaded) onDownloaded();
  };

  const doMD = () => {
    let md = "# Sitzungsprotokoll\n\n**" + state.session.title + "**\n";
    md += "Datum: " + fmtDate(state.session.date) + "\nOrt: " + state.session.location + "\n\n## Protokoll\n\n";
    state.log.forEach((e) => {
      md += "- **" + fmtTime(e.timestamp) + "** [" + e.type + "] " + e.message;
      if (e.comment) md += " _(" + e.comment + ")_";
      md += "\n";
    });
    if (state.votes.length) {
      md += "\n## Abstimmungen\n\n";
      state.votes.forEach((v, i) => {
        md += "### " + (i + 1) + ". " + v.title + "\n\n";
        if (v.agendaItem) md += "TOP: " + v.agendaItem + "\n\n";
        md += "**Ergebnis:** " + v.result.yes + " Ja, " + v.result.no + " Nein";
        if (v.result.absent) md += ", " + v.result.absent + " Abwesend";
        md += " – **" + (v.result.passed ? "angenommen" : "abgelehnt") + "**\n\n";
        if (v.yesVoters?.length) { md += "**Ja:** " + v.yesVoters.join(", ") + "\n\n"; }
        if (v.noVoters?.length) { md += "**Nein:** " + v.noVoters.join(", ") + "\n\n"; }
        if (v.absentVoters?.length) { md += "**Abwesend:** " + v.absentVoters.join(", ") + "\n\n"; }
      });
    }
    download(md, "protokoll-" + state.session.date + ".md", "text/markdown");
    if (onDownloaded) onDownloaded();
  };

  const doZip = async () => {
    try {
      const blob = await buildZipBlob(state, memberLookup, bodyName);
      downloadBlob(blob, "protokoll-" + state.session.date + "_" + state.bodyId + ".zip");
      if (onDownloaded) onDownloaded();
    } catch (e) { console.error("ZIP export failed", e); }
  };

  return (
    <div className="bg-surface rounded-lg border border-brd p-4" data-demo="export">
      <h3 className="panel-title mb-2">Export</h3>
      <div className="space-y-2">
        <button className="w-full py-2.5 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark transition-colors"
          onClick={doZip}>ZIP-Paket herunterladen</button>
        <div className="flex gap-2">
          <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30" onClick={doJSON}>JSON</button>
          <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30" onClick={doMD}>Markdown</button>
          <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30" onClick={doTxt}>Text</button>
        </div>
      </div>
    </div>
  );
}

/* ── Partei-Legende ───────────────────────────────────── */
/* Während einer Abstimmung trägt jede Partei Ja/Nein-Knöpfe, die nur die
   anwesenden Mitglieder dieser Partei setzen. */
function PartyLegend({ members, data, currentVote, partyOf, dispatch }: {
  members: ActiveMember[]; data: CouncilData; currentVote: CurrentVote | null;
  partyOf: Record<string, string>; dispatch: Dispatch<Action>;
}) {
  const groups: Record<string, number> = {};
  members.forEach((m) => {
    if (!groups[m.currentParty]) groups[m.currentParty] = 0;
    groups[m.currentParty]++;
  });

  const votersOf = (pid: string) => currentVote
    ? Object.keys(currentVote.votes).filter((id) => partyOf[id] === pid && currentVote.votes[id] !== "absent")
    : [];

  return (
    <div className="flex flex-wrap gap-2 justify-center" data-demo="bulk">
      {Object.entries(groups).map(([pid, count]) => {
        const p = getParty(data.parties, pid);
        const ids = votersOf(pid);
        const edge = p.color + "44";
        // Jede Partei behält während einer Abstimmung dieselbe Form —
        // Parteien ohne Anwesende bekommen eine deaktivierte Zeile, statt
        // still zu verschwinden.
        const note = ids.length
          ? p.name + ": alle " + ids.length + " Anwesenden auf "
          : p.name + ": niemand in diesem Gremium anwesend – ";
        return (
          <div key={pid} className="text-xs rounded-lg overflow-hidden"
            style={{ backgroundColor: p.color + "18", border: "1px solid " + edge }}>
            <div className="flex items-center gap-1.5 px-2 py-1 whitespace-nowrap" style={{ color: p.color }}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }}></span>
              {p.name} ({count})
            </div>
            {currentVote && (
              <div className="flex border-t" style={{ borderColor: edge }}>
                <button type="button" disabled={!ids.length}
                  className="flex-1 px-3 py-1 font-semibold hover:bg-vote-yes hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
                  style={{ color: p.color }}
                  onClick={() => dispatch({ type: "BULK_VOTE", value: "yes", memberIds: ids })}
                  title={note + "Ja"}>Ja</button>
                <button type="button" disabled={!ids.length}
                  className="flex-1 px-3 py-1 font-semibold border-l hover:bg-vote-no hover:text-white disabled:opacity-35 disabled:hover:bg-transparent"
                  style={{ color: p.color, borderColor: edge }}
                  onClick={() => dispatch({ type: "BULK_VOTE", value: "no", memberIds: ids })}
                  title={note + "Nein"}>Nein</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Sitzungsdetails ──────────────────────────────────── */
function SessionInfoEditor({ session, dispatch }: {
  session: SessionState["session"]; dispatch: Dispatch<Action>;
}) {
  if (session.status !== "idle") return null;
  return (
    <div className="bg-surface rounded-lg border border-brd p-4 space-y-2">
      <h3 className="panel-title">Sitzungsdetails</h3>
      <input type="text" value={session.title} placeholder="Titel"
        onChange={(e) => dispatch({ type: "UPDATE_SESSION", fields: { title: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="date" value={session.date}
        onChange={(e) => dispatch({ type: "UPDATE_SESSION", fields: { date: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="text" value={session.location} placeholder="Ort"
        onChange={(e) => dispatch({ type: "UPDATE_SESSION", fields: { location: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
    </div>
  );
}

/* ── Wiederherstellung ────────────────────────────────── */
function RecoveryModal({ recoveryData, tenantId, onDismiss }: {
  recoveryData: BackupData; tenantId: string; onDismiss: () => void;
}) {
  const state = recoveryData.state;
  const memberLookup = recoveryData.memberLookup || {};
  const bodyName = recoveryData.bodyName || state.bodyId;

  const doDownload = (fn: () => void) => { fn(); clearBackup(tenantId); onDismiss(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface rounded-xl shadow-card-lg p-6 max-w-md w-full mx-4">
        <h3 className="font-serif font-bold text-lg text-primary-dark mb-2">Sitzungsdaten gefunden</h3>
        <p className="text-sm text-tx-m mb-1">
          Es gibt noch Daten einer vorherigen Sitzung.
        </p>
        <div className="bg-accent-light/50 rounded-lg p-3 mb-4 text-sm">
          <p className="font-semibold">{state.session.title}</p>
          <p className="text-tx-m">{fmtDate(state.session.date)} · {bodyName}</p>
          <p className="text-tx-m">{state.votes.length} Abstimmung(en), {state.log.length} Log-Einträge</p>
        </div>

        <div className="space-y-2 mb-4">
          <button className="w-full py-2.5 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark"
            onClick={() => doDownload(async () => {
              try {
                const blob = await buildZipBlob(state, memberLookup, bodyName);
                downloadBlob(blob, "protokoll-" + state.session.date + ".zip");
              } catch (e) { console.error("ZIP export failed", e); }
            })}>ZIP-Paket herunterladen</button>
          <div className="flex gap-2">
            <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30"
              onClick={() => doDownload(() => {
                download(JSON.stringify({ session: state.session, log: state.log, votes: state.votes }, null, 2),
                  "protokoll-" + state.session.date + ".json", "application/json");
              })}>JSON</button>
            <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30"
              onClick={() => doDownload(() => {
                download(generateHumanProtocol(state, bodyName), "protokoll-" + state.session.date + ".txt", "text/plain");
              })}>Text</button>
          </div>
        </div>

        <button className="w-full py-2 border border-brd rounded-lg text-sm text-tx-m hover:bg-gray-50"
          onClick={() => { clearBackup(tenantId); onDismiss(); }}>Verwerfen und neue Sitzung starten</button>
      </div>
    </div>
  );
}

/* ── Tastatur-Hilfe ───────────────────────────────────── */
function ShortcutHelp({ onClose, keymap, data }: {
  onClose: () => void; keymap: Keymap; data: CouncilData;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-card-lg p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif font-bold t-display text-primary-dark mb-4">Bedienung</h3>

        <div className="kbd-section">
          <h4 className="panel-title mb-2">Fraktionen</h4>
          <p className="t-meta text-tx-m mb-2">
            Der Anfangsbuchstabe schaltet die ganze Fraktion auf Ja — und auf Nein,
            wenn sie bereits geschlossen mit Ja stimmt.
          </p>
          <dl className="space-y-2">
            {Object.entries(keymap.parties).map(([pid, key]) => (
              <div key={pid} className="flex items-baseline gap-3">
                <dt className="w-14 flex-shrink-0"><kbd>{key.toUpperCase()}</kbd></dt>
                <dd className="t-body">{getParty(data.parties, pid).name}</dd>
              </div>
            ))}
          </dl>

          <h4 className="panel-title mt-5 mb-2">Befehle</h4>
          <dl className="space-y-2">
            {commandShortcuts(keymap.commands).map((s) => (
              <div key={s.label} className="flex items-baseline gap-3">
                <dt className="w-14 flex-shrink-0"><kbd>{s.key}</kbd></dt>
                <dd className="t-body">{s.label}</dd>
              </div>
            ))}
          </dl>
          <p className="t-meta text-tx-m mt-4">Buchstabenkürzel pausieren, solange ein Textfeld aktiv ist.</p>
        </div>

        <h4 className="panel-title kbd-mt mt-5 mb-2">Tippen und Klicken</h4>
        <dl className="space-y-2 t-meta">
          <div className="flex gap-3"><dt className="w-28 flex-shrink-0 text-tx-m">Sitz</dt>
            <dd>Anwesenheit — während einer Abstimmung Ja/Nein</dd></div>
          <div className="flex gap-3"><dt className="w-28 flex-shrink-0 text-tx-m">Mitgliederkarte</dt>
            <dd>Anwesenheit, auch während einer Abstimmung</dd></div>
          <div className="flex gap-3"><dt className="w-28 flex-shrink-0 text-tx-m">Partei-Chip</dt>
            <dd>Ja/Nein für alle anwesenden Mitglieder dieser Partei</dd></div>
          <div className="flex gap-3"><dt className="w-28 flex-shrink-0 text-tx-m">TOP</dt>
            <dd>Startet eine Abstimmung zu diesem Punkt</dd></div>
        </dl>

        <button className="w-full mt-5 py-2 bg-primary text-white rounded-lg font-bold t-body" onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}

/* ── Demo-Leiste ──────────────────────────────────────── */
function DemoBanner({ state }: { state: SessionState }) {
  const stepIndex = DEMO_STEPS.findIndex((s) => !s.done(state));
  const current = stepIndex === -1 ? null : DEMO_STEPS[stepIndex];
  const done = DEMO_STEPS.filter((s) => s.done(state)).length;

  const rat = tenantIdFromUrl();
  const exitHref = location.pathname + (rat ? "?rat=" + rat : "");

  return (
    <div className="sticky top-0 z-30 bg-tx text-white shadow-card-lg">
      {/* Eine Regel, nur für den offenen Schritt: alles, was dessen id in
          data-demo trägt, wird umrandet. */}
      {current && <style dangerouslySetInnerHTML={{ __html:
        '[data-demo~="' + current.id + '"]{outline:3px solid var(--t-primary-bright);outline-offset:4px;border-radius:10px;}',
      }} />}

      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex-1 min-w-[16rem]">
          {current ? (
            <>
              <p className="flex items-baseline gap-2 flex-wrap">
                <span className="t-meta font-semibold uppercase tracking-wider text-accent">
                  Demo · Schritt {stepIndex + 1}/{DEMO_STEPS.length}
                </span>
                <span className="font-serif font-bold t-display">{current.title}</span>
              </p>
              <p className="t-body text-white/75 protocol-measure mt-0.5">{current.hint}</p>
            </>
          ) : (
            <>
              <p className="font-serif font-bold t-display">Alle {DEMO_STEPS.length} Schritte durchlaufen.</p>
              <p className="t-body text-white/75 mt-0.5">Protokoll und Export unten enthalten den kompletten Sitzungsverlauf.</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex gap-1" role="img"
            aria-label={done + " von " + DEMO_STEPS.length + " Schritten erledigt"}>
            {DEMO_STEPS.map((s, i) => (
              <span key={s.id} className={"block w-4 h-1.5 rounded-full " +
                (s.done(state) ? "bg-accent" : i === stepIndex ? "bg-white" : "bg-white/25")} />
            ))}
          </div>
          <button className="px-3 py-1.5 rounded-lg t-meta font-semibold border border-white/35 hover:bg-white/15"
            onClick={() => location.reload()}>Neu starten</button>
          <a className="px-3 py-1.5 rounded-lg t-meta font-semibold border border-white/35 hover:bg-white/15"
            href={exitHref}>Demo verlassen</a>
        </div>
      </div>
    </div>
  );
}

/* ── Lade- und Fehlerbilder ───────────────────────────── */
function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      {children}
    </div>
  );
}

/* ── Sitzung ──────────────────────────────────────────── */
function SessionApp({ tenant }: { tenant: Tenant }) {
  const { config, data } = tenant;
  const demoActive = DEMO_MODE && !!config.demo;
  const [state, dispatch] = useReducer(
    reducer, null, () => buildInitialState(config, data, demoActive),
  );
  const today = useMemo(() => new Date(), []);

  const [showHelp, setShowHelp] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Wiederherstellung — nie im Demo-Modus, der den Backup-Slot der echten
  // Sitzung weder lesen noch beschreiben darf.
  const [recoveryData, setRecoveryData] = useState<BackupData | null>(() =>
    demoActive ? null : readBackup(tenant.id),
  );

  const active = useMemo(() => getActiveMembers(data.members, today), [data, today]);

  const mayor = useMemo(() => active.find((m) => m.role === "mayor"), [active]);
  const councillors = useMemo(() => active.filter((m) => m.role === "councillor"), [active]);

  const memberLookup = useMemo(() => {
    const m: MemberLookup = {};
    active.forEach((member) => { m[member.id] = member.lastName + ", " + member.firstName; });
    return m;
  }, [active]);

  const seatNames = useMemo(() => buildSeatNames(active), [active]);

  const partyOf = useMemo(() => {
    const m: Record<string, string> = {};
    active.forEach((member) => { m[member.id] = member.currentParty; });
    return m;
  }, [active]);

  // Dieselbe Reihenfolge wie die Legende, damit Chip- und Tastenfolge passen.
  const keymap = useMemo(() => {
    const ids: string[] = [];
    active.forEach((m) => { if (!ids.includes(m.currentParty)) ids.push(m.currentParty); });
    return buildKeymap(ids, data.parties);
  }, [active, data]);

  const bodyDef = useMemo(() => data.bodies.find((b) => b.id === state.bodyId) ?? null, [data, state.bodyId]);
  const bodyConfig = useMemo(() => getBodyConfig(bodyDef, active), [bodyDef, active]);
  const bodyName = bodyDef ? bodyDef.name : state.bodyId;

  // Sitze beim Gremienwechsel initialisieren
  const prevBodyRef = useRef<string | null>(null);
  useEffect(() => {
    if (bodyConfig && prevBodyRef.current !== state.bodyId) {
      dispatch({ type: "INIT_SEATS", bodyConfig, activeMembers: active });
      prevBodyRef.current = state.bodyId;
    }
  }, [state.bodyId, bodyConfig, active]);
  useEffect(() => {
    if (bodyConfig && Object.keys(state.seatStates).length === 0) {
      dispatch({ type: "INIT_SEATS", bodyConfig, activeMembers: active });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyConfig]);

  // Tagesordnung aus Datei laden: tenants/<id>/tagesordnung/JJJJ-MM-TT_gremium.txt
  useEffect(() => {
    const url = agendaUrl(tenant.id, state.session.date, state.bodyId);
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(); return r.text(); })
      .then((text) => {
        const items = text.split("\n").map((l) => l.trim()).filter(Boolean);
        if (items.length) dispatch({ type: "SET_AGENDA", items });
      })
      .catch(() => { /* keine Datei, kein Problem */ });
  }, [tenant.id, state.bodyId, state.session.date]);

  const presentIds = useMemo(() => getPresentIds(state.seatStates, bodyConfig), [state.seatStates, bodyConfig]);

  // Während einer laufenden Sitzung in den LocalStorage sichern
  useEffect(() => {
    if (demoActive) return;
    if (state.session.status === "active" || state.session.status === "paused" || state.session.status === "ended") {
      writeBackup(tenant.id, {
        state, memberLookup, bodyName,
        activeMembers: active.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, currentParty: m.currentParty })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleDownloaded = useCallback(() => { clearBackup(tenant.id); }, [tenant.id]);

  /* ── Abstimmung starten + Tastatur ─── */
  const sessionLive = state.session.status === "active" || state.session.status === "paused";

  const startVote = useCallback((agendaItem?: string) => {
    const memberNames: Record<string, string> = {};
    active.forEach((m) => { memberNames[m.id] = m.lastName + ", " + m.firstName; });
    dispatch({ type: "START_VOTE", presentIds: [...presentIds], memberNames, agendaItem: agendaItem || "" });
  }, [active, presentIds]);

  // TOPs mit bereits gespeicherter Abstimmung, für den Fortschritt der Liste.
  const votedItems = useMemo(
    () => new Set(state.votes.map((v) => v.agendaItem).filter(Boolean)),
    [state.votes],
  );

  /* Ein Kürzel, das still nichts tut, liest sich wie ein kaputtes Kürzel —
     also sagen, warum es nicht gegriffen hat. */
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showHint = useCallback((msg: string) => {
    setHint(msg);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const cmd = keymap.commands;
  const noVoteHint = "Keine Abstimmung offen" + (cmd.newVote ? " — mit " + cmd.newVote + " starten." : ".");

  const bulk = (value: "yes" | "no") => {
    if (!sessionLive) return showHint("Erst die Sitzung eröffnen.");
    if (!state.currentVote) return showHint(noVoteHint);
    dispatch({ type: "BULK_VOTE", value });
  };

  /* Eine Parteitaste dreht die ganze Fraktion: auf Ja, oder auf Nein, wenn
     sie schon geschlossen mit Ja stimmt. Eine gemischte Partei geht auf Ja —
     eine Richtung musste die Konvention sein, und eine Abstimmung beginnt
     mit allen auf Nein. */
  const togglePartyVote = (pid: string) => {
    if (!state.currentVote) return;
    const votes = state.currentVote.votes;
    const ids = Object.keys(votes).filter((id) => partyOf[id] === pid && votes[id] !== "absent");
    const name = getParty(data.parties, pid).name;
    if (!ids.length) return showHint(name + ": niemand anwesend.");
    const allYes = ids.every((id) => votes[id] === "yes");
    dispatch({ type: "BULK_VOTE", value: allYes ? "no" : "yes", memberIds: ids });
    showHint(name + ": alle " + ids.length + " auf " + (allYes ? "Nein" : "Ja") + ".");
  };

  useHotkeys({
    onKey: (key) => {
      if (key === cmd.help) { setShowHelp((v) => !v); return true; }
      if (key === cmd.newVote) {
        if (!sessionLive) showHint("Erst die Sitzung eröffnen.");
        else if (state.currentVote) showHint("Es läuft bereits eine Abstimmung.");
        else startVote();
        return true;
      }
      if (key === cmd.bulkYes) { bulk("yes"); return true; }
      if (key === cmd.bulkNo) { bulk("no"); return true; }

      const pid = Object.keys(keymap.parties).find((id) => keymap.parties[id] === key);
      if (!pid) return false;
      if (!sessionLive) showHint("Erst die Sitzung eröffnen.");
      else if (!state.currentVote) showHint(noVoteHint);
      else togglePartyVote(pid);
      return true;
    },
    onSave: () => {
      if (showConfirm || !state.currentVote || !state.currentVote.title.trim()) return false;
      setShowConfirm(true);
      return true;
    },
    onCancel: () => {
      if (showHelp) { setShowHelp(false); return; }
      if (showConfirm) { setShowConfirm(false); return; }
      if (state.currentVote) dispatch({ type: "CANCEL_VOTE" });
    },
  });

  if (!bodyConfig) return (
    <CenteredNote>
      <div className="text-center text-tx-m">
        <div className="text-2xl mb-2 animate-spin inline-block">&#9881;</div>
        <p>Lade Daten...</p>
      </div>
    </CenteredNote>
  );

  return (
    <div className="min-h-screen">
      {recoveryData && <RecoveryModal recoveryData={recoveryData} tenantId={tenant.id} onDismiss={() => setRecoveryData(null)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} keymap={keymap} data={data} />}
      {hint && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-tx text-white t-meta px-4 py-2 rounded-lg shadow-card-lg"
          role="status">{hint}</div>
      )}

      {demoActive && <DemoBanner state={state} />}

      <SessionHeader session={state.session} bodyId={state.bodyId} bodies={data.bodies}
        dispatch={dispatch} bodyConfig={bodyConfig} memberLookup={memberLookup}
        onShowHelp={() => setShowHelp(true)} />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Mobil: gestapelt in DOM-Reihenfolge. Desktop: Grid mit Sidebar über zwei Zeilen */}
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6">
          {/* Kreis */}
          <div className="lg:col-span-2 space-y-3">
            <PartyLegend members={active} data={data} currentVote={state.currentVote}
              partyOf={partyOf} dispatch={dispatch} />
            <CouncilCircle councillors={councillors} mayor={mayor} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch}
              data={data} memberLookup={memberLookup} seatNames={seatNames} />
          </div>

          {/* Sidebar: mobil zwischen Kreis und Karten */}
          <div className="space-y-4 lg:row-span-2">
            <SessionInfoEditor session={state.session} dispatch={dispatch} />
            <AgendaPanel agenda={state.agenda} dispatch={dispatch} startVote={startVote}
              canStartVote={sessionLive && !state.currentVote} votedItems={votedItems} />
            <VotePanel currentVote={state.currentVote} session={state.session}
              dispatch={dispatch} agenda={state.agenda} startVote={startVote}
              cmdKeys={keymap.commands} showConfirm={showConfirm}
              onRequestConfirm={() => setShowConfirm(true)}
              onCancelConfirm={() => setShowConfirm(false)} />
            {state.session.status === "ended" && (
              <ExportPanel state={state} activeMembers={active} memberLookup={memberLookup}
                bodyName={bodyName} onDownloaded={handleDownloaded} />
            )}
            {/* Nach dem Export, nicht davor: Die Datei in der Hand ist die
                Sicherung, die Übermittlung das Zusätzliche. */}
            {state.session.status === "ended" && SAVE_ENDPOINT && (
              <SubmitPanel state={state} memberLookup={memberLookup} bodyName={bodyName} />
            )}
          </div>

          {/* Karten: mobil nach der Sidebar, Desktop unter dem Kreis */}
          <div className="lg:col-span-2">
            <h3 className="panel-title mb-3">Mitglieder</h3>
            <MemberCards allMembers={active} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch}
              data={data} memberLookup={memberLookup} begriffe={config.begriffe} />
          </div>
        </div>

        {/* Protokoll: immer zuletzt */}
        <div className="mt-6">
          <ProtocolLog log={state.log} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}

/* ── App: Mandant laden, dann Sitzung ─────────────────── */
export default function App() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadTenant()
      .then((t) => { applyTenantChrome(t.config); setTenant(t); })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError("Daten konnten nicht geladen werden: " + msg);
      });
  }, []);

  if (loadError) return (
    <CenteredNote>
      <div className="bg-surface rounded-xl shadow-card-lg p-8 max-w-md text-center">
        <div className="text-4xl mb-4">&#9888;</div>
        <p className="text-vote-no font-bold">{loadError}</p>
        <p className="text-tx-m text-sm mt-2">Erwartet wird ein Mandanten-Ordner unter <code>tenants/</code> mit <code>config.json</code> und <code>members.json</code>.</p>
      </div>
    </CenteredNote>
  );

  if (!tenant) return (
    <CenteredNote>
      <div className="text-center text-tx-m">
        <div className="text-2xl mb-2 animate-spin inline-block">&#9881;</div>
        <p>Lade Daten...</p>
      </div>
    </CenteredNote>
  );

  return <SessionApp tenant={tenant} />;
}
