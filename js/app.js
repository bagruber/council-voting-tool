/* global React, ReactDOM, COUNCIL_DATA, JSZip */
const { useState, useReducer, useEffect, useMemo, useCallback, useRef } = React;

/* ── Utilities ────────────────────────────────────────── */
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
function ts() { return new Date().toISOString(); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

function contrastText(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 160 ? '#2D2D2D' : '#FFFFFF';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function download(content, filename, type) {
  downloadBlob(new Blob([content], { type }), filename);
}

/* Demo mode runs off the same reducer as a real session, so it must not
   touch — or be recovered from — the real session's backup slot. */
const DEMO_MODE = new URLSearchParams(location.search).has('demo');
const BACKUP_KEY = 'council-session-backup';

function clearBackup() {
  try { localStorage.removeItem(BACKUP_KEY); } catch (e) {}
}

/* ── Keyboard ─────────────────────────────────────────── */
const SHORTCUTS = [
  { key: 'A', label: 'Neue Abstimmung starten' },
  { key: 'J', label: 'Alle Ja' },
  { key: 'N', label: 'Alle Nein' },
  { key: '↵', label: 'Abstimmung speichern' },
  { key: 'Esc', label: 'Dialog schließen / Abstimmung abbrechen' },
  { key: '?', label: 'Diese Übersicht' },
];

/* Handlers are read through a ref so the listener binds once and still
   sees fresh state. Letter keys stay inert while a field has focus;
   Enter and Escape keep working there, since that is where they belong. */
function useHotkeys(handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t ? t.tagName : '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      const h = ref.current;

      if (e.key === 'Escape') { h.onCancel && h.onCancel(); return; }
      // Buttons, links and the agenda textarea own Enter themselves.
      if (e.key === 'Enter' && tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'A') {
        if (h.onSave && h.onSave()) e.preventDefault();
        return;
      }
      if (typing) return;

      switch (e.key.toLowerCase()) {
        case 'a': if (h.onNewVote) { e.preventDefault(); h.onNewVote(); } break;
        case 'j': if (h.onBulkYes) { e.preventDefault(); h.onBulkYes(); } break;
        case 'n': if (h.onBulkNo)  { e.preventDefault(); h.onBulkNo(); } break;
        case '?': if (h.onHelp)    { e.preventDefault(); h.onHelp(); } break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/* ── Demo ─────────────────────────────────────────────── */
/* ?demo opens a real, fully interactive session pinned to the Bauausschuss
   sitting of 13.07.2026 — its agenda file is picked up by the normal
   tagesordnung/ loader, so nothing here is faked. */
const DEMO_SESSION = {
  bodyId: 'bpu',
  date: '2026-07-13',
  title: 'Bau-, Planungs- und Umweltausschuss (Demo)',
};

/* Each step completes when the reducer state says it happened, so the tour
   follows whatever the user actually does — including out of order. */
const DEMO_STEPS = [
  { title: 'Sitzung eröffnen',
    hint: 'Oben rechts. Die Anwesenheit zu Beginn wird dabei namentlich protokolliert.',
    done: s => s.session.status !== 'idle' },
  { title: 'Stellvertretung einrücken lassen',
    hint: 'Einen Sitz anklicken: 1× Stellvertretung übernimmt, 2× Sitz bleibt leer, 3× zurück zum ordentlichen Mitglied. Nie sind beide gleichzeitig stimmberechtigt.',
    done: s => Object.values(s.seatStates).some(v => v !== 'regular' && v !== 'present') },
  { title: 'Abstimmung starten',
    hint: 'Auf einen TOP in der Tagesordnung klicken — der Punkt wird übernommen. Oder Taste A.',
    done: s => !!s.currentVote || s.votes.length > 0 },
  { title: 'Stimmen erfassen und speichern',
    hint: 'J = alle Ja, N = alle Nein, einzelne Stimmen über das Quadrat am Sitz. Dann Titel eintragen und speichern.',
    done: s => s.votes.length > 0 },
  { title: 'In den nichtöffentlichen Teil wechseln',
    hint: 'Der Button „Öffentlich“ schaltet um. Abstimmungen ab hier landen im getrennten Export.',
    done: s => s.log.some(e => e.type === 'session_nonpublic') },
  { title: 'Sitzung beenden',
    hint: '„Beenden“ schließt die Sitzung ab und gibt den Export frei.',
    done: s => s.session.status === 'ended' },
  { title: 'Protokoll exportieren',
    hint: 'ZIP enthält Protokolltext plus öffentliche und nichtöffentliche Abstimmungen getrennt.',
    done: () => false },
];

/* ── Reducer ──────────────────────────────────────────── */
const INITIAL_STATE = {
  bodyId: DEMO_MODE ? DEMO_SESSION.bodyId : 'plenum',
  session: {
    id: null,
    title: DEMO_MODE ? DEMO_SESSION.title : 'Stadtratssitzung',
    date: DEMO_MODE ? DEMO_SESSION.date : new Date().toISOString().slice(0, 10),
    location: 'Rathaus Moosburg, Sitzungssaal',
    status: 'idle', mode: 'public',
  },
  seatStates: {},
  presenceHistory: {},
  currentVote: null,
  votes: [],
  log: [],
  agenda: [],
};

function reducer(state, action) {
  switch (action.type) {

    case 'SELECT_BODY': {
      return { ...state, bodyId: action.bodyId, seatStates: {}, presenceHistory: {},
        currentVote: null, votes: [], log: [], agenda: [],
        session: { ...state.session, status: 'idle', title: action.bodyName || state.session.title } };
    }

    case 'INIT_SEATS': {
      const { bodyConfig, activeMembers } = action;
      const ss = {};
      if (bodyConfig.type === 'plenum') {
        activeMembers.forEach(m => { ss[m.id] = 'present'; });
      } else {
        bodyConfig.seatPairs.forEach(p => { ss[p.regular] = 'regular'; });
      }
      return { ...state, seatStates: ss };
    }

    case 'SET_AGENDA': {
      return { ...state, agenda: action.items.map(title => ({ id: uuid(), title })) };
    }

    case 'UPDATE_SESSION': {
      return { ...state, session: { ...state.session, ...action.fields } };
    }

    case 'START_SESSION': {
      const { bodyConfig, memberLookup } = action;
      const now = ts();
      const ph = {};
      const presentSet = getPresentIds(state.seatStates, bodyConfig);
      const presentNames = [], absentNames = [];

      // record initial presence for all eligible members
      const eligible = new Set();
      if (bodyConfig.type === 'plenum') {
        Object.keys(state.seatStates).forEach(id => eligible.add(id));
      } else {
        bodyConfig.seatPairs.forEach(p => { eligible.add(p.regular); if (p.substitute) eligible.add(p.substitute); });
        if (bodyConfig.chairId && !bodyConfig.seatPairs.find(p => p.regular === bodyConfig.chairId))
          eligible.add(bodyConfig.chairId);
      }
      eligible.forEach(id => {
        const present = presentSet.has(id);
        ph[id] = [{ state: present ? 'present' : 'absent', ts: now }];
        (present ? presentNames : absentNames).push(memberLookup[id] || id);
      });
      presentNames.sort(); absentNames.sort();

      const log = [...state.log, {
        id: uuid(), timestamp: now, type: 'session_start', message: 'Sitzung eröffnet',
        payload: { presentNames, absentNames, presentCount: presentNames.length, absentCount: absentNames.length },
        comment: '', mode: state.session.mode,
      }];
      return { ...state, session: { ...state.session, status: 'active', id: uuid() }, log, presenceHistory: ph };
    }

    case 'PAUSE_SESSION': {
      const log = [...state.log, { id: uuid(), timestamp: ts(), type: 'session_pause',
        message: 'Sitzung unterbrochen', payload: null, comment: '', mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: 'paused' }, log };
    }
    case 'RESUME_SESSION': {
      const log = [...state.log, { id: uuid(), timestamp: ts(), type: 'session_resume',
        message: 'Sitzung fortgesetzt', payload: null, comment: '', mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: 'active' }, log };
    }
    case 'END_SESSION': {
      const log = [...state.log, { id: uuid(), timestamp: ts(), type: 'session_end',
        message: 'Sitzung beendet', payload: null, comment: '', mode: state.session.mode }];
      return { ...state, session: { ...state.session, status: 'ended' }, log };
    }
    case 'SET_MODE': {
      const mode = action.mode;
      const log = [...state.log, { id: uuid(), timestamp: ts(),
        type: mode === 'public' ? 'session_public' : 'session_nonpublic',
        message: mode === 'public' ? 'Öffentlicher Teil' : 'Nichtöffentlicher Teil',
        payload: null, comment: '', mode }];
      return { ...state, session: { ...state.session, mode }, log };
    }

    case 'CYCLE_SEAT': {
      const { seatKey, bodyConfig, memberLookup } = action;
      const ns = { ...state.seatStates };
      const oldPresent = getPresentIds(state.seatStates, bodyConfig);

      if (bodyConfig.type === 'plenum') {
        ns[seatKey] = ns[seatKey] === 'present' ? 'absent' : 'present';
      } else {
        const pair = bodyConfig.seatPairs.find(p => p.regular === seatKey);
        if (!pair) return state;
        const cur = ns[pair.regular] || 'regular';
        if (cur === 'regular') ns[pair.regular] = pair.substitute ? 'substitute' : 'empty';
        else if (cur === 'substitute') ns[pair.regular] = 'empty';
        else ns[pair.regular] = 'regular';
      }

      const newPresent = getPresentIds(ns, bodyConfig);
      const arrived = [], departed = [];
      newPresent.forEach(id => { if (!oldPresent.has(id)) arrived.push(id); });
      oldPresent.forEach(id => { if (!newPresent.has(id)) departed.push(id); });

      const isActive = state.session.status === 'active' || state.session.status === 'paused';
      let ph = state.presenceHistory;
      let log = [...state.log];
      const now = ts();

      if (isActive) {
        ph = { ...ph };
        departed.forEach(id => {
          ph[id] = [...(ph[id] || []), { state: 'absent', ts: now }];
          const name = memberLookup[id] || id;
          log.push({ id: uuid(), timestamp: now, type: 'presence_change',
            message: name + ' ist abwesend', payload: { memberId: id, memberName: name, newState: 'absent' },
            comment: '', mode: state.session.mode });
        });
        arrived.forEach(id => {
          ph[id] = [...(ph[id] || []), { state: 'present', ts: now }];
          const name = memberLookup[id] || id;
          log.push({ id: uuid(), timestamp: now, type: 'presence_change',
            message: name + ' ist anwesend', payload: { memberId: id, memberName: name, newState: 'present' },
            comment: '', mode: state.session.mode });
        });
      }

      // sync current vote
      let cv = state.currentVote;
      if (cv) {
        const nv = { ...cv.votes };
        departed.forEach(id => { if (id in nv && nv[id] !== 'absent') nv[id] = 'absent'; });
        arrived.forEach(id => { nv[id] = 'no'; });
        cv = { ...cv, votes: nv };
      }

      return { ...state, seatStates: ns, presenceHistory: ph, currentVote: cv, log };
    }

    case 'START_VOTE': {
      const votes = {};
      action.presentIds.forEach(id => { votes[id] = 'no'; });
      return { ...state, currentVote: {
        id: uuid(), title: '', agendaItem: action.agendaItem || '', comment: '',
        votes, memberNames: action.memberNames || {},
      }};
    }
    case 'UPDATE_VOTE': {
      return { ...state, currentVote: { ...state.currentVote, ...action.fields } };
    }
    case 'CAST_VOTE': {
      const cv = state.currentVote;
      const cur = cv.votes[action.memberId];
      if (!cur || cur === 'absent') return state;
      return { ...state, currentVote: { ...cv, votes: { ...cv.votes, [action.memberId]: cur === 'yes' ? 'no' : 'yes' } } };
    }
    case 'BULK_VOTE': {
      const cv = state.currentVote;
      // Without memberIds this sets everyone; with it, only that subset —
      // which is how the party buttons in the legend work.
      const only = action.memberIds ? new Set(action.memberIds) : null;
      const nv = {};
      Object.entries(cv.votes).forEach(([id, v]) => {
        if (v === 'absent') { nv[id] = 'absent'; return; }
        nv[id] = (!only || only.has(id)) ? action.value : v;
      });
      return { ...state, currentVote: { ...cv, votes: nv } };
    }
    case 'CONFIRM_VOTE': {
      const cv = state.currentVote;
      const yesVoters = [], noVoters = [], absentVoters = [];
      Object.entries(cv.votes).forEach(([id, v]) => {
        const name = cv.memberNames[id] || id;
        if (v === 'yes') yesVoters.push(name);
        else if (v === 'no') noVoters.push(name);
        else absentVoters.push(name);
      });
      yesVoters.sort(); noVoters.sort(); absentVoters.sort();
      const yes = yesVoters.length, no = noVoters.length, absent = absentVoters.length;
      const passed = yes > no;
      const now = ts();
      const record = {
        id: cv.id, timestamp: now, title: cv.title, agendaItem: cv.agendaItem, comment: cv.comment,
        votes: cv.votes, memberNames: cv.memberNames,
        result: { yes, no, absent, eligible: yes + no, passed },
        yesVoters, noVoters, absentVoters,
        mode: state.session.mode,
      };
      const msg = 'Abstimmung: ' + cv.title + ' – ' + (passed ? 'angenommen' : 'abgelehnt') +
        ' (' + yes + ' Ja, ' + no + ' Nein' + (absent ? ', ' + absent + ' Abwesend' : '') + ')';
      const log = [...state.log, { id: uuid(), timestamp: now, type: 'vote', message: msg,
        payload: record, comment: '', mode: state.session.mode }];
      return { ...state, votes: [...state.votes, record], currentVote: null, log };
    }
    case 'CANCEL_VOTE': {
      return { ...state, currentVote: null };
    }

    case 'ADD_LOG_COMMENT': {
      const log = state.log.map(e => e.id === action.logId ? { ...e, comment: action.comment } : e);
      return { ...state, log };
    }
    case 'ADD_AGENDA': {
      return { ...state, agenda: [...state.agenda, { id: uuid(), title: action.title }] };
    }
    case 'REMOVE_AGENDA': {
      return { ...state, agenda: state.agenda.filter(a => a.id !== action.id) };
    }

    default: return state;
  }
}

/* ── Derived helpers ──────────────────────────────────── */
function getPresentIds(seatStates, bodyConfig) {
  const s = new Set();
  if (!bodyConfig) return s;
  if (bodyConfig.type === 'plenum') {
    Object.entries(seatStates).forEach(([id, st]) => { if (st === 'present') s.add(id); });
  } else {
    bodyConfig.seatPairs.forEach(p => {
      const st = seatStates[p.regular] || 'regular';
      if (st === 'regular') s.add(p.regular);
      else if (st === 'substitute' && p.substitute) s.add(p.substitute);
    });
  }
  return s;
}

function getSeatInfo(memberId, bodyConfig, seatStates) {
  if (!bodyConfig) return { eligible: false, active: false, role: 'none', substituteFor: null };
  if (bodyConfig.type === 'plenum') {
    return { eligible: true, active: seatStates[memberId] === 'present', role: 'member', substituteFor: null };
  }
  const regPair = bodyConfig.seatPairs.find(p => p.regular === memberId);
  if (regPair) {
    const st = seatStates[regPair.regular] || 'regular';
    return { eligible: true, active: st === 'regular', role: regPair.role || 'member', substituteFor: null };
  }
  const subPair = bodyConfig.seatPairs.find(p => p.substitute === memberId);
  if (subPair) {
    const st = seatStates[subPair.regular] || 'regular';
    return { eligible: true, active: st === 'substitute', role: 'substitute', substituteFor: subPair.regular };
  }
  return { eligible: false, active: false, role: 'none', substituteFor: null };
}

function getMemberRoleText(member, bodyConfig, seatInfo) {
  if (bodyConfig.type === 'plenum') {
    if (member.role === 'mayor') return member.title || 'Bürgermeister/in';
    return member.title ? 'Stadtrat · ' + member.title : 'Stadtrat';
  }
  if (!seatInfo.eligible) return '—';
  if (seatInfo.role === 'chair') return 'Vorsitz';
  if (seatInfo.role === 'vicechair') return 'Stellv. Vorsitz';
  if (seatInfo.role === 'substitute') return 'Stellvertretung';
  return 'Mitglied';
}

function classifyAbsence(memberId, voteTimestamp, presenceHistory) {
  const h = presenceHistory[memberId] || [];
  const wasPresentBefore = h.some(e => e.state === 'present' && e.ts <= voteTimestamp);
  const wasPresentAfter = h.some(e => e.state === 'present' && e.ts > voteTimestamp);
  return (wasPresentBefore && wasPresentAfter) ? 'short' : 'general';
}

/* Two councillors can share a surname — Karin Linz (CSU) and Kilian Linz
   (Grüne) both sit in this council, and plain initials render both as "KL".
   Where a surname repeats, extend the label and the disc with the shortest
   first-name prefix that tells them apart. */
function buildSeatNames(members) {
  const bySurname = {};
  members.forEach(m => { (bySurname[m.lastName] = bySurname[m.lastName] || []).push(m); });

  const out = {};
  members.forEach(m => {
    const group = bySurname[m.lastName];
    if (group.length === 1) {
      out[m.id] = { label: m.lastName, initials: m.firstName.charAt(0) + m.lastName.charAt(0) };
      return;
    }
    const clashes = n => group.some(o =>
      o.id !== m.id && o.firstName.slice(0, n).toLowerCase() === m.firstName.slice(0, n).toLowerCase());
    let n = 1;
    while (n < m.firstName.length && clashes(n)) n++;
    const prefix = m.firstName.slice(0, n);
    out[m.id] = { label: prefix + '. ' + m.lastName, initials: prefix + m.lastName.charAt(0) };
  });
  return out;
}

function getLabelPlacement(x, y) {
  const dx = x - 50;
  if (y > 70) return dx >= 0 ? 'right' : 'left';
  if (Math.abs(dx) > 12) return dx > 0 ? 'right' : 'left';
  if (y < 30) return 'above';
  return dx >= 0 ? 'right' : 'left';
}

/* Canonical German phrasing for one log entry. The on-screen protocol and
   the TXT/MD exports both read from here so their wording cannot drift.
   Returns null for entries that carry no narrative line. */
function logEntryText(entry) {
  const p = entry.payload;
  switch (entry.type) {
    case 'presence_change':
      if (!p) return null;
      return p.newState === 'present'
        ? p.memberName + ' ist der Sitzung beigetreten'
        : p.memberName + ' hat die Sitzung verlassen';
    case 'vote': {
      if (!p) return null;
      let s = 'Abstimmung: ' + p.title;
      if (p.agendaItem) s += ' (' + p.agendaItem + ')';
      s += ' – ' + (p.result.passed ? 'angenommen' : 'abgelehnt') +
        ' (' + p.result.yes + ' Ja, ' + p.result.no + ' Nein' +
        (p.result.absent ? ', ' + p.result.absent + ' Abwesend' : '') + ')';
      return s;
    }
    case 'session_end':       return 'Sitzung beendet';
    case 'session_pause':     return 'Sitzung unterbrochen';
    case 'session_resume':    return 'Sitzung fortgesetzt';
    case 'session_public':    return 'Öffentlicher Teil';
    case 'session_nonpublic': return 'Nichtöffentlicher Teil';
    default: return null;
  }
}

/* ── Human-readable protocol text ─────────────────────── */
function generateHumanProtocol(state, bodyName) {
  let t = '';
  t += 'SITZUNGSPROTOKOLL\n==================\n\n';
  t += state.session.title + '\n';
  t += 'Datum: ' + fmtDate(state.session.date) + '\n';
  t += 'Ort:   ' + state.session.location + '\n';
  t += 'Gremium: ' + bodyName + '\n\n';

  const startEntry = state.log.find(e => e.type === 'session_start');
  if (startEntry && startEntry.payload) {
    const p = startEntry.payload;
    t += 'ANWESENHEIT ZU BEGINN (' + fmtTime(startEntry.timestamp) + ')\n';
    t += 'Anwesend (' + p.presentCount + '):\n';
    p.presentNames.forEach(n => { t += '  ' + n + '\n'; });
    if (p.absentCount > 0) {
      t += 'Abwesend (' + p.absentCount + '):\n';
      p.absentNames.forEach(n => { t += '  ' + n + '\n'; });
    }
    t += '\n';
  }

  t += 'VERLAUF\n-------\n\n';
  state.log.forEach(entry => {
    const text = logEntryText(entry);
    if (text) t += fmtTime(entry.timestamp) + '  ' + text + '\n';
  });

  if (state.votes.length) {
    t += '\nABSTIMMUNGEN (DETAIL)\n---------------------\n\n';
    state.votes.forEach((v, i) => {
      t += (i + 1) + '. ' + v.title + '\n';
      if (v.agendaItem) t += '   TOP: ' + v.agendaItem + '\n';
      t += '   Ergebnis: ' + v.result.yes + ' Ja, ' + v.result.no + ' Nein';
      if (v.result.absent) t += ', ' + v.result.absent + ' Abwesend';
      t += ' – ' + (v.result.passed ? 'angenommen' : 'abgelehnt') + '\n';
      if (v.comment) t += '   Kommentar: ' + v.comment + '\n';
      if (v.yesVoters.length) { t += '   Ja (' + v.yesVoters.length + '):\n'; v.yesVoters.forEach(n => { t += '     ' + n + '\n'; }); }
      if (v.noVoters.length) { t += '   Nein (' + v.noVoters.length + '):\n'; v.noVoters.forEach(n => { t += '     ' + n + '\n'; }); }
      if (v.absentVoters.length) { t += '   Abwesend (' + v.absentVoters.length + '):\n'; v.absentVoters.forEach(n => { t += '     ' + n + '\n'; }); }
      t += '\n';
    });
  }
  return t;
}

/* ── Export helpers ────────────────────────────────────── */
function buildPresenceJSON(state, memberLookup) {
  const entries = [];
  Object.entries(state.presenceHistory).forEach(([id, history]) => {
    const name = memberLookup[id] || id;
    const verlauf = history.map(h => ({ status: h.state === 'present' ? 'anwesend' : 'abwesend', zeit: fmtTime(h.ts) }));
    entries.push({ id, name, verlauf });
  });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

function buildVoteJSON(vote, presenceHistory) {
  const shortAbsent = [], generalAbsent = [];
  if (vote.absentVoters) {
    vote.absentVoters.forEach(name => {
      const id = Object.entries(vote.memberNames || {}).find(([_, n]) => n === name)?.[0];
      if (id) {
        const type = classifyAbsence(id, vote.timestamp, presenceHistory);
        (type === 'short' ? shortAbsent : generalAbsent).push(name);
      } else { generalAbsent.push(name); }
    });
  }
  return {
    titel: vote.title, top: vote.agendaItem || '', kommentar: vote.comment || '',
    ergebnis: { ja: vote.result.yes, nein: vote.result.no, abwesend: vote.result.absent, angenommen: vote.result.passed },
    ja: vote.yesVoters || [], nein: vote.noVoters || [],
    kurzzeitig_abwesend: shortAbsent.sort(), abwesend: generalAbsent.sort(),
  };
}

/* The full ZIP bundle: readable protocol plus the public and non-public
   vote records split into separate files. Shared by the export panel and
   the crash-recovery dialog. */
function buildZipBlob(state, memberLookup, bodyName) {
  const zip = new JSZip();
  zip.file('protokoll.txt', generateHumanProtocol(state, bodyName));

  const base = {
    sitzung: { titel: state.session.title, datum: state.session.date,
      ort: state.session.location, gremium: bodyName },
    anwesenheit: buildPresenceJSON(state, memberLookup),
  };
  const votesFor = mode => state.votes
    .filter(v => v.mode === mode)
    .map(v => buildVoteJSON(v, state.presenceHistory));

  zip.file('oeffentlich.json', JSON.stringify({ ...base, teil: 'öffentlich', abstimmungen: votesFor('public') }, null, 2));
  zip.file('nichtoeffentlich.json', JSON.stringify({ ...base, teil: 'nichtöffentlich', abstimmungen: votesFor('nonpublic') }, null, 2));

  return zip.generateAsync({ type: 'blob' });
}

/* Toggling a seat always acts on the regular member's seat key, even when
   the substitute was the one clicked. Shared by the circle and the cards. */
function usePresenceToggle(bodyConfig, dispatch, memberLookup) {
  return useCallback(id => {
    if (bodyConfig.type !== 'plenum') {
      const pair = bodyConfig.seatPairs.find(p => p.substitute === id);
      if (pair) { dispatch({ type: 'CYCLE_SEAT', seatKey: pair.regular, bodyConfig, memberLookup }); return; }
    }
    dispatch({ type: 'CYCLE_SEAT', seatKey: id, bodyConfig, memberLookup });
  }, [bodyConfig, dispatch, memberLookup]);
}

/* ── Components ───────────────────────────────────────── */

function BodySelector({ bodyId, bodies, onChange }) {
  return (
    <select value={bodyId} onChange={e => onChange(e.target.value)}
      className="bg-white/20 border border-white/30 rounded-lg px-3 py-2 font-serif font-bold text-white focus:outline-none focus:ring-2 focus:ring-white/50">
      {bodies.map(b => <option key={b.id} value={b.id} className="text-tx bg-surface">{b.shortName || b.name}</option>)}
    </select>
  );
}

function SessionControls({ session, dispatch, bodyConfig, memberLookup }) {
  const { status, mode } = session;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'idle' && (
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light transition-colors shadow"
          onClick={() => dispatch({ type: 'START_SESSION', bodyConfig, memberLookup })}>Sitzung eröffnen</button>
      )}
      {status === 'active' && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-yellow-300 text-yellow-900 hover:bg-yellow-200 shadow"
          onClick={() => dispatch({ type: 'PAUSE_SESSION' })}>Unterbrechen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 shadow border border-red-200"
          onClick={() => dispatch({ type: 'END_SESSION' })}>Beenden</button>
      </>}
      {status === 'paused' && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light shadow"
          onClick={() => dispatch({ type: 'RESUME_SESSION' })}>Fortsetzen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 shadow border border-red-200"
          onClick={() => dispatch({ type: 'END_SESSION' })}>Beenden</button>
      </>}
      {(status === 'active' || status === 'paused') && (
        <button className={'px-4 py-2 rounded-lg font-semibold text-sm shadow ' +
          (mode === 'public' ? 'bg-white/80 text-tx' : 'bg-gray-700 text-white')}
          onClick={() => dispatch({ type: 'SET_MODE', mode: mode === 'public' ? 'nonpublic' : 'public' })}>
          {mode === 'public' ? 'Öffentlich' : 'Nichtöffentlich'}
        </button>
      )}
      {status === 'ended' && <span className="text-white/70 font-serif italic">Sitzung beendet</span>}
    </div>
  );
}

function SessionHeader({ session, bodyId, bodies, dispatch, bodyConfig, memberLookup, onShowHelp }) {
  return (
    <header className="bg-gradient-to-r from-primary-dark to-primary text-white px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <BodySelector bodyId={bodyId} bodies={bodies} onChange={id => {
            const b = bodies.find(x => x.id === id);
            dispatch({ type: 'SELECT_BODY', bodyId: id, bodyName: b ? b.name : '' });
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
            aria-label="Tastaturkürzel anzeigen" title="Tastaturkürzel (?)">?</button>
        </div>
      </div>
    </header>
  );
}

/* ── Council Circle ───────────────────────────────────── */

function SeatCircle({ member, names, partyColor, seatInfo, voting, voteValue, onPresence, onVote, labelPlacement }) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isAbsentInVote = voting && voteValue === 'absent';
  // While a vote is open the seat casts the vote — that is what nearly every
  // click during a vote means. Presence moves to the member cards below.
  const castsVote = voting && voteValue !== undefined && !isAbsentInVote;
  const isSub = seatInfo.role === 'substitute';
  const fullName = member.firstName + ' ' + member.lastName;
  const label = names.label.length > 14 ? names.label.substring(0, 13) + '.' : names.label;

  // Absent members of this body read as a gap in the ring: pushed outward by
  // the parent, hollow, and dimmed — three redundant cues for one state.
  const hollow = eligible && !active;
  const style = !eligible
    ? { backgroundColor: '#DDDCD8', color: '#8A8A87', border: 'none' }
    : hollow
      ? { backgroundColor: '#FFFFFF', color: '#6B6B68', border: (isSub ? '2px dashed ' : '2px solid ') + '#B9B8B3' }
      : { backgroundColor: partyColor, color: contrastText(partyColor), border: isSub ? '2px dashed #5A5A57' : 'none' };

  return (
    <div className="relative inline-flex items-center justify-center">
      <button type="button" disabled={!eligible || (voting && !castsVote)}
        className={'seat-node relative ' + (eligible ? '' : 'disabled ') + (hollow ? 'absent-seat' : '')}
        onClick={() => (castsVote ? onVote(member.id) : onPresence(member.id))}
        aria-pressed={castsVote ? voteValue === 'yes' : (eligible ? active : undefined)}
        aria-label={castsVote
          ? fullName + ' – Stimme ' + (voteValue === 'yes' ? 'Ja' : 'Nein') + ', klicken zum Wechseln'
          : fullName + (isSub ? ' (Vertretung)' : '') + ' – ' + (active ? 'anwesend' : 'abwesend')}
        title={fullName + (isSub ? ' [Vertretung]' : '')}>
        <span className={'seat-circle rounded-full flex items-center justify-center font-bold' + (hollow ? '' : ' shadow-card')}
          style={style}>
          <span className="seat-initials">{names.initials}</span>
        </span>
        <span className={'seat-label-outside lbl-' + (labelPlacement || 'above')}
          style={{ color: eligible ? '#2D2D2D' : '#8A8A87' }}>
          {label}
        </span>
      </button>
      {castsVote && (
        <span className={'vote-badge seat-vote-badge absolute -bottom-1 -right-1 flex items-center justify-center rounded ' +
          (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')} aria-hidden="true">
          <span className="text-white font-bold">{voteValue === 'yes' ? '✓' : '✗'}</span>
        </span>
      )}
      {isAbsentInVote && (
        <span className="seat-vote-badge absolute -bottom-1 -right-1 flex items-center justify-center rounded bg-absent"
          title={fullName + ' – abwesend'}>
          <span className="text-white font-bold">—</span>
        </span>
      )}
    </div>
  );
}

function CouncilCircle({ councillors, mayor, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup, seatNames }) {
  // Reverse order so it's from the chair's perspective
  const ordered = useMemo(
    () => COUNCIL_DATA.buildSeatOrder(councillors, data.seatOrder, data.councilOrder).reverse(),
    [councillors, data.seatOrder, data.councilOrder]
  );
  const n = ordered.length;

  // 27-slot symmetric arrangement: slot 0 = mayor (bottom center),
  // slots 1 and 26 intentionally empty as buffer, councillors fill slots 2..25.
  const SLOT_DEG = 360 / 27;
  const MAX_COUNCIL_SLOTS = 24;
  const startSlot = 2 + Math.max(0, Math.floor((MAX_COUNCIL_SLOTS - n) / 2));

  // Radii as a percentage of the container. Members of this body who are not
  // present sit on the outer radius, so the ring shows a visible gap.
  const R_SEATED = 41;
  const R_AWAY = 46;

  function slotToPos(slot, radius) {
    const deg = 90 - slot * SLOT_DEG;
    const rad = deg * Math.PI / 180;
    return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) };
  }

  const handlePresence = usePresenceToggle(bodyConfig, dispatch, memberLookup);

  const handleVote = useCallback(id => {
    dispatch({ type: 'CAST_VOTE', memberId: id });
  }, [dispatch]);

  const voting = !!currentVote;

  return (
    <div className="relative mx-auto council-circle-container" style={{ width: '100%', maxWidth: 640, aspectRatio: '1' }}>
      {ordered.map((m, i) => {
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const away = info.eligible && !info.active;
        const seated = slotToPos(startSlot + i, R_SEATED);
        const pos = away ? slotToPos(startSlot + i, R_AWAY) : seated;
        const party = COUNCIL_DATA.getParty(data.parties, m.currentParty);
        // Placement comes from the seated position so a label never flips
        // sides just because someone stepped out.
        const lbl = getLabelPlacement(seated.x, seated.y);
        return (
          <div key={m.id} className="seat-slot" style={{ left: pos.x + '%', top: pos.y + '%' }}>
            <SeatCircle member={m} names={seatNames[m.id]} partyColor={party.color} seatInfo={info}
              voting={voting} voteValue={currentVote?.votes[m.id]} labelPlacement={lbl}
              onPresence={handlePresence} onVote={handleVote} />
          </div>
        );
      })}

      {mayor && (() => {
        const info = getSeatInfo(mayor.id, bodyConfig, seatStates);
        const away = info.eligible && !info.active;
        const party = COUNCIL_DATA.getParty(data.parties, mayor.currentParty);
        const mp = slotToPos(0, away ? R_AWAY : R_SEATED);
        return (
          <div className="seat-slot" style={{ left: mp.x + '%', top: mp.y + '%' }}>
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

function CenterStats({ seatStates, bodyConfig, currentVote }) {
  const present = getPresentIds(seatStates, bodyConfig);
  const total = bodyConfig ? (bodyConfig.type === 'plenum'
    ? bodyConfig.seatPairs.length + (bodyConfig.chairId ? 1 : 0)
    : bodyConfig.seatPairs.length + (bodyConfig.seatPairs.find(p => p.role === 'chair') ? 0 : bodyConfig.chairId ? 1 : 0)
  ) : 0;

  if (currentVote) {
    const yes = Object.values(currentVote.votes).filter(v => v === 'yes').length;
    const no  = Object.values(currentVote.votes).filter(v => v === 'no').length;
    const absent = Object.values(currentVote.votes).filter(v => v === 'absent').length;
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

/* ── Member Cards ────────────────────────────────────── */

function MemberCard({ member, partyColor, partyName, seatInfo, voting, voteValue, onPresence, onVote, bodyConfig }) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isInVote = voting && voteValue !== undefined;
  const isAbsentInVote = voting && voteValue === 'absent';
  const roleText = getMemberRoleText(member, bodyConfig, seatInfo);
  const dimmed = (!eligible || (!active && !voting) || isAbsentInVote) ? 'opacity-55' : '';
  const fullName = member.firstName + ' ' + member.lastName;

  return (
    <div className={'relative bg-surface rounded-lg border border-brd ' + dimmed}>
      <button type="button" disabled={!eligible}
        className="card-btn w-full text-left p-3 pr-14 disabled:cursor-default"
        onClick={() => onPresence(member.id)}
        aria-pressed={eligible ? active : undefined}
        aria-label={fullName + ' – ' + (active ? 'anwesend' : 'abwesend')}>
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
            className={'vote-indicator flex items-center justify-center rounded w-8 h-8 ' +
              (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')}
            onClick={() => onVote(member.id)}
            aria-label={fullName + ' – Stimme ' + (voteValue === 'yes' ? 'Ja' : 'Nein') + ', klicken zum Wechseln'}>
            <span className="text-white font-bold t-body">{voteValue === 'yes' ? '✓' : '✗'}</span>
          </button>
        )}
        {voting && isAbsentInVote && (
          <span className="flex items-center justify-center rounded w-8 h-8 bg-absent" title={fullName + ' – abwesend'}>
            <span className="text-white font-bold t-body">—</span>
          </span>
        )}
        {!voting && eligible && (
          <span className={'block w-3 h-3 rounded-full ' + (active ? 'bg-vote-yes' : 'bg-absent')}></span>
        )}
      </div>
    </div>
  );
}

function MemberCards({ allMembers, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup }) {
  const voting = !!currentVote;

  const handlePresence = usePresenceToggle(bodyConfig, dispatch, memberLookup);

  const handleVote = useCallback(id => {
    dispatch({ type: 'CAST_VOTE', memberId: id });
  }, [dispatch]);

  // Strictly alphabetical by surname
  const sorted = useMemo(() => [...allMembers].sort((a, b) => a.lastName.localeCompare(b.lastName)), [allMembers]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {sorted.map(m => {
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const party = COUNCIL_DATA.getParty(data.parties, m.currentParty);
        return (
          <MemberCard key={m.id} member={m} partyColor={party.color} partyName={party.name}
            seatInfo={info} voting={voting} voteValue={currentVote?.votes[m.id]}
            onPresence={handlePresence} onVote={handleVote} bodyConfig={bodyConfig} />
        );
      })}
    </div>
  );
}

/* ── Vote Panel ───────────────────────────────────────── */

function VotePanel({ currentVote, session, dispatch, agenda, startVote, showConfirm, onRequestConfirm, onCancelConfirm }) {
  if (session.status !== 'active' && session.status !== 'paused') return null;

  if (!currentVote) {
    return (
      <div className="bg-surface rounded-lg border border-brd p-4">
        <button className="w-full py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary-dark transition-colors"
          onClick={() => startVote()}>
          Neue Abstimmung <kbd className="ml-1 align-middle">A</kbd>
        </button>
      </div>
    );
  }

  const yes = Object.values(currentVote.votes).filter(v => v === 'yes').length;
  const no  = Object.values(currentVote.votes).filter(v => v === 'no').length;
  const absent = Object.values(currentVote.votes).filter(v => v === 'absent').length;
  const voting = yes + no;

  return (
    <div className="bg-surface rounded-lg border border-brd p-4 space-y-3">
      <h3 className="panel-title">Abstimmung</h3>
      <input type="text" placeholder="Titel der Abstimmung *" value={currentVote.title}
        onChange={e => dispatch({ type: 'UPDATE_VOTE', fields: { title: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="text" placeholder="Tagesordnungspunkt" value={currentVote.agendaItem} list="agenda-list"
        onChange={e => dispatch({ type: 'UPDATE_VOTE', fields: { agendaItem: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <datalist id="agenda-list">{agenda.map(a => <option key={a.id} value={a.title} />)}</datalist>
      <textarea placeholder="Kommentar (optional)" value={currentVote.comment} rows={2}
        onChange={e => dispatch({ type: 'UPDATE_VOTE', fields: { comment: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary focus:outline-none" />
      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-vote-yes text-white rounded-lg font-bold text-sm hover:opacity-90"
          onClick={() => dispatch({ type: 'BULK_VOTE', value: 'yes' })}>Alle Ja <kbd className="ml-1 align-middle">J</kbd></button>
        <button className="flex-1 py-2 bg-vote-no text-white rounded-lg font-bold text-sm hover:opacity-90"
          onClick={() => dispatch({ type: 'BULK_VOTE', value: 'no' })}>Alle Nein <kbd className="ml-1 align-middle">N</kbd></button>
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
          onClick={() => dispatch({ type: 'CANCEL_VOTE' })}>Abbrechen</button>
        <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark disabled:opacity-40"
          disabled={!currentVote.title.trim()} onClick={onRequestConfirm}>Speichern</button>
      </div>
      {showConfirm && (
        <VoteConfirmModal vote={currentVote} yes={yes} no={no} absent={absent} voting={voting}
          passed={yes > no}
          onConfirm={() => { onCancelConfirm(); dispatch({ type: 'CONFIRM_VOTE' }); }}
          onCancel={onCancelConfirm} />
      )}
    </div>
  );
}

function VoteConfirmModal({ vote, yes, no, absent, voting, passed, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-surface rounded-xl shadow-card-lg p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-serif font-bold text-lg text-primary-dark mb-4">Abstimmung bestätigen</h3>
        <p className="font-semibold mb-2">{vote.title}</p>
        {vote.agendaItem && <p className="text-sm text-tx-m mb-2">{vote.agendaItem}</p>}
        <div className="flex justify-around py-4 border-y border-brd my-3">
          <div className="text-center"><div className="text-2xl font-bold text-vote-yes">{yes}</div><div className="text-xs text-tx-m">Ja</div></div>
          <div className="text-center"><div className="text-2xl font-bold text-vote-no">{no}</div><div className="text-xs text-tx-m">Nein</div></div>
          {absent > 0 && <div className="text-center"><div className="text-2xl font-bold text-absent">{absent}</div><div className="text-xs text-tx-m">Abwesend</div></div>}
          <div className="text-center"><div className="text-2xl font-bold">{voting}</div><div className="text-xs text-tx-m">Abstimmende</div></div>
        </div>
        <div className={'text-center font-bold text-lg mb-4 ' + (passed ? 'text-vote-yes' : 'text-vote-no')}>
          {passed ? 'ANGENOMMEN' : 'ABGELEHNT'}
        </div>
        <div className="flex gap-2">
          <button className="flex-1 py-2 bg-gray-200 rounded-lg font-semibold" onClick={onCancel}>Zurück</button>
          <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold" onClick={onConfirm}>Bestätigen</button>
        </div>
      </div>
    </div>
  );
}

/* ── Agenda ────────────────────────────────────────────── */
function AgendaPanel({ agenda, dispatch, startVote, canStartVote, votedItems }) {
  const [val, setVal] = useState('');
  const submit = () => {
    const titles = val.split('\n').map(s => s.trim()).filter(Boolean);
    if (!titles.length) return;
    titles.forEach(title => dispatch({ type: 'ADD_AGENDA', title }));
    setVal('');
  };
  return (
    <div className="bg-surface rounded-lg border border-brd p-4">
      <h3 className="panel-title mb-2">Tagesordnung</h3>
      <div className="flex gap-2 mb-1">
        <textarea value={val} placeholder="Neuer TOP… (Enter = hinzufügen, Shift+Enter = neue Zeile)" rows={1}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          className="flex-1 border border-brd rounded-lg px-3 py-1.5 text-sm resize-y focus:ring-2 focus:ring-primary focus:outline-none" />
        <button className="px-3 py-1.5 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30 self-start"
          onClick={submit}>+</button>
      </div>
      <p className="text-xs text-tx-m mb-2">
        {canStartVote
          ? 'TOP anklicken startet eine Abstimmung dazu.'
          : 'Mehrere Zeilen = mehrere TOPs auf einmal.'}
      </p>
      <ul className="space-y-0.5 t-body max-h-56 overflow-y-auto">
        {agenda.map(a => {
          const voted = votedItems.has(a.title);
          return (
            <li key={a.id} className="flex items-start gap-1 group">
              <button type="button" disabled={!canStartVote}
                className={'agenda-btn flex-1 text-left rounded px-1.5 py-1 -ml-1.5 ' +
                  (canStartVote ? 'hover:bg-accent-light cursor-pointer' : 'cursor-default') +
                  (voted ? ' text-tx-m' : '')}
                onClick={() => startVote(a.title)}
                title={canStartVote ? 'Abstimmung zu diesem TOP starten' : undefined}>
                {voted && <span className="text-vote-yes mr-1" aria-label="bereits abgestimmt">✓</span>}
                {a.title}
              </button>
              <button className="text-tx-m hover:text-vote-no opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs px-1 pt-1.5"
                aria-label={'TOP entfernen: ' + a.title}
                onClick={() => dispatch({ type: 'REMOVE_AGENDA', id: a.id })}>&times;</button>
            </li>
          );
        })}
        {agenda.length === 0 && <li className="text-tx-m italic">Keine Einträge</li>}
      </ul>
    </div>
  );
}

/* ── Protocol Log ─────────────────────────────────────── */
function ProtocolLog({ log, state, bodyName, dispatch }) {
  const [tab, setTab] = useState('human');
  if (log.length === 0) return null;

  return (
    <div className="bg-surface rounded-lg border border-brd p-4">
      <div className="flex gap-4 mb-3 border-b border-brd">
        <button className={'pb-2 text-sm ' + (tab === 'human' ? 'tab-active' : 'tab-inactive')}
          onClick={() => setTab('human')}>Protokoll</button>
        <button className={'pb-2 text-sm ' + (tab === 'tech' ? 'tab-active' : 'tab-inactive')}
          onClick={() => setTab('tech')}>Technisches Log</button>
      </div>

      {tab === 'human' && <HumanProtocol log={log} state={state} bodyName={bodyName} />}
      {tab === 'tech' && (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {[...log].reverse().map(entry => <LogEntryRow key={entry.id} entry={entry} dispatch={dispatch} />)}
        </div>
      )}
    </div>
  );
}

function HumanProtocol({ log, state, bodyName }) {
  const startEntry = log.find(e => e.type === 'session_start');
  return (
    <div className="space-y-4 text-sm max-h-96 overflow-y-auto">
      {startEntry && startEntry.payload && (
        <div>
          <h4 className="panel-title mb-1">
            Anwesenheit zu Beginn ({fmtTime(startEntry.timestamp)})
          </h4>
          <p className="text-vote-yes">
            <span className="font-semibold">Anwesend ({startEntry.payload.presentCount}):</span>{' '}
            {startEntry.payload.presentNames.join('; ')}
          </p>
          {startEntry.payload.absentCount > 0 && (
            <p className="text-absent">
              <span className="font-semibold">Abwesend ({startEntry.payload.absentCount}):</span>{' '}
              {startEntry.payload.absentNames.join('; ')}
            </p>
          )}
        </div>
      )}
      <div>
        <h4 className="panel-title mb-1">Verlauf</h4>
        <div className="space-y-1">
          {log.map(entry => {
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

function LogEntryRow({ entry, dispatch }) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(entry.comment);
  const typeLabels = {
    session_start: 'Start', session_pause: 'Pause', session_resume: 'Weiter', session_end: 'Ende',
    session_public: 'Modus', session_nonpublic: 'Modus', presence_change: 'Anwesenheit', vote: 'Abstimmung',
  };
  const typeColors = {
    session_start: 'bg-vote-yes', session_end: 'bg-vote-no', vote: 'bg-info',
    session_pause: 'bg-yellow-400', session_resume: 'bg-vote-yes', presence_change: 'bg-accent',
    session_public: 'bg-accent-light', session_nonpublic: 'bg-gray-500',
  };
  return (
    <div className="log-enter flex gap-3 items-start text-sm border-b border-brd/50 pb-2">
      <span className="text-tx-m text-xs whitespace-nowrap pt-0.5">{fmtTime(entry.timestamp)}</span>
      <span className={'text-xs uppercase font-bold px-2 py-0.5 rounded text-white ' + (typeColors[entry.type] || 'bg-gray-400')}>
        {typeLabels[entry.type] || entry.type}
      </span>
      <div className="flex-1">
        <span>{entry.message}</span>
        {entry.mode && <span className="text-xs text-tx-m ml-1">[{entry.mode === 'public' ? 'öff.' : 'n.öff.'}]</span>}
        {entry.comment && !editing && (
          <p className="text-tx-m text-xs italic mt-0.5 cursor-pointer" onClick={() => setEditing(true)}>
            Kommentar: {entry.comment}
          </p>
        )}
        {editing ? (
          <div className="flex gap-1 mt-1">
            <input type="text" value={comment} onChange={e => setComment(e.target.value)}
              className="flex-1 border border-brd rounded px-2 py-0.5 text-xs" autoFocus />
            <button className="text-xs text-primary font-bold" onClick={() => {
              dispatch({ type: 'ADD_LOG_COMMENT', logId: entry.id, comment }); setEditing(false);
            }}>OK</button>
          </div>
        ) : (
          <button className="text-xs text-tx-m hover:text-primary ml-2" onClick={() => setEditing(true)}>[Kommentar]</button>
        )}
      </div>
    </div>
  );
}

/* ── Export ────────────────────────────────────────────── */
function ExportPanel({ state, activeMembers, memberLookup, bodyName, onDownloaded }) {
  const doTxt = () => {
    const txt = generateHumanProtocol(state, bodyName);
    download(txt, 'protokoll-' + state.session.date + '.txt', 'text/plain');
    if (onDownloaded) onDownloaded();
  };

  const doJSON = () => {
    const data = {
      session: { id: state.session.id, date: state.session.date, title: state.session.title,
        location: state.session.location, body: state.bodyId },
      members: activeMembers.map(m => ({ id: m.id, name: m.firstName + ' ' + m.lastName, party: m.currentParty })),
      log: state.log, votes: state.votes,
    };
    download(JSON.stringify(data, null, 2), 'protokoll-' + state.session.date + '.json', 'application/json');
    if (onDownloaded) onDownloaded();
  };

  const doMD = () => {
    let md = '# Sitzungsprotokoll\n\n**' + state.session.title + '**\n';
    md += 'Datum: ' + fmtDate(state.session.date) + '\nOrt: ' + state.session.location + '\n\n## Protokoll\n\n';
    state.log.forEach(e => {
      md += '- **' + fmtTime(e.timestamp) + '** [' + e.type + '] ' + e.message;
      if (e.comment) md += ' _(' + e.comment + ')_';
      md += '\n';
    });
    if (state.votes.length) {
      md += '\n## Abstimmungen\n\n';
      state.votes.forEach((v, i) => {
        md += '### ' + (i + 1) + '. ' + v.title + '\n\n';
        if (v.agendaItem) md += 'TOP: ' + v.agendaItem + '\n\n';
        md += '**Ergebnis:** ' + v.result.yes + ' Ja, ' + v.result.no + ' Nein';
        if (v.result.absent) md += ', ' + v.result.absent + ' Abwesend';
        md += ' – **' + (v.result.passed ? 'angenommen' : 'abgelehnt') + '**\n\n';
        if (v.yesVoters?.length) { md += '**Ja:** ' + v.yesVoters.join(', ') + '\n\n'; }
        if (v.noVoters?.length) { md += '**Nein:** ' + v.noVoters.join(', ') + '\n\n'; }
        if (v.absentVoters?.length) { md += '**Abwesend:** ' + v.absentVoters.join(', ') + '\n\n'; }
      });
    }
    download(md, 'protokoll-' + state.session.date + '.md', 'text/markdown');
    if (onDownloaded) onDownloaded();
  };

  const doZip = async () => {
    try {
      const blob = await buildZipBlob(state, memberLookup, bodyName);
      downloadBlob(blob, 'protokoll-' + state.session.date + '_' + state.bodyId + '.zip');
      if (onDownloaded) onDownloaded();
    } catch (e) { console.error('ZIP export failed', e); }
  };

  return (
    <div className="bg-surface rounded-lg border border-brd p-4">
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

/* ── Party Legend ──────────────────────────────────────── */
/* While a vote is open each party carries Ja/Nein buttons that set only the
   present members of that party — absent members are left untouched. */
function PartyLegend({ members, data, currentVote, partyOf, dispatch }) {
  const groups = {};
  members.forEach(m => {
    if (!groups[m.currentParty]) groups[m.currentParty] = 0;
    groups[m.currentParty]++;
  });

  const votersOf = pid => currentVote
    ? Object.keys(currentVote.votes).filter(id => partyOf[id] === pid && currentVote.votes[id] !== 'absent')
    : [];

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {Object.entries(groups).map(([pid, count]) => {
        const p = COUNCIL_DATA.getParty(data.parties, pid);
        const ids = votersOf(pid);
        return (
          <span key={pid} className="inline-flex items-center text-xs rounded-full overflow-hidden"
            style={{ backgroundColor: p.color + '18', color: p.color, border: '1px solid ' + p.color + '44' }}>
            <span className={'inline-flex items-center gap-1 py-0.5 pl-2 ' + (ids.length ? 'pr-1.5' : 'pr-2')}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></span>
              {p.name} ({count})
            </span>
            {ids.length > 0 && (
              <span className="inline-flex border-l" style={{ borderColor: p.color + '44' }}>
                <button type="button" className="px-2 py-0.5 font-semibold hover:bg-vote-yes hover:text-white"
                  onClick={() => dispatch({ type: 'BULK_VOTE', value: 'yes', memberIds: ids })}
                  title={p.name + ': alle Anwesenden auf Ja (' + ids.length + ')'}>Ja</button>
                <button type="button" className="px-2 py-0.5 font-semibold hover:bg-vote-no hover:text-white border-l"
                  style={{ borderColor: p.color + '44' }}
                  onClick={() => dispatch({ type: 'BULK_VOTE', value: 'no', memberIds: ids })}
                  title={p.name + ': alle Anwesenden auf Nein (' + ids.length + ')'}>Nein</button>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ── Session Info Editor ──────────────────────────────── */
function SessionInfoEditor({ session, dispatch }) {
  if (session.status !== 'idle') return null;
  return (
    <div className="bg-surface rounded-lg border border-brd p-4 space-y-2">
      <h3 className="panel-title">Sitzungsdetails</h3>
      <input type="text" value={session.title} placeholder="Titel"
        onChange={e => dispatch({ type: 'UPDATE_SESSION', fields: { title: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="date" value={session.date}
        onChange={e => dispatch({ type: 'UPDATE_SESSION', fields: { date: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
      <input type="text" value={session.location} placeholder="Ort"
        onChange={e => dispatch({ type: 'UPDATE_SESSION', fields: { location: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
    </div>
  );
}

/* ── Recovery Modal ───────────────────────────────────── */
function RecoveryModal({ recoveryData, onDismiss }) {
  const state = recoveryData.state;
  const memberLookup = recoveryData.memberLookup || {};
  const bodyName = recoveryData.bodyName || state.bodyId;
  const activeMembers = recoveryData.activeMembers || [];

  const doDownload = (fn) => { fn(); clearBackup(); onDismiss(); };

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
                downloadBlob(blob, 'protokoll-' + state.session.date + '.zip');
              } catch (e) { console.error('ZIP export failed', e); }
            })}>ZIP-Paket herunterladen</button>
          <div className="flex gap-2">
            <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30"
              onClick={() => doDownload(() => {
                download(JSON.stringify({ session: state.session, log: state.log, votes: state.votes }, null, 2),
                  'protokoll-' + state.session.date + '.json', 'application/json');
              })}>JSON</button>
            <button className="flex-1 py-1.5 bg-accent-light rounded-lg text-xs font-semibold hover:bg-accent/30"
              onClick={() => doDownload(() => {
                download(generateHumanProtocol(state, bodyName), 'protokoll-' + state.session.date + '.txt', 'text/plain');
              })}>Text</button>
          </div>
        </div>

        <button className="w-full py-2 border border-brd rounded-lg text-sm text-tx-m hover:bg-gray-50"
          onClick={() => { clearBackup(); onDismiss(); }}>Verwerfen und neue Sitzung starten</button>
      </div>
    </div>
  );
}

/* ── Keyboard help ────────────────────────────────────── */
function ShortcutHelp({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-card-lg p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
        <h3 className="font-serif font-bold t-display text-primary-dark mb-4">Tastaturkürzel</h3>
        <dl className="space-y-2.5">
          {SHORTCUTS.map(s => (
            <div key={s.key} className="flex items-baseline gap-3">
              <dt className="w-14 flex-shrink-0"><kbd>{s.key}</kbd></dt>
              <dd className="t-body">{s.label}</dd>
            </div>
          ))}
        </dl>
        <p className="t-meta text-tx-m mt-4">Buchstabenkürzel pausieren, solange ein Textfeld aktiv ist.</p>

        <h4 className="panel-title mt-5 mb-2">Klicken</h4>
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

/* ── Demo tour ────────────────────────────────────────── */
function DemoBanner({ state }) {
  const stepIndex = DEMO_STEPS.findIndex(s => !s.done(state));
  const current = stepIndex === -1 ? null : DEMO_STEPS[stepIndex];

  return (
    <div className="bg-accent-light border-b border-brd">
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="panel-title">Demo</span>
          <div className="flex gap-1" aria-hidden="true">
            {DEMO_STEPS.map((s, i) => (
              <span key={i} className={'block w-4 h-1.5 rounded-full ' +
                (s.done(state) ? 'bg-primary' : i === stepIndex ? 'bg-primary/40' : 'bg-black/10')} />
            ))}
          </div>
        </div>
        <div className="flex-1 min-w-[15rem]">
          {current ? (
            <>
              <p className="t-strong">Schritt {stepIndex + 1} von {DEMO_STEPS.length}: {current.title}</p>
              <p className="t-meta text-tx-m protocol-measure">{current.hint}</p>
            </>
          ) : (
            <>
              <p className="t-strong">Alle Schritte durchlaufen.</p>
              <p className="t-meta text-tx-m">Protokoll und Export unten enthalten den kompletten Sitzungsverlauf.</p>
            </>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className="px-3 py-1.5 rounded-lg t-meta font-semibold bg-surface border border-brd hover:bg-white"
            onClick={() => location.reload()}>Neu starten</button>
          <a className="px-3 py-1.5 rounded-lg t-meta font-semibold bg-surface border border-brd hover:bg-white"
            href="index.html">Demo verlassen</a>
        </div>
      </div>
    </div>
  );
}

/* ── App ──────────────────────────────────────────────── */
function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const today = useMemo(() => new Date(), []);

  const [showHelp, setShowHelp] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Recovery check — never in demo mode, which must not read or write
  // the real session's backup slot.
  const [recoveryData, setRecoveryData] = useState(() => {
    if (DEMO_MODE) return null;
    try {
      const saved = localStorage.getItem(BACKUP_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  });

  // Fetch data
  useEffect(() => {
    fetch('members.json')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(json => setData(COUNCIL_DATA.processRawData(json)))
      .catch(err => setLoadError('Daten konnten nicht geladen werden: ' + err.message));
  }, []);

  const activeMembers = useMemo(() => data ? COUNCIL_DATA.getActiveMembers(data.members, today) : [], [data, today]);
  const mayor = useMemo(() => activeMembers.find(m => m.role === 'mayor'), [activeMembers]);
  const councillors = useMemo(() => data ? activeMembers.filter(m => m.role === 'councillor') : [], [activeMembers, data]);

  const memberLookup = useMemo(() => {
    const m = {};
    activeMembers.forEach(member => { m[member.id] = member.lastName + ', ' + member.firstName; });
    return m;
  }, [activeMembers]);

  const seatNames = useMemo(() => buildSeatNames(activeMembers), [activeMembers]);

  const partyOf = useMemo(() => {
    const m = {};
    activeMembers.forEach(member => { m[member.id] = member.currentParty; });
    return m;
  }, [activeMembers]);

  const bodyDef = useMemo(() => data ? data.bodies.find(b => b.id === state.bodyId) : null, [data, state.bodyId]);
  const bodyConfig = useMemo(() => bodyDef ? COUNCIL_DATA.getBodyConfig(bodyDef, activeMembers) : null, [bodyDef, activeMembers]);
  const bodyName = bodyDef ? bodyDef.name : state.bodyId;

  // Init seats on body change
  const prevBodyRef = useRef(null);
  useEffect(() => {
    if (bodyConfig && prevBodyRef.current !== state.bodyId) {
      dispatch({ type: 'INIT_SEATS', bodyConfig, activeMembers });
      prevBodyRef.current = state.bodyId;
    }
  }, [state.bodyId, bodyConfig, activeMembers]);
  useEffect(() => {
    if (bodyConfig && Object.keys(state.seatStates).length === 0) {
      dispatch({ type: 'INIT_SEATS', bodyConfig, activeMembers });
    }
  }, [bodyConfig]);

  // Load agenda from file: tagesordnung/YYYY-MM-DD_bodyId.txt
  useEffect(() => {
    if (!data) return;
    const url = 'tagesordnung/' + state.session.date + '_' + state.bodyId + '.txt';
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(text => {
        const items = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (items.length) dispatch({ type: 'SET_AGENDA', items });
      })
      .catch(() => {}); // no file, that's fine
  }, [state.bodyId, state.session.date, data]);

  const presentIds = useMemo(() => getPresentIds(state.seatStates, bodyConfig), [state.seatStates, bodyConfig]);

  // Backup to localStorage during active session
  useEffect(() => {
    if (DEMO_MODE) return;
    if (state.session.status === 'active' || state.session.status === 'paused' || state.session.status === 'ended') {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify({
          state, memberLookup, bodyName, activeMembers: activeMembers.map(m => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, currentParty: m.currentParty })),
        }));
      } catch (e) {}
    }
  }, [state]);

  const handleDownloaded = useCallback(() => { clearBackup(); }, []);

  /* ── Vote start + keyboard ─── */
  const sessionLive = state.session.status === 'active' || state.session.status === 'paused';

  const startVote = useCallback(agendaItem => {
    const memberNames = {};
    activeMembers.forEach(m => { memberNames[m.id] = m.lastName + ', ' + m.firstName; });
    dispatch({ type: 'START_VOTE', presentIds: [...presentIds], memberNames, agendaItem: agendaItem || '' });
  }, [activeMembers, presentIds]);

  // TOPs that already carry a recorded vote, so the agenda can show progress.
  const votedItems = useMemo(
    () => new Set(state.votes.map(v => v.agendaItem).filter(Boolean)),
    [state.votes]
  );

  /* A shortcut that silently does nothing reads as a broken shortcut, so say
     why it did not apply. */
  const [hint, setHint] = useState(null);
  const hintTimer = useRef(null);
  const showHint = useCallback(msg => {
    setHint(msg);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const bulk = value => {
    if (!sessionLive) return showHint('Erst die Sitzung eröffnen.');
    if (!state.currentVote) return showHint('Keine Abstimmung offen — mit A starten.');
    dispatch({ type: 'BULK_VOTE', value });
  };

  useHotkeys({
    onHelp: () => setShowHelp(v => !v),
    onNewVote: () => {
      if (!sessionLive) return showHint('Erst die Sitzung eröffnen.');
      if (state.currentVote) return showHint('Es läuft bereits eine Abstimmung.');
      startVote();
    },
    onBulkYes: () => bulk('yes'),
    onBulkNo:  () => bulk('no'),
    onSave: () => {
      if (showConfirm || !state.currentVote || !state.currentVote.title.trim()) return false;
      setShowConfirm(true);
      return true;
    },
    onCancel: () => {
      if (showHelp) { setShowHelp(false); return; }
      if (showConfirm) { setShowConfirm(false); return; }
      if (state.currentVote) dispatch({ type: 'CANCEL_VOTE' });
    },
  });

  /* ── Loading / Error / Recovery states ─── */
  if (loadError) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-surface rounded-xl shadow-card-lg p-8 max-w-md text-center">
        <div className="text-4xl mb-4">&#9888;</div>
        <p className="text-vote-no font-bold">{loadError}</p>
        <p className="text-tx-m text-sm mt-2">Stelle sicher, dass <code>members.json</code> im selben Verzeichnis liegt.</p>
      </div>
    </div>
  );

  if (!data || !bodyConfig) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center text-tx-m">
        <div className="text-2xl mb-2 animate-spin inline-block">&#9881;</div>
        <p>Lade Daten...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {recoveryData && <RecoveryModal recoveryData={recoveryData} onDismiss={() => setRecoveryData(null)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {hint && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-tx text-white t-meta px-4 py-2 rounded-lg shadow-card-lg"
          role="status">{hint}</div>
      )}

      <SessionHeader session={state.session} bodyId={state.bodyId} bodies={data.bodies}
        dispatch={dispatch} bodyConfig={bodyConfig} memberLookup={memberLookup}
        onShowHelp={() => setShowHelp(true)} />
      {DEMO_MODE && <DemoBanner state={state} />}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Mobile: stacks in DOM order. Desktop: grid with sidebar spanning rows */}
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6">
          {/* Circle */}
          <div className="lg:col-span-2 space-y-3">
            <PartyLegend members={activeMembers} data={data} currentVote={state.currentVote}
              partyOf={partyOf} dispatch={dispatch} />
            <CouncilCircle councillors={councillors} mayor={mayor} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch}
              data={data} memberLookup={memberLookup} seatNames={seatNames} />
          </div>

          {/* Sidebar: on mobile this comes between circle and cards */}
          <div className="space-y-4 lg:row-span-2">
            <SessionInfoEditor session={state.session} dispatch={dispatch} />
            <AgendaPanel agenda={state.agenda} dispatch={dispatch} startVote={startVote}
              canStartVote={sessionLive && !state.currentVote} votedItems={votedItems} />
            <VotePanel currentVote={state.currentVote} session={state.session}
              dispatch={dispatch} agenda={state.agenda} startVote={startVote}
              showConfirm={showConfirm}
              onRequestConfirm={() => setShowConfirm(true)}
              onCancelConfirm={() => setShowConfirm(false)} />
            {state.session.status === 'ended' && (
              <ExportPanel state={state} activeMembers={activeMembers} memberLookup={memberLookup}
                bodyName={bodyName} onDownloaded={handleDownloaded} />
            )}
          </div>

          {/* Cards: on mobile after sidebar, on desktop below circle */}
          <div className="lg:col-span-2">
            <h3 className="panel-title mb-3">Mitglieder</h3>
            <MemberCards allMembers={activeMembers} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch}
              data={data} memberLookup={memberLookup} />
          </div>
        </div>

        {/* Protocol: always last */}
        <div className="mt-6">
          <ProtocolLog log={state.log} state={state} bodyName={bodyName} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}

/* ── Mount ────────────────────────────────────────────── */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
