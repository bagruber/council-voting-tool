/**
 * Council data layer – processing functions for members.json.
 * No hardcoded data; everything is fetched from the JSON at runtime.
 */
(function () {
  'use strict';

  /* ── Date helpers ────────────────────────────────────── */

  function parseDate(str) {
    if (!str) return null;
    var p = str.split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }

  function isActiveOn(item, date) {
    var from = parseDate(item.from);
    var to   = parseDate(item.to);
    if (from && date < from) return false;
    if (to   && date >= to)  return false;
    return true;
  }

  function getCurrentParty(member, date) {
    if (member.partyHistory) {
      for (var i = member.partyHistory.length - 1; i >= 0; i--) {
        var h = member.partyHistory[i];
        var from = parseDate(h.from);
        var to   = parseDate(h.to);
        if ((!from || date >= from) && (!to || date < to)) return h.party;
      }
    }
    return member.party;
  }

  /* ── Processing raw JSON ─────────────────────────────── */

  /**
   * Takes the raw members.json object and returns a ready-to-use data store.
   */
  function processRawData(json) {
    var parties = json.parties.map(function (p) {
      return { id: p.id, name: p.name, color: p.color };
    });

    var members = json.members.map(function (m) {
      var out = {
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

    var seatOrder = json.seatOrder || [];

    var bodies = json.bodies
      .filter(function (b) { return b.type === 'plenum' || b.type === 'ausschuss'; })
      .map(function (b) {
        var out = {
          id: b.id,
          name: b.name,
          shortName: b.shortName,
          type: b.type,
        };
        if (b.chair) out.chair = b.chair;
        if (b.chairSub) out.chairSub = b.chairSub;
        if (b.vicechairs) out.vicechairs = b.vicechairs;
        if (b.seats) {
          out.seats = b.seats.map(function (s) {
            return { member: s.member, sub: s.sub || null };
          });
        }
        return out;
      });

    return {
      parties: parties,
      members: members,
      bodies: bodies,
      seatOrder: seatOrder,
    };
  }

  /* ── Runtime helpers (operate on processed data) ─────── */

  function getActiveMembers(members, date) {
    return members
      .filter(function (m) { return isActiveOn(m, date); })
      .map(function (m) {
        return Object.assign({}, m, { currentParty: getCurrentParty(m, date) });
      });
  }

  function buildSeatOrder(councillors, seatOrder) {
    var order = seatOrder.concat(['parteilos', 'umb']);
    var ordered = [];
    order.forEach(function (pid) {
      var group = councillors
        .filter(function (m) { return m.currentParty === pid; })
        .sort(function (a, b) { return a.lastName.localeCompare(b.lastName); });
      ordered = ordered.concat(group);
    });
    var ids = new Set(ordered.map(function (m) { return m.id; }));
    councillors.forEach(function (m) { if (!ids.has(m.id)) ordered.push(m); });
    return ordered;
  }

  function getBodyConfig(bodyDef, activeMembers) {
    if (!bodyDef) return null;
    var activeIds = new Set(activeMembers.map(function (m) { return m.id; }));

    if (bodyDef.type === 'plenum') {
      var councillors = activeMembers.filter(function (m) { return m.role === 'councillor'; });
      var mayor = activeMembers.find(function (m) { return m.role === 'mayor'; });
      return {
        id: bodyDef.id, name: bodyDef.name, shortName: bodyDef.shortName, type: 'plenum',
        chairId: mayor ? mayor.id : null,
        seatPairs: councillors.map(function (m) { return { regular: m.id, substitute: null, role: 'member' }; }),
        allRegularIds: new Set(councillors.map(function (m) { return m.id; }).concat(mayor ? [mayor.id] : [])),
        allSubstituteIds: new Set(),
      };
    }

    // Committee
    var pairs = [];
    if (bodyDef.chair && activeIds.has(bodyDef.chair)) {
      pairs.push({
        regular: bodyDef.chair,
        substitute: bodyDef.chairSub && activeIds.has(bodyDef.chairSub) ? bodyDef.chairSub : null,
        role: 'chair',
      });
    }
    if (bodyDef.vicechairs) {
      bodyDef.vicechairs.forEach(function (vc) {
        if (activeIds.has(vc.member)) {
          pairs.push({
            regular: vc.member,
            substitute: vc.sub && activeIds.has(vc.sub) ? vc.sub : null,
            role: 'vicechair',
          });
        }
      });
    }
    if (bodyDef.seats) {
      bodyDef.seats.forEach(function (s) {
        if (activeIds.has(s.member)) {
          pairs.push({
            regular: s.member,
            substitute: s.sub && activeIds.has(s.sub) ? s.sub : null,
            role: 'member',
          });
        }
      });
    }

    var regIds = new Set();
    var subIds = new Set();
    pairs.forEach(function (p) {
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

  function getParty(parties, id) {
    return parties.find(function (p) { return p.id === id; }) || { id: id, name: id, color: '#999999' };
  }

  /* ── Public API ──────────────────────────────────────── */
  window.COUNCIL_DATA = {
    processRawData: processRawData,
    getActiveMembers: getActiveMembers,
    buildSeatOrder: buildSeatOrder,
    getBodyConfig: getBodyConfig,
    getParty: getParty,
  };
})();
