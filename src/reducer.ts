/** Der Sitzungszustand und alle Übergänge. Unverändert aus der
 *  Vorgänger-Version übernommen; nur die Startwerte kommen jetzt aus der
 *  Mandanten-Konfiguration statt aus Konstanten. */
import { getPresentIds, ts, uuid } from "./logic";
import type {
  Action, CouncilData, CurrentVote, LogEntry, SessionState, TenantConfig, VoteRecord, VoteValue,
} from "./types";

export function buildInitialState(
  config: TenantConfig, data: CouncilData, demoMode: boolean,
): SessionState {
  const demo = demoMode && config.demo ? config.demo : null;
  const plenum = data.bodies.find((b) => b.type === "plenum") || data.bodies[0];
  return {
    bodyId: demo ? demo.bodyId : plenum.id,
    session: {
      id: null,
      title: demo ? demo.title : config.sitzung.titel,
      date: demo ? demo.date : new Date().toISOString().slice(0, 10),
      location: config.sitzung.ort,
      status: "idle", mode: "public",
    },
    seatStates: {},
    presenceHistory: {},
    currentVote: null,
    votes: [],
    log: [],
    agenda: [],
  };
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {

    case "SELECT_BODY": {
      return { ...state, bodyId: action.bodyId, seatStates: {}, presenceHistory: {},
        currentVote: null, votes: [], log: [], agenda: [],
        session: { ...state.session, status: "idle", title: action.bodyName || state.session.title } };
    }

    case "INIT_SEATS": {
      const { bodyConfig, activeMembers } = action;
      const ss: SessionState["seatStates"] = {};
      if (bodyConfig.type === "plenum") {
        activeMembers.forEach((m) => { ss[m.id] = "present"; });
      } else {
        bodyConfig.seatPairs.forEach((p) => { ss[p.regular] = "regular"; });
      }
      return { ...state, seatStates: ss };
    }

    case "SET_AGENDA": {
      return { ...state, agenda: action.items.map((title) => ({ id: uuid(), title })) };
    }

    case "UPDATE_SESSION": {
      return { ...state, session: { ...state.session, ...action.fields } };
    }

    case "START_SESSION": {
      const { bodyConfig, memberLookup } = action;
      const now = ts();
      const ph: SessionState["presenceHistory"] = {};
      const presentSet = getPresentIds(state.seatStates, bodyConfig);
      const presentNames: string[] = [];
      const absentNames: string[] = [];

      // Anwesenheit zu Beginn für alle Berechtigten festhalten
      const eligible = new Set<string>();
      if (bodyConfig.type === "plenum") {
        Object.keys(state.seatStates).forEach((id) => eligible.add(id));
      } else {
        bodyConfig.seatPairs.forEach((p) => {
          eligible.add(p.regular);
          if (p.substitute) eligible.add(p.substitute);
        });
        if (bodyConfig.chairId && !bodyConfig.seatPairs.find((p) => p.regular === bodyConfig.chairId))
          eligible.add(bodyConfig.chairId);
      }
      eligible.forEach((id) => {
        const present = presentSet.has(id);
        ph[id] = [{ state: present ? "present" : "absent", ts: now }];
        (present ? presentNames : absentNames).push(memberLookup[id] || id);
      });
      presentNames.sort(); absentNames.sort();

      const log: LogEntry[] = [...state.log, {
        id: uuid(), timestamp: now, type: "session_start", message: "Sitzung eröffnet",
        payload: { presentNames, absentNames, presentCount: presentNames.length, absentCount: absentNames.length },
        comment: "", mode: state.session.mode,
      }];
      return { ...state, session: { ...state.session, status: "active", id: uuid() }, log, presenceHistory: ph };
    }

    case "PAUSE_SESSION": {
      const log: LogEntry[] = [...state.log, { id: uuid(), timestamp: ts(), type: "session_pause",
        message: "Sitzung unterbrochen", payload: null, comment: "", mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: "paused" }, log };
    }
    case "RESUME_SESSION": {
      const log: LogEntry[] = [...state.log, { id: uuid(), timestamp: ts(), type: "session_resume",
        message: "Sitzung fortgesetzt", payload: null, comment: "", mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: "active" }, log };
    }
    case "END_SESSION": {
      const log: LogEntry[] = [...state.log, { id: uuid(), timestamp: ts(), type: "session_end",
        message: "Sitzung beendet", payload: null, comment: "", mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: "ended" }, log };
    }
    case "SET_MODE": {
      const mode = action.mode;
      const log: LogEntry[] = [...state.log, { id: uuid(), timestamp: ts(),
        type: mode === "public" ? "session_public" : "session_nonpublic",
        message: mode === "public" ? "Öffentlicher Teil" : "Nichtöffentlicher Teil",
        payload: null, comment: "", mode }];
      return { ...state, session: { ...state.session, mode }, log };
    }

    case "CYCLE_SEAT": {
      const { seatKey, bodyConfig, memberLookup } = action;
      const ns = { ...state.seatStates };
      const oldPresent = getPresentIds(state.seatStates, bodyConfig);

      if (bodyConfig.type === "plenum") {
        ns[seatKey] = ns[seatKey] === "present" ? "absent" : "present";
      } else {
        const pair = bodyConfig.seatPairs.find((p) => p.regular === seatKey);
        if (!pair) return state;
        const cur = ns[pair.regular] || "regular";
        if (cur === "regular") ns[pair.regular] = pair.substitute ? "substitute" : "empty";
        else if (cur === "substitute") ns[pair.regular] = "empty";
        else ns[pair.regular] = "regular";
      }

      const newPresent = getPresentIds(ns, bodyConfig);
      const arrived: string[] = [];
      const departed: string[] = [];
      newPresent.forEach((id) => { if (!oldPresent.has(id)) arrived.push(id); });
      oldPresent.forEach((id) => { if (!newPresent.has(id)) departed.push(id); });

      const isActive = state.session.status === "active" || state.session.status === "paused";
      let ph = state.presenceHistory;
      const log = [...state.log];
      const now = ts();

      if (isActive) {
        ph = { ...ph };
        departed.forEach((id) => {
          ph[id] = [...(ph[id] || []), { state: "absent", ts: now }];
          const name = memberLookup[id] || id;
          log.push({ id: uuid(), timestamp: now, type: "presence_change",
            message: name + " ist abwesend", payload: { memberId: id, memberName: name, newState: "absent" },
            comment: "", mode: state.session.mode });
        });
        arrived.forEach((id) => {
          ph[id] = [...(ph[id] || []), { state: "present", ts: now }];
          const name = memberLookup[id] || id;
          log.push({ id: uuid(), timestamp: now, type: "presence_change",
            message: name + " ist anwesend", payload: { memberId: id, memberName: name, newState: "present" },
            comment: "", mode: state.session.mode });
        });
      }

      // laufende Abstimmung nachziehen
      let cv = state.currentVote;
      if (cv) {
        const nv = { ...cv.votes };
        departed.forEach((id) => { if (id in nv && nv[id] !== "absent") nv[id] = "absent"; });
        arrived.forEach((id) => { nv[id] = "no"; });
        cv = { ...cv, votes: nv };
      }

      return { ...state, seatStates: ns, presenceHistory: ph, currentVote: cv, log };
    }

    case "START_VOTE": {
      const votes: Record<string, VoteValue> = {};
      action.presentIds.forEach((id) => { votes[id] = "no"; });
      return { ...state, currentVote: {
        id: uuid(), title: "", agendaItem: action.agendaItem || "", comment: "",
        votes, memberNames: action.memberNames || {},
      } };
    }
    case "UPDATE_VOTE": {
      return { ...state, currentVote: { ...(state.currentVote as CurrentVote), ...action.fields } };
    }
    case "CAST_VOTE": {
      const cv = state.currentVote;
      if (!cv) return state;
      const cur = cv.votes[action.memberId];
      if (!cur || cur === "absent") return state;
      return { ...state, currentVote: { ...cv, votes: { ...cv.votes, [action.memberId]: cur === "yes" ? "no" : "yes" } } };
    }
    case "BULK_VOTE": {
      const cv = state.currentVote;
      if (!cv) return state;
      // Ohne memberIds trifft es alle; mit nur diese Teilmenge —
      // so arbeiten die Partei-Chips in der Legende.
      const only = action.memberIds ? new Set(action.memberIds) : null;
      const nv: Record<string, VoteValue> = {};
      Object.entries(cv.votes).forEach(([id, v]) => {
        if (v === "absent") { nv[id] = "absent"; return; }
        nv[id] = !only || only.has(id) ? action.value : v;
      });
      return { ...state, currentVote: { ...cv, votes: nv } };
    }
    case "CONFIRM_VOTE": {
      const cv = state.currentVote;
      if (!cv) return state;
      const yesVoters: string[] = [];
      const noVoters: string[] = [];
      const absentVoters: string[] = [];
      Object.entries(cv.votes).forEach(([id, v]) => {
        const name = cv.memberNames[id] || id;
        if (v === "yes") yesVoters.push(name);
        else if (v === "no") noVoters.push(name);
        else absentVoters.push(name);
      });
      yesVoters.sort(); noVoters.sort(); absentVoters.sort();
      const yes = yesVoters.length, no = noVoters.length, absent = absentVoters.length;
      const passed = yes > no;
      const now = ts();
      const record: VoteRecord = {
        id: cv.id, timestamp: now, title: cv.title, agendaItem: cv.agendaItem, comment: cv.comment,
        votes: cv.votes, memberNames: cv.memberNames,
        result: { yes, no, absent, eligible: yes + no, passed },
        yesVoters, noVoters, absentVoters,
        mode: state.session.mode,
      };
      const msg = "Abstimmung: " + cv.title + " – " + (passed ? "angenommen" : "abgelehnt") +
        " (" + yes + " Ja, " + no + " Nein" + (absent ? ", " + absent + " Abwesend" : "") + ")";
      const log: LogEntry[] = [...state.log, { id: uuid(), timestamp: now, type: "vote", message: msg,
        payload: record, comment: "", mode: state.session.mode }];
      return { ...state, votes: [...state.votes, record], currentVote: null, log };
    }
    case "CANCEL_VOTE": {
      return { ...state, currentVote: null };
    }

    case "ADD_LOG_COMMENT": {
      const log = state.log.map((e) => (e.id === action.logId ? { ...e, comment: action.comment } : e));
      return { ...state, log };
    }
    case "ADD_AGENDA": {
      return { ...state, agenda: [...state.agenda, { id: uuid(), title: action.title }] };
    }
    case "REMOVE_AGENDA": {
      return { ...state, agenda: state.agenda.filter((a) => a.id !== action.id) };
    }

    default: return state;
  }
}
