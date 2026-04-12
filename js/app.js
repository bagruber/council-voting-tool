/* global React, ReactDOM, COUNCIL_DATA */
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

function memberSortName(m) {
  return m.lastName + ', ' + m.firstName;
}

/* ── Reducer ──────────────────────────────────────────── */
const INITIAL_STATE = {
  bodyId: 'plenum',
  session: {
    id: null,
    title: 'Stadtratssitzung',
    date: new Date().toISOString().slice(0, 10),
    location: 'Rathaus Moosburg, Sitzungssaal',
    status: 'idle',
    mode: 'public',
  },
  seatStates: {},
  currentVote: null,
  votes: [],
  log: [],
  agenda: [],
};

function addLog(state, type, message, payload) {
  return [...state.log, { id: uuid(), timestamp: ts(), type, message, payload: payload || null, comment: '' }];
}

function reducer(state, action) {
  switch (action.type) {

    case 'SELECT_BODY': {
      return { ...state, bodyId: action.bodyId, seatStates: {}, currentVote: null, votes: [], log: [],
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

    case 'UPDATE_SESSION': {
      return { ...state, session: { ...state.session, ...action.fields } };
    }

    case 'START_SESSION': {
      const log = addLog(state, 'session_start', 'Sitzung eröffnet');
      return { ...state, session: { ...state.session, status: 'active', id: uuid() }, log };
    }
    case 'PAUSE_SESSION': {
      return { ...state, session: { ...state.session, status: 'paused' }, log: addLog(state, 'session_pause', 'Sitzung unterbrochen') };
    }
    case 'RESUME_SESSION': {
      return { ...state, session: { ...state.session, status: 'active' }, log: addLog(state, 'session_resume', 'Sitzung fortgesetzt') };
    }
    case 'END_SESSION': {
      return { ...state, session: { ...state.session, status: 'ended' }, log: addLog(state, 'session_end', 'Sitzung beendet') };
    }
    case 'SET_MODE': {
      const mode = action.mode;
      const t = mode === 'public' ? 'session_public' : 'session_nonpublic';
      const msg = mode === 'public' ? 'Öffentlicher Teil' : 'Nichtöffentlicher Teil';
      return { ...state, session: { ...state.session, mode }, log: addLog(state, t, msg) };
    }

    case 'CYCLE_SEAT': {
      const { seatKey, bodyConfig } = action;
      const ns = { ...state.seatStates };
      if (bodyConfig.type === 'plenum') {
        ns[seatKey] = ns[seatKey] === 'present' ? 'absent' : 'present';
      } else {
        const pair = bodyConfig.seatPairs.find(p => p.regular === seatKey || p.substitute === seatKey);
        if (!pair) return state;
        const key = pair.regular;
        const cur = ns[key] || 'regular';
        if (cur === 'regular')          ns[key] = pair.substitute ? 'substitute' : 'empty';
        else if (cur === 'substitute')  ns[key] = 'empty';
        else                            ns[key] = 'regular';
      }
      const log = state.session.status === 'active'
        ? addLog(state, 'presence_change', 'Anwesenheit geändert: ' + (action.memberName || seatKey))
        : state.log;
      return { ...state, seatStates: ns, log };
    }

    case 'START_VOTE': {
      const votes = {};
      action.presentIds.forEach(id => { votes[id] = 'no'; });
      return { ...state, currentVote: {
        id: uuid(), title: '', agendaItem: '', comment: '',
        votes,
        memberNames: action.memberNames || {},
      }};
    }
    case 'UPDATE_VOTE': {
      return { ...state, currentVote: { ...state.currentVote, ...action.fields } };
    }
    case 'CAST_VOTE': {
      const cv = state.currentVote;
      const cur = cv.votes[action.memberId];
      if (cur === undefined) return state; // not eligible for this vote
      const next = cur === 'yes' ? 'no' : cur === 'no' ? 'absent' : 'yes';
      const newVotes = { ...cv.votes, [action.memberId]: next };
      let log = state.log;
      if (next === 'absent') {
        const name = cv.memberNames[action.memberId] || action.memberId;
        log = addLog({ ...state, log }, 'presence_change', 'Abwesenheit während Abstimmung: ' + name);
      }
      return { ...state, currentVote: { ...cv, votes: newVotes }, log };
    }
    case 'BULK_VOTE': {
      const cv = state.currentVote;
      const nv = {};
      Object.keys(cv.votes).forEach(id => {
        if (cv.votes[id] !== 'absent') nv[id] = action.value;
        else nv[id] = 'absent';
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
      const record = {
        id: cv.id, timestamp: ts(), title: cv.title, agendaItem: cv.agendaItem, comment: cv.comment,
        votes: cv.votes,
        memberNames: cv.memberNames,
        result: { yes, no, absent, eligible: yes + no, passed },
        yesVoters, noVoters, absentVoters,
      };
      const msg = 'Abstimmung: ' + cv.title + ' – ' + (passed ? 'angenommen' : 'abgelehnt') +
        ' (' + yes + ' Ja, ' + no + ' Nein' + (absent ? ', ' + absent + ' Abwesend' : '') + ')';
      const log = addLog(state, 'vote', msg, record);
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
    let t = 'Stadtrat';
    if (member.title) t += ' · ' + member.title;
    return t;
  }
  if (!seatInfo.eligible) return '—';
  if (seatInfo.role === 'chair') return 'Vorsitz';
  if (seatInfo.role === 'vicechair') return 'Stellv. Vorsitz';
  if (seatInfo.role === 'substitute') return 'Stellvertretung';
  return 'Mitglied';
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

function SessionControls({ session, dispatch }) {
  const { status, mode } = session;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'idle' && (
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light transition-colors shadow"
          onClick={() => dispatch({ type: 'START_SESSION' })}>Sitzung eröffnen</button>
      )}
      {status === 'active' && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-yellow-300 text-yellow-900 hover:bg-yellow-200 transition-colors shadow"
          onClick={() => dispatch({ type: 'PAUSE_SESSION' })}>Unterbrechen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 transition-colors shadow border border-red-200"
          onClick={() => dispatch({ type: 'END_SESSION' })}>Beenden</button>
      </>}
      {status === 'paused' && <>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-primary-dark hover:bg-accent-light transition-colors shadow"
          onClick={() => dispatch({ type: 'RESUME_SESSION' })}>Fortsetzen</button>
        <button className="px-4 py-2 rounded-lg font-semibold text-sm bg-white text-vote-no hover:bg-red-50 transition-colors shadow border border-red-200"
          onClick={() => dispatch({ type: 'END_SESSION' })}>Beenden</button>
      </>}
      {(status === 'active' || status === 'paused') && (
        <button className={'px-4 py-2 rounded-lg font-semibold text-sm transition-colors shadow ' +
          (mode === 'public' ? 'bg-white/80 text-tx' : 'bg-gray-700 text-white')}
          onClick={() => dispatch({ type: 'SET_MODE', mode: mode === 'public' ? 'nonpublic' : 'public' })}>
          {mode === 'public' ? 'Öffentlich' : 'Nichtöffentlich'}
        </button>
      )}
      {status === 'ended' && <span className="text-white/70 font-serif italic">Sitzung beendet</span>}
    </div>
  );
}

function SessionHeader({ session, bodyId, bodies, dispatch }) {
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
        <SessionControls session={session} dispatch={dispatch} />
      </div>
    </header>
  );
}

/* ── Council Circle ───────────────────────────────────── */

function SeatCircle({ member, partyColor, seatInfo, voting, voteValue, onCycle, onVote, isChair, angle }) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isInVote = voting && voteValue !== undefined;
  const isAbsentInVote = voting && voteValue === 'absent';
  const bg = !eligible ? '#ddd' : (!active && !isInVote) ? '#ccc' : isAbsentInVote ? '#ccc' : partyColor;
  const txt = !eligible ? '#999' : (!active && !isInVote) ? '#888' : isAbsentInVote ? '#888' : contrastText(partyColor);

  const handleClick = () => {
    if (!eligible) return;
    if (voting) {
      if (!isInVote) return; // not part of this vote
      onVote(member.id);
    } else {
      onCycle(member.id);
    }
  };

  return (
    <div className={'seat-node flex flex-col items-center ' + (eligible && (isInVote || !voting) ? '' : 'disabled ') + (!active && eligible && !voting ? 'absent-seat' : '')}
      onClick={handleClick}
      title={member.firstName + ' ' + member.lastName + (seatInfo.role === 'substitute' ? ' [Vertretung]' : '')}>
      <div className="relative">
        <div className={'rounded-full flex items-center justify-center font-bold shadow-card seat-circle'}
          style={{
            backgroundColor: bg, color: txt,
            border: seatInfo.role === 'substitute' ? '2px dashed #666' : 'none',
          }}>
          <span className="seat-initials">{member.firstName.charAt(0)}{member.lastName.charAt(0)}</span>
        </div>
        {voting && isInVote && !isAbsentInVote && (
          <div className={'absolute -bottom-1 -right-1 flex items-center justify-center rounded vote-badge ' +
            (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')}
            style={{ width: 18, height: 18 }}>
            <span className="text-white text-[11px] font-bold">{voteValue === 'yes' ? '✓' : '✗'}</span>
          </div>
        )}
        {voting && isAbsentInVote && (
          <div className="absolute -bottom-1 -right-1 flex items-center justify-center rounded bg-absent vote-badge"
            style={{ width: 18, height: 18 }}>
            <span className="text-white text-[10px] font-bold">—</span>
          </div>
        )}
      </div>
      <span className="seat-label bg-white/90 rounded px-1.5 py-0.5 mt-1 text-center leading-tight truncate shadow-sm"
        style={{ color: eligible ? '#2D2D2D' : '#aaa', maxWidth: 72 }}>
        {member.lastName.length > 11 ? member.lastName.substring(0, 10) + '.' : member.lastName}
      </span>
      {seatInfo.role === 'substitute' && active && <span className="text-[8px] text-info font-bold">VERTR.</span>}
      {isChair && <span className="text-[8px] text-accent font-bold">VORSITZ</span>}
    </div>
  );
}

function CouncilCircle({ councillors, mayor, bodyConfig, seatStates, currentVote, dispatch, data }) {
  const ordered = useMemo(() => COUNCIL_DATA.buildSeatOrder(councillors, data.seatOrder), [councillors, data.seatOrder]);
  const n = ordered.length;

  // Horseshoe: gap at bottom, seats wrap around top. Mayor at bottom center.
  const GAP_DEG = 50;
  const ARC_DEG = 360 - GAP_DEG;
  const START_DEG = 60; // lower-right, sweeps through top to lower-left

  function pos(i, total) {
    const deg = START_DEG - (ARC_DEG * i / (total - 1 || 1));
    const rad = deg * Math.PI / 180;
    return { x: 50 + 42 * Math.cos(rad), y: 50 + 42 * Math.sin(rad) };
  }

  const handleCycle = useCallback((id) => {
    const m = [...councillors, mayor].find(x => x && x.id === id);
    const name = m ? m.firstName + ' ' + m.lastName : id;
    if (bodyConfig.type !== 'plenum') {
      const pair = bodyConfig.seatPairs.find(p => p.substitute === id);
      if (pair) { dispatch({ type: 'CYCLE_SEAT', seatKey: pair.regular, bodyConfig, memberName: name }); return; }
    }
    dispatch({ type: 'CYCLE_SEAT', seatKey: id, bodyConfig, memberName: name });
  }, [bodyConfig, dispatch, councillors, mayor]);

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
        return (
          <div key={m.id} className="absolute" style={{ left: x + '%', top: y + '%', transform: 'translate(-50%, -50%)' }}>
            <SeatCircle member={m} partyColor={party.color} seatInfo={info} isChair={false}
              voting={voting} voteValue={currentVote?.votes[m.id]}
              onCycle={handleCycle} onVote={handleVote} />
          </div>
        );
      })}

      {mayor && (() => {
        const info = getSeatInfo(mayor.id, bodyConfig, seatStates);
        const party = COUNCIL_DATA.getParty(data.parties, mayor.currentParty);
        return (
          <div className="absolute" style={{ bottom: '2%', left: '50%', transform: 'translateX(-50%)' }}>
            <SeatCircle member={mayor} partyColor={party.color} seatInfo={info} isChair
              voting={voting} voteValue={currentVote?.votes[mayor.id]}
              onCycle={handleCycle} onVote={handleVote} />
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

function MemberCard({ member, partyColor, partyName, seatInfo, voting, voteValue, onCycle, onVote, bodyConfig }) {
  const active = seatInfo.active;
  const eligible = seatInfo.eligible;
  const isInVote = voting && voteValue !== undefined;
  const isAbsentInVote = voting && voteValue === 'absent';
  const roleText = getMemberRoleText(member, bodyConfig, seatInfo);

  const handleClick = () => {
    if (!eligible) return;
    if (voting) {
      if (!isInVote) return;
      onVote(member.id);
    } else {
      onCycle(member.id);
    }
  };

  const borderColor = !eligible ? '#ddd' : !active && !isInVote ? '#ccc' : partyColor;
  const opacity = (!eligible || (!active && !voting) || isAbsentInVote) ? 'opacity-50' : '';

  return (
    <div className={'bg-surface rounded-lg border-l-4 shadow-card p-3 cursor-pointer transition-all hover:shadow-card-lg ' + opacity +
      (eligible && (isInVote || !voting) ? '' : ' pointer-events-none')}
      style={{ borderLeftColor: borderColor }}
      onClick={handleClick}>
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
            <div className={'flex items-center justify-center rounded w-8 h-8 ' +
              (voteValue === 'yes' ? 'bg-vote-yes' : 'bg-vote-no')}>
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

function MemberCards({ allMembers, bodyConfig, seatStates, currentVote, dispatch, data }) {
  const voting = !!currentVote;

  const handleCycle = useCallback((id) => {
    const m = allMembers.find(x => x.id === id);
    const name = m ? m.firstName + ' ' + m.lastName : id;
    if (bodyConfig.type !== 'plenum') {
      const pair = bodyConfig.seatPairs.find(p => p.substitute === id);
      if (pair) { dispatch({ type: 'CYCLE_SEAT', seatKey: pair.regular, bodyConfig, memberName: name }); return; }
    }
    dispatch({ type: 'CYCLE_SEAT', seatKey: id, bodyConfig, memberName: name });
  }, [bodyConfig, dispatch, allMembers]);

  const handleVote = useCallback(id => {
    dispatch({ type: 'CAST_VOTE', memberId: id });
  }, [dispatch]);

  // Sort: eligible first (active first, then inactive), then non-eligible
  const sorted = useMemo(() => {
    return [...allMembers].sort((a, b) => {
      const ai = getSeatInfo(a.id, bodyConfig, seatStates);
      const bi = getSeatInfo(b.id, bodyConfig, seatStates);
      if (ai.eligible !== bi.eligible) return ai.eligible ? -1 : 1;
      if (ai.active !== bi.active) return ai.active ? -1 : 1;
      return a.lastName.localeCompare(b.lastName);
    });
  }, [allMembers, bodyConfig, seatStates]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
      {sorted.map(m => {
        const info = getSeatInfo(m.id, bodyConfig, seatStates);
        const party = COUNCIL_DATA.getParty(data.parties, m.currentParty);
        return (
          <MemberCard key={m.id} member={m} partyColor={party.color} partyName={party.name}
            seatInfo={info} voting={voting} voteValue={currentVote?.votes[m.id]}
            onCycle={handleCycle} onVote={handleVote} bodyConfig={bodyConfig} />
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
  const passed = yes > no;

  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4 space-y-3">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider">Abstimmung</h3>

      <input type="text" placeholder="Titel der Abstimmung *" value={currentVote.title}
        onChange={e => dispatch({ type: 'UPDATE_VOTE', fields: { title: e.target.value } })}
        className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />

      <div className="relative">
        <input type="text" placeholder="Tagesordnungspunkt" value={currentVote.agendaItem} list="agenda-list"
          onChange={e => dispatch({ type: 'UPDATE_VOTE', fields: { agendaItem: e.target.value } })}
          className="w-full border border-brd rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none" />
        <datalist id="agenda-list">
          {agenda.map(a => <option key={a.id} value={a.title} />)}
        </datalist>
      </div>

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
        {absent > 0 && <>
          <span className="text-tx-m">|</span>
          <span className="text-absent font-bold">{absent} Abw.</span>
        </>}
        <span className="text-tx-m">|</span>
        <span className="text-tx-m">{voting} Stimmberechtigte</span>
      </div>

      <p className="text-[10px] text-tx-m text-center">Klick: Ja → Nein → Abwesend → Ja</p>

      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-gray-200 text-tx rounded-lg font-semibold text-sm hover:bg-gray-300"
          onClick={() => dispatch({ type: 'CANCEL_VOTE' })}>Abbrechen</button>
        <button className="flex-1 py-2 bg-primary text-white rounded-lg font-bold text-sm hover:bg-primary-dark disabled:opacity-40"
          disabled={!currentVote.title.trim()}
          onClick={() => setShowConfirm(true)}>Speichern</button>
      </div>

      {showConfirm && (
        <VoteConfirmModal vote={currentVote} yes={yes} no={no} absent={absent} voting={voting} passed={passed}
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
          <div className="text-center">
            <div className="text-2xl font-bold text-vote-yes">{yes}</div>
            <div className="text-xs text-tx-m">Ja</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-vote-no">{no}</div>
            <div className="text-xs text-tx-m">Nein</div>
          </div>
          {absent > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-absent">{absent}</div>
              <div className="text-xs text-tx-m">Abwesend</div>
            </div>
          )}
          <div className="text-center">
            <div className="text-2xl font-bold">{voting}</div>
            <div className="text-xs text-tx-m">Abstimmende</div>
          </div>
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
function ProtocolLog({ log, dispatch }) {
  if (log.length === 0) return null;
  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-3">Protokoll</h3>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {[...log].reverse().map(entry => (
          <LogEntryRow key={entry.id} entry={entry} dispatch={dispatch} />
        ))}
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
              dispatch({ type: 'ADD_LOG_COMMENT', logId: entry.id, comment });
              setEditing(false);
            }}>OK</button>
          </div>
        ) : (
          <button className="text-[10px] text-tx-m hover:text-primary ml-2" onClick={() => setEditing(true)}>
            [Kommentar]
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Export ────────────────────────────────────────────── */
function ExportPanel({ state, activeMembers }) {

  function buildVoteDetail(v) {
    let s = '';
    s += 'Abstimmung: ' + v.title + '\n';
    if (v.agendaItem) s += 'TOP: ' + v.agendaItem + '\n';
    s += 'Ergebnis: ' + v.result.yes + ' Ja, ' + v.result.no + ' Nein';
    if (v.result.absent) s += ', ' + v.result.absent + ' Abwesend';
    s += ' – ' + (v.result.passed ? 'angenommen' : 'abgelehnt') + '\n';
    if (v.comment) s += 'Kommentar: ' + v.comment + '\n';
    s += '\n';
    if (v.yesVoters && v.yesVoters.length) {
      s += 'Ja (' + v.yesVoters.length + '):\n';
      v.yesVoters.forEach(n => { s += '  ' + n + '\n'; });
    }
    if (v.noVoters && v.noVoters.length) {
      s += 'Nein (' + v.noVoters.length + '):\n';
      v.noVoters.forEach(n => { s += '  ' + n + '\n'; });
    }
    if (v.absentVoters && v.absentVoters.length) {
      s += 'Abwesend (' + v.absentVoters.length + '):\n';
      v.absentVoters.forEach(n => { s += '  ' + n + '\n'; });
    }
    return s;
  }

  function download(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const exportJSON = () => {
    const data = {
      session: {
        id: state.session.id, date: state.session.date,
        title: state.session.title, location: state.session.location, body: state.bodyId,
      },
      members: activeMembers.map(m => ({
        id: m.id, name: m.firstName + ' ' + m.lastName, party: m.currentParty, role: m.role,
      })),
      log: state.log,
      votes: state.votes,
    };
    download(JSON.stringify(data, null, 2), 'protokoll-' + state.session.date + '.json', 'application/json');
  };

  const exportMarkdown = () => {
    let md = '# Sitzungsprotokoll\n\n';
    md += '**' + state.session.title + '**\n';
    md += 'Datum: ' + fmtDate(state.session.date) + '\n';
    md += 'Ort: ' + state.session.location + '\n\n';
    md += '## Protokoll\n\n';
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
        if (v.yesVoters && v.yesVoters.length) {
          md += '**Ja (' + v.yesVoters.length + '):**\n';
          v.yesVoters.forEach(n => { md += '- ' + n + '\n'; });
          md += '\n';
        }
        if (v.noVoters && v.noVoters.length) {
          md += '**Nein (' + v.noVoters.length + '):**\n';
          v.noVoters.forEach(n => { md += '- ' + n + '\n'; });
          md += '\n';
        }
        if (v.absentVoters && v.absentVoters.length) {
          md += '**Abwesend (' + v.absentVoters.length + '):**\n';
          v.absentVoters.forEach(n => { md += '- ' + n + '\n'; });
          md += '\n';
        }
      });
    }
    download(md, 'protokoll-' + state.session.date + '.md', 'text/markdown');
  };

  const exportTxt = () => {
    let t = 'SITZUNGSPROTOKOLL\n';
    t += '==================\n\n';
    t += 'Titel:   ' + state.session.title + '\n';
    t += 'Datum:   ' + fmtDate(state.session.date) + '\n';
    t += 'Ort:     ' + state.session.location + '\n';
    t += 'Gremium: ' + state.bodyId + '\n\n';
    t += 'PROTOKOLL\n';
    t += '---------\n\n';
    state.log.forEach(e => {
      t += fmtTime(e.timestamp) + '  [' + e.type + ']  ' + e.message + '\n';
      if (e.comment) t += '          Kommentar: ' + e.comment + '\n';
    });
    if (state.votes.length) {
      t += '\nABSTIMMUNGEN\n';
      t += '------------\n\n';
      state.votes.forEach((v, i) => {
        t += (i + 1) + '. ' + buildVoteDetail(v) + '\n';
      });
    }
    download(t, 'protokoll-' + state.session.date + '.txt', 'text/plain');
  };

  return (
    <div className="bg-surface rounded-lg border border-brd shadow-card p-4">
      <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-2">Export</h3>
      <div className="flex gap-2">
        <button className="flex-1 py-2 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30" onClick={exportJSON}>
          JSON
        </button>
        <button className="flex-1 py-2 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30" onClick={exportMarkdown}>
          Markdown
        </button>
        <button className="flex-1 py-2 bg-accent-light rounded-lg text-sm font-semibold hover:bg-accent/30" onClick={exportTxt}>
          Text
        </button>
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

/* ── App ──────────────────────────────────────────────── */
function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    fetch('members.json')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(json => setData(COUNCIL_DATA.processRawData(json)))
      .catch(err => setLoadError('Daten konnten nicht geladen werden: ' + err.message));
  }, []);

  const activeMembers = useMemo(() => data ? COUNCIL_DATA.getActiveMembers(data.members, today) : [], [data, today]);
  const mayor = useMemo(() => activeMembers.find(m => m.role === 'mayor'), [activeMembers]);
  const councillors = useMemo(() => {
    if (!data) return [];
    return activeMembers.filter(m => m.role === 'councillor');
  }, [activeMembers, data]);

  const bodyDef = useMemo(() => data ? data.bodies.find(b => b.id === state.bodyId) : null, [data, state.bodyId]);
  const bodyConfig = useMemo(
    () => bodyDef ? COUNCIL_DATA.getBodyConfig(bodyDef, activeMembers) : null,
    [bodyDef, activeMembers]
  );

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

  const presentIds = useMemo(
    () => getPresentIds(state.seatStates, bodyConfig),
    [state.seatStates, bodyConfig]
  );

  useEffect(() => {
    if (state.session.id) {
      try { localStorage.setItem('council-session-' + state.bodyId, JSON.stringify(state)); } catch (e) {}
    }
  }, [state]);

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
      <SessionHeader session={state.session} bodyId={state.bodyId} bodies={data.bodies}
        dispatch={dispatch} />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <PartyLegend councillors={councillors} data={data} />
            <CouncilCircle councillors={councillors} mayor={mayor} bodyConfig={bodyConfig}
              seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch} data={data} />

            <div className="mt-4">
              <h3 className="font-serif font-bold text-primary-dark uppercase text-xs tracking-wider mb-3">Mitglieder</h3>
              <MemberCards allMembers={activeMembers} bodyConfig={bodyConfig}
                seatStates={state.seatStates} currentVote={state.currentVote} dispatch={dispatch} data={data} />
            </div>
          </div>

          <div className="space-y-4">
            <SessionInfoEditor session={state.session} dispatch={dispatch} />
            <AgendaPanel agenda={state.agenda} dispatch={dispatch} />
            <VotePanel currentVote={state.currentVote} session={state.session}
              presentIds={presentIds} dispatch={dispatch} agenda={state.agenda} activeMembers={activeMembers} />
            {state.session.status === 'ended' && (
              <ExportPanel state={state} activeMembers={activeMembers} />
            )}
          </div>
        </div>

        <div className="mt-6">
          <ProtocolLog log={state.log} dispatch={dispatch} />
        </div>
      </div>
    </div>
  );
}

/* ── Mount ────────────────────────────────────────────── */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
