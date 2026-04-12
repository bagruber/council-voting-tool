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

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function clearBackup() {
  try { localStorage.removeItem('council-session-backup'); } catch (e) {}
}

/* ── Reducer ──────────────────────────────────────────── */
const INITIAL_STATE = {
  bodyId: 'plenum',
  session: {
    id: null, title: 'Stadtratssitzung',
    date: new Date().toISOString().slice(0, 10),
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
        arrived.forEach(id => { if (id in nv && nv[id] === 'absent') nv[id] = 'no'; });
        cv = { ...cv, votes: nv };
      }

      return { ...state, seatStates: ns, presenceHistory: ph, currentVote: cv, log };
    }

    case 'START_VOTE': {
      const votes = {};
      action.presentIds.forEach(id => { votes[id] = 'no'; });
      return { ...state, currentVote: {
        id: uuid(), title: '', agendaItem: '', comment: '',
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
      const nv = {};
      Object.entries(cv.votes).forEach(([id, v]) => { nv[id] = v === 'absent' ? 'absent' : action.value; });
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

function getLabelPlacement(x, y) {
  const dx = x - 50;
  if (y > 70) return dx >= 0 ? 'right' : 'left';
  if (Math.abs(dx) > 12) return dx > 0 ? 'right' : 'left';
  if (y < 30) return 'above';
  return dx >= 0 ? 'right' : 'left';
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
    if (entry.type === 'session_start') return;
    const time = fmtTime(entry.timestamp);
    if (entry.type === 'presence_change' && entry.payload) {
      const p = entry.payload;
      t += time + '  ' + (p.newState === 'present'
        ? p.memberName + ' ist der Sitzung beigetreten'
        : p.memberName + ' hat die Sitzung verlassen') + '\n';
    } else if (entry.type === 'vote' && entry.payload) {
      const v = entry.payload;
      t += time + '  Abstimmung: ' + v.title;
      if (v.agendaItem) t += ' (' + v.agendaItem + ')';
      t += '\n         Ergebnis: ' + v.result.yes + ' Ja, ' + v.result.no + ' Nein';
      if (v.result.absent) t += ', ' + v.result.absent + ' Abwesend';
      t += ' – ' + (v.result.passed ? 'angenommen' : 'abgelehnt') + '\n';
    } else if (entry.type === 'session_end') { t += time + '  Sitzung beendet\n'; }
    else if (entry.type === 'session_pause') { t += time + '  Sitzung unterbrochen\n'; }
    else if (entry.type === 'session_resume') { t += time + '  Sitzung fortgesetzt\n'; }
    else if (entry.type === 'session_public') { t += time + '  Öffentlicher Teil\n'; }
    else if (entry.type === 'session_nonpublic') { t += time + '  Nichtöffentlicher Teil\n'; }
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
function buildPresenceJSON(state, memberLookup, parties) {
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

function SessionHeader({ session, bodyId, bodies, dispatch, bodyConfig, memberLookup }) {
  return (
    <header className="bg-gradient-to-r from-primary-dark via-primary to-primary-bright text-white px-6 py-4 shadow-card-lg">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <BodySelector bodyId={bodyId} bodies={bodies} onChange={id => {
            const b = bodies.find(x => x.id === id);
            dispatch({ type: 'SELECT_BODY', bodyId: id, bodyName: b ? b.name : '' });
          }} />
          <div>
            <h1 className="font-serif font-bold text-lg leading-tight">{session.title}</h1>
            <p className="text-sm opacity-80">{fmtDate(session.date)} &middot; {session.location}</p>
          </div>
        </div>
        <SessionControls session={session} dispatch={dispatch} bodyConfig={bodyConfig} memberLookup={memberLookup} />
      </div>
    </header>
  );
}

/* ── Council Circle ───────────────────────────────────── */

function SeatCircle({ member, partyColor, seatInfo, voting, voteValue, onPresence, onVote, isChair, labelPlacement }) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isInVote = voting && voteValue !== undefined;
  const isAbsentInVote = voting && voteValue === 'absent';
  const bg = !eligible ? '#ddd' : (!active && !isInVote) ? '#ccc' : isAbsentInVote ? '#ccc' : partyColor;
  const txt = !eligible ? '#999' : (!active && !isInVote) ? '#888' : isAbsentInVote ? '#888' : contrastText(partyColor);

  const handlePresenceClick = () => {
    if (!eligible) return;
    onPresence(member.id);
  };

  return (
    <div className={'seat-node ' + (eligible ? '' : 'disabled ') + (!active && eligible && !voting ? 'absent-seat' : '')}
      onClick={handlePresenceClick}
      title={member.firstName + ' ' + member.lastName + (seatInfo.role === 'substitute' ? ' [Vertretung]' : '')}>
      <div className="relative inline-flex items-center justify-center">
        <div className={'seat-circle rounded-full flex items-center justify-center font-bold shadow-card'}
          style={{ backgroundColor: bg, color: txt,
            border: seatInfo.role === 'substitute' ? '2px dashed #666' : 'none' }}>
          <span className="seat-initials">{member.firstName.charAt(0)}{member.lastName.charAt(0)}</span>
        </div>
        {voting && isInVote && !isAbsentInVote && (
          <div className={'vote-indicator vote-badge absolute -bottom-1 -right-1 flex items-center justify-center rounded ' +
            (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')}
            style={{ width: 20, height: 20 }}
            onClick={e => { e.stopPropagation(); onVote(member.id); }}>
            <span className="text-white text-[11px] font-bold">{voteValue === 'yes' ? '✓' : '✗'}</span>
          </div>
        )}
        {voting && isAbsentInVote && (
          <div className="absolute -bottom-1 -right-1 flex items-center justify-center rounded bg-absent"
            style={{ width: 20, height: 20 }}>
            <span className="text-white text-[10px] font-bold">—</span>
          </div>
        )}
        <span className={'seat-label-outside lbl-' + (labelPlacement || 'above')}
          style={{ color: eligible ? '#2D2D2D' : '#aaa' }}>
          {member.lastName.length > 11 ? member.lastName.substring(0, 10) + '.' : member.lastName}
        </span>
      </div>
    </div>
  );
}

function CouncilCircle({ councillors, mayor, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup }) {
  // Reverse order so it's from the chair's perspective
  const ordered = useMemo(
    () => COUNCIL_DATA.buildSeatOrder(councillors, data.seatOrder).reverse(),
    [councillors, data.seatOrder]
  );
  const n = ordered.length;

  const GAP_DEG = 50;
  const ARC_DEG = 360 - GAP_DEG;
  const START_DEG = 60; // lower-right, sweeps counterclockwise through top to lower-left

  function pos(i, total) {
    const deg = START_DEG - (ARC_DEG * i / (total - 1 || 1));
    const rad = deg * Math.PI / 180;
    return { x: 50 + 42 * Math.cos(rad), y: 50 + 42 * Math.sin(rad) };
  }

  const handlePresence = useCallback(id => {
    if (bodyConfig.type !== 'plenum') {
      const pair = bodyConfig.seatPairs.find(p => p.substitute === id);
      if (pair) { dispatch({ type: 'CYCLE_SEAT', seatKey: pair.regular, bodyConfig, memberLookup }); return; }
    }
    dispatch({ type: 'CYCLE_SEAT', seatKey: id, bodyConfig, memberLookup });
  }, [bodyConfig, dispatch, memberLookup]);

  const handleVote = useCallback(id => {
    dispatch({ type: 'CAST_VOTE', memberId: id });
  }, [dispatch]);

  const voting = !!currentVote;

  return (
    <div className="relative mx-auto council-circle-container" style={{ width: '100%', maxWidth: 640, aspectRatio: '1' }}>
      {ordered.map((m, i) => {
        const { x, y } = pos(i, n);
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const party = COUNCIL_DATA.getParty(data.parties, m.currentParty);
        const lbl = getLabelPlacement(x, y);
        return (
          <div key={m.id} className="absolute" style={{ left: x + '%', top: y + '%', transform: 'translate(-50%, -50%)' }}>
            <SeatCircle member={m} partyColor={party.color} seatInfo={info} isChair={false}
              voting={voting} voteValue={currentVote?.votes[m.id]} labelPlacement={lbl}
              onPresence={handlePresence} onVote={handleVote} />
          </div>
        );
      })}

      {mayor && (() => {
        const info = getSeatInfo(mayor.id, bodyConfig, seatStates);
        const party = COUNCIL_DATA.getParty(data.parties, mayor.currentParty);
        return (
          <div className="absolute" style={{ bottom: '2%', left: '50%', transform: 'translateX(-50%)' }}>
            <SeatCircle member={mayor} partyColor={party.color} seatInfo={info} isChair
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
            <div className="text-[10px] text-tx-m">Abwesend</div>
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
  const borderColor = !eligible ? '#ddd' : !active && !isInVote ? '#ccc' : partyColor;
  const opacity = (!eligible || (!active && !voting) || isAbsentInVote) ? 'opacity-50' : '';

  return (
    <div className={'bg-surface rounded-lg border-l-4 shadow-card p-3 transition-all hover:shadow-card-lg ' + opacity +
      (eligible ? ' cursor-pointer' : ' pointer-events-none')}
      style={{ borderLeftColor: borderColor }}
      onClick={() => { if (eligible) onPresence(member.id); }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{member.firstName} {member.lastName}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: partyColor }}></span>
            <span className="text-xs text-tx-m truncate">{partyName}</span>
          </div>
          <div className="text-[11px] text-tx-m mt-0.5">{roleText}</div>
        </div>
        <div className="flex-shrink-0">
          {voting && isInVote && !isAbsentInVote && (
            <div className={'vote-indicator flex items-center justify-center rounded w-8 h-8 ' +
              (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')}
              onClick={e => { e.stopPropagation(); onVote(member.id); }}>
              <span className="text-white font-bold text-sm">{voteValue === 'yes' ? '✓' : '✗'}</span>
            </div>
          )}
          {voting && isAbsentInVote && (
            <div className="flex items-center justify-center rounded w-8 h-8 bg-absent">
              <span className="text-white font-bold text-sm">—</span>
            </div>
          )}
          {!voting && eligible && (
            <div className={'w-3 h-3 rounded-full ' + (active ? 'bg-vote-yes' : 'bg-absent')}></div>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberCards({ allMembers, bodyConfig, seatStates, currentVote, dispatch, data, memberLookup }) {
  const voting = !!currentVote;

  const handlePresence = useCallback(id => {
    if (bodyConfig.type !== 'plenum') {
      const pair = bodyConfig.seatPairs.find(p => p.substitute === id);
      if (pair) { dispatch({ type: 'CYCLE_SEAT', seatKey: pair.regular, bodyConfig, memberLookup }); return; }
    }
    dispatch({ type: 'CYCLE_SEAT', seatKey: id, bodyConfig, memberLookup });
  }, [bodyConfig, dispatch, memberLookup]);

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

function VotePanel({ currentVote, session, presentIds, dispatch, agenda, activeMembers }) {
  const [showConfirm, setShowConfirm] = useState(false);
  if (session.status !== 'active' && session.status !== 'paused') return null;

  if (!currentVote) {
    const memberNames = {};
    activeMembers.forEach(m => { memberNames[m.id] = m.lastName + ', ' + m.firstName; });
    return (
      <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
        <button className="w-full py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary-dark transition-colors"
          onClick={() => dispatch({ type: 'START_VOTE', presentIds: [...presentIds], memberNames })}>
          Neue Abstimmung
        </button>
      </div>
    );
  }

  const yes = Object.values(currentVote.votes).filter(v => v === 'yes').length;
  const no  = Object.values(currentVote.votes).filter(v => v === 'no').length;
  const absent = Object.values(currentVote.votes).filter(v => v === 'absent').length;
  const voting = yes + no;

  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4 space-y-3">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider">Abstimmung</h3>
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
          onClick={() => dispatch({ type: 'BULK_VOTE', value: 'yes' })}>Alle Ja</button>
        <button className="flex-1 py-2 bg-vote-no text-white rounded-lg font-bold text-sm hover:opacity-90"
          onClick={() => dispatch({ type: 'BULK_VOTE', value: 'no' })}>Alle Nein</button>
      </div>
      <div className="text-center text-sm space-x-2">
        <span className="text-vote-yes font-bold">{yes} Ja</span>
        <span className="text-tx-m">|</span>
        <span className="text-vote-no font-bold">{no} Nein</span>
        {absent > 0 && <><span className="text-tx-m">|</span><span className="text-absent font-bold">{absent} Abw.</span></>}
        <span className="text-tx-m">|</span>
        <span className="text-tx-m">{voting} Stimmberechtigte</span>
      </div>
      <p className="text-[10px] text-tx-m text-center">Kreis/Karte = Anwesenheit, Quadrat = Ja/Nein</p>
      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-gray-200 text-tx rounded-lg font-semibold text-sm hover:bg-gray-300"
          onClick={() => dispatch({ type: 'CANCEL_VOTE' })}>Abbrechen</button>
        <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark disabled:opacity-40"
          disabled={!currentVote.title.trim()} onClick={() => setShowConfirm(true)}>Speichern</button>
      </div>
      {showConfirm && (
        <VoteConfirmModal vote={currentVote} yes={yes} no={no} absent={absent} voting={voting}
          passed={yes > no}
          onConfirm={() => { setShowConfirm(false); dispatch({ type: 'CONFIRM_VOTE' }); }}
          onCancel={() => setShowConfirm(false)} />
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
function AgendaPanel({ agenda, dispatch }) {
  const [val, setVal] = useState('');
  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-2">Tagesordnung</h3>
      <div className="flex gap-2 mb-2">
        <input type="text" value={val} placeholder="Neuer TOP..." onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { dispatch({ type: 'ADD_AGENDA', title: val.trim() }); setVal(''); } }}
          className="flex-1 border border-brd rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
        <button className="px-3 py-1.5 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30"
          onClick={() => { if (val.trim()) { dispatch({ type: 'ADD_AGENDA', title: val.trim() }); setVal(''); } }}>+</button>
      </div>
      <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
        {agenda.map(a => (
          <li key={a.id} className="flex items-center justify-between group">
            <span>{a.title}</span>
            <button className="text-tx-m hover:text-vote-no opacity-0 group-hover:opacity-100 text-xs"
              onClick={() => dispatch({ type: 'REMOVE_AGENDA', id: a.id })}>&times;</button>
          </li>
        ))}
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
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
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
          <h4 className="font-semibold text-xs uppercase tracking-wider text-primary-dark mb-1">
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
        <h4 className="font-semibold text-xs uppercase tracking-wider text-primary-dark mb-1">Verlauf</h4>
        <div className="space-y-1">
          {log.map(entry => {
            if (entry.type === 'session_start') return null;
            let text = '';
            if (entry.type === 'presence_change' && entry.payload) {
              const p = entry.payload;
              text = p.newState === 'present'
                ? p.memberName + ' ist der Sitzung beigetreten'
                : p.memberName + ' hat die Sitzung verlassen';
            } else if (entry.type === 'vote' && entry.payload) {
              const v = entry.payload;
              text = 'Abstimmung: ' + v.title;
              if (v.agendaItem) text += ' (' + v.agendaItem + ')';
              text += ' – ' + (v.result.passed ? 'angenommen' : 'abgelehnt') +
                ' (' + v.result.yes + ' Ja, ' + v.result.no + ' Nein' +
                (v.result.absent ? ', ' + v.result.absent + ' Abwesend' : '') + ')';
            } else if (entry.type === 'session_end') { text = 'Sitzung beendet'; }
            else if (entry.type === 'session_pause') { text = 'Sitzung unterbrochen'; }
            else if (entry.type === 'session_resume') { text = 'Sitzung fortgesetzt'; }
            else if (entry.type === 'session_public') { text = 'Öffentlicher Teil'; }
            else if (entry.type === 'session_nonpublic') { text = 'Nichtöffentlicher Teil'; }
            else return null;
            return (
              <div key={entry.id} className="flex gap-2 log-enter">
                <span className="text-tx-m whitespace-nowrap">{fmtTime(entry.timestamp)}</span>
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
      <span className={'text-[10px] uppercase font-bold px-2 py-0.5 rounded text-white ' + (typeColors[entry.type] || 'bg-gray-400')}>
        {typeLabels[entry.type] || entry.type}
      </span>
      <div className="flex-1">
        <span>{entry.message}</span>
        {entry.mode && <span className="text-[9px] text-tx-m ml-1">[{entry.mode === 'public' ? 'öff.' : 'n.öff.'}]</span>}
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
          <button className="text-[10px] text-tx-m hover:text-primary ml-2" onClick={() => setEditing(true)}>[Kommentar]</button>
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
      const zip = new JSZip();
      // Protocol TXT
      zip.file('protokoll.txt', generateHumanProtocol(state, bodyName));

      // Presence data (shared)
      const presenceData = buildPresenceJSON(state, memberLookup);

      // Split votes by mode
      const publicVotes = state.votes.filter(v => v.mode === 'public').map(v => buildVoteJSON(v, state.presenceHistory));
      const nonpublicVotes = state.votes.filter(v => v.mode === 'nonpublic').map(v => buildVoteJSON(v, state.presenceHistory));

      const base = {
        sitzung: { titel: state.session.title, datum: state.session.date,
          ort: state.session.location, gremium: bodyName },
        anwesenheit: presenceData,
      };

      zip.file('oeffentlich.json', JSON.stringify({ ...base, teil: 'öffentlich', abstimmungen: publicVotes }, null, 2));
      zip.file('nichtoeffentlich.json', JSON.stringify({ ...base, teil: 'nichtöffentlich', abstimmungen: nonpublicVotes }, null, 2));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'protokoll-' + state.session.date + '_' + state.bodyId + '.zip'; a.click();
      URL.revokeObjectURL(url);
      if (onDownloaded) onDownloaded();
    } catch (e) { console.error('ZIP export failed', e); }
  };

  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-2">Export</h3>
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
function PartyLegend({ councillors, data }) {
  const groups = {};
  councillors.forEach(m => {
    if (!groups[m.currentParty]) groups[m.currentParty] = 0;
    groups[m.currentParty]++;
  });
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {Object.entries(groups).map(([pid, count]) => {
        const p = COUNCIL_DATA.getParty(data.parties, pid);
        return (
          <span key={pid} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ backgroundColor: p.color + '22', color: p.color, border: '1px solid ' + p.color + '44' }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></span>
            {p.name} ({count})
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
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4 space-y-2">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider">Sitzungsdetails</h3>
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
                const zip = new JSZip();
                zip.file('protokoll.txt', generateHumanProtocol(state, bodyName));
                const presenceData = buildPresenceJSON(state, memberLookup);
                const base = { sitzung: { titel: state.session.title, datum: state.session.date, ort: state.session.location, gremium: bodyName }, anwesenheit: presenceData };
                const pubV = state.votes.filter(v => v.mode === 'public').map(v => buildVoteJSON(v, state.presenceHistory));
                const npV = state.votes.filter(v => v.mode === 'nonpublic').map(v => buildVoteJSON(v, state.presenceHistory));
                zip.file('oeffentlich.json', JSON.stringify({ ...base, teil: 'öffentlich', abstimmungen: pubV }, null, 2));
                zip.file('nichtoeffentlich.json', JSON.stringify({ ...base, teil: 'nichtöffentlich', abstimmungen: npV }, null, 2));
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'protokoll-' + state.session.date + '.zip'; a.click();
                URL.revokeObjectURL(url);
              } catch (e) { console.error(e); }
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

/* ── App ──────────────────────────────────────────────── */
function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const today = useMemo(() => new Date(), []);

  // Recovery check
  const [recoveryData, setRecoveryData] = useState(() => {
    try {
      const saved = localStorage.getItem('council-session-backup');
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
    if (state.session.status === 'active' || state.session.status === 'paused' || state.session.status === 'ended') {
      try {
        localStorage.setItem('council-session-backup', JSON.stringify({
          state, memberLookup, bodyName, activeMembers: activeMembers.map(m => ({ id: m.id, firstName: m.firstName, lastName: m.lastName, currentParty: m.currentParty })),
        }));
      } catch (e) {}
    }
  }, [state]);

  const handleDownloaded = useCallback(() => { clearBackup(); }, []);

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

      <SessionHeader session={state.session} bodyId={state.bodyId} bodies={data.bodies}
        dispatch={dispatch} bodyConfig={bodyConfig} memberLookup={memberLookup} />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Mobile: stacks in DOM order. Desktop: grid with sidebar spanning rows */}
        <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6">
          {/* Circle */}
          <div className="lg:col-span-2 space-y-3">
            <PartyLegend councillors={councillors} data={data} />
            <CouncilCircle councillors={councillors} mayor={mayor} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch}
              data={data} memberLookup={memberLookup} />
          </div>

          {/* Sidebar: on mobile this comes between circle and cards */}
          <div className="space-y-4 lg:row-span-2">
            <SessionInfoEditor session={state.session} dispatch={dispatch} />
            <AgendaPanel agenda={state.agenda} dispatch={dispatch} />
            <VotePanel currentVote={state.currentVote} session={state.session}
              presentIds={presentIds} dispatch={dispatch} agenda={state.agenda} activeMembers={activeMembers} />
            {state.session.status === 'ended' && (
              <ExportPanel state={state} activeMembers={activeMembers} memberLookup={memberLookup}
                bodyName={bodyName} onDownloaded={handleDownloaded} />
            )}
          </div>

          {/* Cards: on mobile after sidebar, on desktop below circle */}
          <div className="lg:col-span-2">
            <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-3">Mitglieder</h3>
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
