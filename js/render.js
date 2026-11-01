// render(): draws every dashboard section from `state`.
// Plain (non-module) scripts sharing one global scope, loaded in order by index.html.

function render() {
  const { league, teams, matchups, txns, chopHistory, seasonHistory, draftPicks } = state;
  if (!league) return; // nothing loaded yet
  const teamByRoster = new Map(teams.map(t => [t.roster_id, t]));
  const matchupByRoster = new Map(matchups.map(m => [m.roster_id, m]));
  // Shared by Chopping Block, and by the projected fallbacks further down
  // in Trash Talk / League Insights that kick in before live scoring starts.
  const teamProjTotal = t => (t.starters || []).reduce((sum, pid) => {
    const proj = state.projections[pid];
    return sum + (proj && proj.pts_ppr != null ? proj.pts_ppr : 0);
  }, 0);

  document.getElementById('league-name').textContent = league.name;
  const chopCount = teams.filter(t => t.eliminated).length;
  const remainingCount = league.total_rosters - chopCount;
  document.getElementById('league-sub').textContent =
    `Season ${league.season} · Week ${league.current_week} · ${remainingCount} remaining, ${chopCount} chopped · ${league.scoring_type}`;
  document.getElementById('footer-sync').textContent = league.last_synced
    ? `Last synced ${new Date(league.last_synced).toLocaleString()}`
    : '';

  // Teams still alive this week — the Live Leaderboard below ranks these.
  // (The Chopping Block / Danger Zone render further down, once Chop Risk
  // has been computed.)
  const activeMatchups = matchups.filter(m => {
    const t = teamByRoster.get(m.roster_id);
    return !t || !t.eliminated;
  });

  // ---- Live leaderboard: it's a chop league (lowest score each week is
  // out), not head-to-head, so this is always a ranked leaderboard — no
  // matchup pairing to check for. Already-chopped teams are excluded (they
  // live in the Graveyard now). ----
  const liveNote = document.getElementById('live-note');
  liveNote.textContent = `Week ${league.current_week} · ranked by live points`;

  const ranked = activeMatchups.slice().sort((a, b) => b.points - a.points);
  const maxPts = Math.max(1, ...ranked.map(m => m.points));
  const board = document.getElementById('live-scoreboard');
  board.innerHTML = '';
  ranked.forEach((m, i) => {
    const t = teamByRoster.get(m.roster_id);
    const row = document.createElement('div');
    row.className = 'score-row';
    const rank = document.createElement('div');
    rank.className = 'score-rank mono';
    rank.textContent = i + 1;
    const team = document.createElement('div');
    team.className = 'score-team';
    const nameWrap = document.createElement('div');
    nameWrap.style.minWidth = '0';
    nameWrap.style.flex = '1';
    const nm = document.createElement('div');
    nm.className = 'score-name';
    nm.textContent = t ? (t.team_name || t.display_name) : `Roster ${m.roster_id}`;
    const track = document.createElement('div');
    track.className = 'score-bar-track';
    const fill = document.createElement('div');
    fill.className = 'score-bar-fill';
    fill.style.width = Math.max(2, (m.points / maxPts) * 100) + '%';
    track.appendChild(fill);
    nameWrap.appendChild(nm);
    nameWrap.appendChild(track);
    team.appendChild(avatarEl(t || {}));
    team.appendChild(nameWrap);
    const pts = document.createElement('div');
    pts.className = 'score-pts';
    pts.textContent = fmt(m.points);
    row.appendChild(rank);
    row.appendChild(document.createElement('div'));
    row.appendChild(team);
    row.appendChild(pts);
    board.appendChild(row);
  });

  // ---- Graveyard: teams chopped (eliminated) by the weekly low score ----
  const graveyardGrid = document.getElementById('graveyard-grid');
  graveyardGrid.innerHTML = '';
  const chopped = teams.filter(t => t.eliminated);
  if (!chopped.length) {
    const empty = document.createElement('div');
    empty.className = 'graveyard-empty';
    empty.textContent = "Nobody's been chopped yet — everyone lives to fight another week.";
    graveyardGrid.appendChild(empty);
  } else {
    const graveyardSorted = chopped.slice().sort((a, b) => {
      const ha = chopHistory[a.roster_id], hb = chopHistory[b.roster_id];
      if (ha && hb) return ha.week - hb.week;
      if (ha) return -1;
      if (hb) return 1;
      return a.fpts - b.fpts;
    });
    graveyardSorted.forEach(t => {
      const h = chopHistory[t.roster_id];
      const card = document.createElement('div');
      card.className = 'tombstone-card';
      const name = t.team_name || t.display_name;
      // Owner handle only fits as a tooltip at this size.
      if (t.team_name) card.title = `${t.team_name} (${t.display_name})`;
      const skull = document.createElement('div');
      skull.className = 'tombstone-skull';
      skull.textContent = '💀';
      const text = document.createElement('div');
      text.className = 'tombstone-text';
      const nameEl = document.createElement('div');
      nameEl.className = 'tombstone-name';
      nameEl.textContent = name;
      const epitaph = document.createElement('div');
      epitaph.className = 'tombstone-epitaph';
      epitaph.textContent = h ? `Wk ${h.week} · ${fmt(h.points)} pts` : `Final: ${fmt(t.fpts)} pts`;
      text.appendChild(nameEl);
      text.appendChild(epitaph);
      card.appendChild(skull);
      card.appendChild(text);
      graveyardGrid.appendChild(card);
    });
  }

  function teamLabel(rid) {
    const t = teamByRoster.get(rid);
    return t ? (t.team_name || t.display_name) : `Roster ${rid}`;
  }

  // ---- Shared building blocks for Trash Talk / Strategy / League Insights
  // below (and the Boom & Bust / Points Left on the Table sections further
  // down), so each is only computed once. ----
  const aliveTeams = teams.filter(t => !t.eliminated);
  const isLiveThisWeek = matchups.some(m => m.points > 0);
  const posOf = pid => state.players[pid] && state.players[pid].position;
  const projOf = (wkProj, pid) => {
    const p = wkProj[pid];
    return p && p.pts_ppr != null ? p.pts_ppr : 0;
  };
  // Sleeper's stats feed leaves pts_ppr off entirely for a player who
  // played and scored 0, so "has played" has to come from gp instead.
  const hasPlayed = (wkStats, pid) => {
    const s = wkStats[pid];
    return !!s && (s.gp > 0 || s.pts_ppr != null);
  };
  const pct = x => `${Math.round(x * 100)}%`;
  const signed = x => `${x > 0 ? '+' : ''}${fmt(x)}`;

  // ---- Season-wide history: every completed week (from seasonHistory)
  // plus the current week's already-loaded live data. Rosters are treated
  // as fixed at their current composition wherever a stat needs "who owns
  // this player" (Sleeper doesn't expose historical ownership), but
  // anything lineup-based reads each week's own matchup starters/players,
  // which are exact. ----
  const historyWeeks = (seasonHistory && seasonHistory.weeks) || [];
  const allWeekNumbers = historyWeeks.concat([league.current_week]);
  const allWeeksMatchups = historyWeeks.map(w => seasonHistory.matchupsByWeek[w] || []).concat([matchups]);
  const allWeeksTxns = historyWeeks.map(w => seasonHistory.txnsByWeek[w] || []).concat([txns]);
  const allWeeksStatsProj = historyWeeks
    .map(w => ({ stats: seasonHistory.statsByWeek[w] || {}, proj: seasonHistory.projByWeek[w] || {} }))
    .concat([{ stats: state.stats, proj: state.projections }]);
  const completedWeeks = historyWeeks.map((week, i) => ({
    week,
    // A chopped team's roster is emptied, so any later week's matchup row
    // for them is a meaningless 0 — only keep rows for teams alive that week.
    matchups: allWeeksMatchups[i].filter(m => {
      const ch = chopHistory[m.roster_id];
      return (!ch || ch.week >= week) && m.starters.length;
    }),
    stats: allWeeksStatsProj[i].stats,
    proj: allWeeksStatsProj[i].proj,
  }));
  const weeksRange = completedWeeks.length ? `weeks 1–${completedWeeks[completedWeeks.length - 1].week}` : '';
  const smallSample = completedWeeks.length < 4;

  // ---- Optimal lineup: the best possible lineup a roster could have set
  // from its own players, given the league's actual slots. Filling the
  // narrowest slots first (QB/RB/WR/TE, then FLEX) with the highest scorer
  // still available is exactly optimal here, since every flex slot's
  // eligibility is a superset of the fixed slots'. "Points left on the
  // table" is this minus the lineup actually set — the standard measure of
  // a lineup mistake (unlike raw bench points, which punish having a good
  // bench even when every start was correct). ----
  const SLOT_ELIGIBLE = {
    QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  };
  const lineupSlots = (league.roster_positions || []).filter(s => SLOT_ELIGIBLE[s])
    .sort((a, b) => SLOT_ELIGIBLE[a].length - SLOT_ELIGIBLE[b].length);
  function optimalLineup(pids, ptsOf) {
    const pool = pids.map(pid => ({ pid, pos: posOf(pid), pts: ptsOf(pid) })).filter(p => p.pos).sort((a, b) => b.pts - a.pts);
    const used = new Set();
    let total = 0;
    lineupSlots.forEach(slot => {
      const pick = pool.find(p => !used.has(p.pid) && SLOT_ELIGIBLE[slot].includes(p.pos));
      if (pick) { used.add(pick.pid); total += pick.pts; }
    });
    return { total, picks: used };
  }
  const matchupPids = m => (m.players && m.players.length ? m.players : Object.keys(m.players_points || {}));
  // Which benched players should have started, and whom they'd replace —
  // shown as the expandable sub-rows under each team.
  function lineupSwapPairs(m, ptsOf, picks) {
    const starterSet = new Set(m.starters);
    const shouldStart = Array.from(picks).filter(pid => !starterSet.has(pid)).sort((a, b) => ptsOf(b) - ptsOf(a));
    const shouldSit = m.starters.filter(pid => pid && pid !== '0' && !picks.has(pid)).sort((a, b) => ptsOf(a) - ptsOf(b));
    return shouldStart.map(inPid => {
      // Pair with a benchable starter at the same position when there is
      // one, otherwise whoever's worst (a flex swap).
      let i = shouldSit.findIndex(o => posOf(o) === posOf(inPid));
      if (i < 0) i = 0;
      const outPid = shouldSit.splice(i, 1)[0] || null;
      return { inPid, outPid, gain: ptsOf(inPid) - (outPid ? ptsOf(outPid) : 0) };
    });
  }
  const currentPtsLabel = (ptsOf, pid) => `${fmt(ptsOf(pid))}${hasPlayed(state.stats, pid) ? '' : ' proj'}`;
  const swapText = (ptsOf, sw) => `Start ${playerLabel(sw.inPid).name} (${currentPtsLabel(ptsOf, sw.inPid)}) over ${sw.outPid ? `${playerLabel(sw.outPid).name} (${currentPtsLabel(ptsOf, sw.outPid)})` : 'an empty slot'}`;

  // Completed weeks: actual points, exact.
  const lineupGapsByWeek = completedWeeks.map(({ week, matchups: wm }) => ({
    week,
    rows: wm.map(m => {
      const ptsOf = pid => (m.players_points || {})[pid] || 0;
      const opt = optimalLineup(matchupPids(m), ptsOf);
      const swaps = lineupSwapPairs(m, ptsOf, opt.picks).filter(sw => sw.gain > 0.005).map(sw =>
        `Start ${playerLabel(sw.inPid).name} (${fmt(ptsOf(sw.inPid))}) over ${sw.outPid ? `${playerLabel(sw.outPid).name} (${fmt(ptsOf(sw.outPid))})` : 'an empty slot'}`);
      return { roster_id: m.roster_id, actual: m.points, optimal: opt.total, gap: Math.max(0, opt.total - m.points), swaps };
    }),
  }));

  // Current week: a player who has already played counts at his actual
  // points, everyone else at his projection. Pre-kickoff that's a pure
  // projected read on the lineup as it's set right now (still fixable);
  // once games finish it converges to the exact actual number. Without
  // the projection half, a Thursday bench player would look like a
  // "should've started" over a Sunday starter who simply hasn't played yet.
  const anyPlayedThisWeek = matchups.some(m => m.starters.some(pid => hasPlayed(state.stats, pid)));
  const currentPtsOf = m => pid => (hasPlayed(state.stats, pid) ? ((m.players_points || {})[pid] || 0) : projOf(state.projections, pid));
  const aliveIds = new Set(aliveTeams.map(t => t.roster_id));
  const currentGaps = matchups.filter(m => aliveIds.has(m.roster_id)).map(m => {
    const ptsOf = currentPtsOf(m);
    const opt = optimalLineup(matchupPids(m), ptsOf);
    const setTotal = m.starters.reduce((s, pid) => s + ptsOf(pid), 0);
    const pairs = lineupSwapPairs(m, ptsOf, opt.picks);
    return {
      roster_id: m.roster_id,
      gap: Math.max(0, opt.total - setTotal),
      pairs,
      ptsOf,
      swaps: pairs.map(sw => swapText(ptsOf, sw)),
    };
  }).sort((a, b) => b.gap - a.gap);

  // ---- Lineup landmines: starters guaranteed (or all but) to score 0 —
  // ruled out, inactive, not on an NFL roster, or on bye this week. ----
  const UNAVAILABLE_STATUS = new Set(['Out', 'Doubtful', 'IR', 'PUP', 'NA', 'Sus']);
  const landmines = [];
  aliveTeams.forEach(t => {
    t.starters.forEach(pid => {
      const p = state.players[pid];
      if (!p || pid === '0') return;
      let flag = null;
      if (BYE_WEEKS[p.team] === league.current_week) flag = 'on bye';
      else if (p.status === 'Inactive') flag = 'Inactive';
      else if (UNAVAILABLE_STATUS.has(p.injury_status)) flag = p.injury_status;
      else if (!p.team) flag = 'no NFL team';
      if (flag) landmines.push({ rid: t.roster_id, team: teamLabel(t.roster_id), player: playerLabel(pid).name, flag });
    });
  });

  // Rostered players' actual points vs. Sleeper's pre-game projection —
  // powers the Boom & Bust section further down (all rostered players).
  const rosteredIds = new Set();
  teams.forEach(t => t.players.forEach(pid => rosteredIds.add(pid)));
  const boomBustRows = [];
  rosteredIds.forEach(pid => {
    const proj = state.projections[pid];
    const actual = state.stats[pid];
    if (!proj || !actual) return;
    const projPts = proj.pts_ppr;
    const actualPts = actual.pts_ppr;
    if (projPts == null || actualPts == null || projPts < BOOM_BUST_MIN_PROJECTION) return;
    const owners = teams.filter(t => t.players.includes(pid)).map(t => t.team_name || t.display_name);
    boomBustRows.push({ pid, projPts, actualPts, delta: actualPts - projPts, owners });
  });
  const worstBustRows = boomBustRows.slice().sort((a, b) => a.delta - b.delta);

  // Before actual stats exist for the week (no games played yet), there's
  // nothing to compare projections against — fall back to showing the
  // projections alone so the section isn't just empty. Reverts to the
  // real delta view automatically once any actual stats come in.
  const projOnlyRows = [];
  if (!boomBustRows.length) {
    rosteredIds.forEach(pid => {
      const proj = state.projections[pid];
      if (!proj || proj.pts_ppr == null || proj.pts_ppr < BOOM_BUST_MIN_PROJECTION) return;
      const owners = teams.filter(t => t.players.includes(pid)).map(t => t.team_name || t.display_name);
      projOnlyRows.push({ pid, projPts: proj.pts_ppr, owners });
    });
    projOnlyRows.sort((a, b) => b.projPts - a.projPts);
  }

  // Starter-only busts: a benched player busting costs nobody anything,
  // so the blunder version only counts players someone actually started.
  // Uses league-scored points from the matchup, and counts a played-for-0
  // game (which the raw stats feed would otherwise skip).
  const starterBustsFor = (wm, wkStats, wkProj) => {
    const rows = [];
    wm.forEach(m => {
      m.starters.forEach(pid => {
        if (!pid || pid === '0' || !hasPlayed(wkStats, pid)) return;
        const projPts = projOf(wkProj, pid);
        if (projPts < BOOM_BUST_MIN_PROJECTION) return;
        const actualPts = (m.players_points || {})[pid] || 0;
        rows.push({ pid, rid: m.roster_id, projPts, actualPts, delta: actualPts - projPts });
      });
    });
    return rows;
  };
  const starterBustsThisWeek = starterBustsFor(matchups.filter(m => aliveIds.has(m.roster_id)), state.stats, state.projections)
    .sort((a, b) => a.delta - b.delta);

  // ---- Stat tiles: Trash Talk Stats — genuine manager mistakes only:
  // things someone chose (who to start) that cost them points, not bad luck
  // on a player they couldn't have benched. ----
  const statGrid = document.getElementById('stat-grid');
  statGrid.innerHTML = '';
  const tiles = [];

  tiles.push({
    eyebrow: 'Lineup Landmines',
    headline: landmines.length ? `${landmines.length} dead starter${landmines.length === 1 ? '' : 's'}` : 'All clear',
    detail: landmines.length
      ? `${landmines[0].team} is starting ${landmines[0].player} (${landmines[0].flag})${landmines.length > 1 ? ` — plus ${landmines.length - 1} more around the league` : ''}`
      : 'nobody is starting a player who is out or on bye this week',
    info: "Starters who can't score this week: ruled Out, Doubtful, on IR/PUP/suspended, inactive, without an NFL team, or on their team's bye. A near-certain 0 in the lineup.",
    rows: Array.from(new Set(landmines.map(l => l.rid))).map(rid => {
      const mine = landmines.filter(l => l.rid === rid);
      return { label: teamLabel(rid), value: `${mine.length} dead starter${mine.length === 1 ? '' : 's'}`, moves: mine.map(l => `${l.player} (${l.flag})`) };
    }),
    emptyMessage: 'Every starting lineup is clean this week.',
  });

  if (currentGaps[0] && currentGaps[0].gap > 0.5) {
    const worst = currentGaps[0];
    tiles.push({
      eyebrow: anyPlayedThisWeek ? 'Points Left on the Table' : 'Points Left on the Table (Projected)',
      headline: teamLabel(worst.roster_id),
      detail: anyPlayedThisWeek
        ? `Their best possible lineup is ${fmt(worst.gap)} points better than the one they set this week`
        : `Their lineup as set projects ${fmt(worst.gap)} points below their best possible lineup — still time to fix it`,
      info: anyPlayedThisWeek
        ? 'Best possible lineup from the same roster, minus the lineup actually set. Players who have played count at actual points, the rest at their projection. Tap a team for the swaps.'
        : "Best possible lineup by Sleeper's projections, minus the lineup currently set. Only counts real start/sit mistakes, not a deep bench. Tap a team for the swaps.",
      rows: currentGaps.filter(g => g.gap > 0.5).map(g => ({ label: teamLabel(g.roster_id), value: fmt(g.gap), moves: g.swaps })),
    });
  }

  if (starterBustsThisWeek.length && starterBustsThisWeek[0].delta < 0) {
    const worst = starterBustsThisWeek[0];
    tiles.push({
      eyebrow: 'Biggest Bust',
      headline: teamLabel(worst.rid),
      detail: `Started ${playerLabel(worst.pid).name}: ${fmt(worst.actualPts)} points against a ${fmt(worst.projPts)} projection`,
      info: "Starters only (a benched bust doesn't cost anything). Actual points minus Sleeper's pre-game projection, for players whose game has kicked off.",
      rows: starterBustsThisWeek.filter(r => r.delta < 0).slice(0, 8).map(r => {
        const m = matchupByRoster.get(r.rid);
        const ptsOf = currentPtsOf(m);
        const benchAlt = matchupPids(m).filter(pid => !m.starters.includes(pid) && posOf(pid) === posOf(r.pid))
          .sort((a, b) => ptsOf(b) - ptsOf(a))[0];
        return {
          label: `${playerLabel(r.pid).name} (${teamLabel(r.rid)})`,
          value: signed(r.delta),
          moves: [
            `${fmt(r.actualPts)} actual vs ${fmt(r.projPts)} projected`,
            benchAlt ? `Best benched ${posOf(r.pid)}: ${playerLabel(benchAlt).name} (${currentPtsLabel(ptsOf, benchAlt)})` : `No other ${posOf(r.pid)} on the bench`,
          ],
        };
      }),
    });
  }

  // ---- The two tiles below only kick in once at least one full week is
  // in the books — before that there's no season history to speak of. ----
  if (completedWeeks.length) {
    const seasonGap = new Map();
    lineupGapsByWeek.forEach(({ rows }) => rows.forEach(r => {
      if (aliveIds.has(r.roster_id)) seasonGap.set(r.roster_id, (seasonGap.get(r.roster_id) || 0) + r.gap);
    }));
    const seasonGapSorted = Array.from(seasonGap.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (seasonGapSorted.length) {
      tiles.push({
        eyebrow: 'Season Points Left on the Table',
        headline: teamLabel(seasonGapSorted[0][0]),
        detail: `${fmt(seasonGapSorted[0][1])} points lost to start/sit mistakes across ${weeksRange}`,
        info: 'Each completed week: best possible lineup from that week\'s roster minus the lineup actually set, summed over the season.',
        rows: seasonGapSorted.map(([rid, v]) => ({
          label: teamLabel(rid),
          value: fmt(v),
          moves: lineupGapsByWeek.flatMap(({ week, rows }) => {
            const r = rows.find(x => x.roster_id === rid);
            if (!r) return [];
            if (r.gap < 0.005) return [`Week ${week}: perfect lineup`];
            return r.swaps.map((sw, i) => `Week ${week}${i === 0 ? ` (−${fmt(r.gap)})` : ''}: ${sw}`);
          }),
        })),
      });
    }

    // Kept Starting a Dud: the same manager starting the same player week
    // after week while he keeps missing his projection — only weeks he was
    // actually in the lineup count.
    const dud = new Map();
    completedWeeks.forEach(({ week, matchups: wm, stats: wkStats, proj: wkProj }) => {
      starterBustsFor(wm, wkStats, wkProj).forEach(r => {
        const key = `${r.rid}|${r.pid}`;
        const e = dud.get(key) || { rid: r.rid, pid: r.pid, deltaSum: 0, starts: 0, log: [] };
        e.deltaSum += r.delta;
        e.starts += 1;
        e.log.push(`Week ${week}: ${fmt(r.actualPts)} vs ${fmt(r.projPts)} proj (${signed(r.delta)})`);
        dud.set(key, e);
      });
    });
    const dudRows = Array.from(dud.values()).filter(e => e.starts >= 2 && aliveIds.has(e.rid) && e.deltaSum < 0)
      .sort((a, b) => a.deltaSum - b.deltaSum);
    if (dudRows.length) {
      const worst = dudRows[0];
      tiles.push({
        eyebrow: 'Kept Starting a Dud',
        headline: teamLabel(worst.rid),
        detail: `${worst.starts} starts for ${playerLabel(worst.pid).name}, ${fmt(Math.abs(worst.deltaSum))} points under projection in total`,
        info: 'Players started 2+ times by the same manager, ranked by total points under projection in the weeks they were in the lineup.',
        rows: dudRows.slice(0, 8).map(r => ({ label: `${playerLabel(r.pid).name} (${teamLabel(r.rid)})`, value: `${signed(r.deltaSum)} · ${r.starts} starts`, moves: r.log })),
      });
    }
  }

  renderStatCards(statGrid, tiles, 'stat');

  // ---- Strategy: forward-looking and actionable — risk, liquidity, and
  // what to do before the next lineup lock or waiver run. ----
  const strategyGrid = document.getElementById('strategy-grid');
  const strategyTiles = [];

  let chopRiskRows = [];
  let chopRiskBaseSd = null, chopRiskFromLeague = false;
  // Chop Risk: each alive team's probability of posting the week's lowest
  // score. Each team's score is modeled as Normal(mean, sd): mean = actual
  // points already banked + projections for starters yet to play; sd = the
  // league's own projection error (RMSE of actual vs. projected lineup
  // totals over completed weeks), scaled by the square root of the share of
  // projected points still to be played. P(team i is lowest) =
  // ∫ f_i(x) · Π_{j≠i} (1 − F_j(x)) dx, integrated numerically.
  {
    const residuals = [];
    completedWeeks.forEach(({ matchups: wm, proj: wkProj }) => {
      wm.forEach(m => {
        const projTotal = m.starters.reduce((s, pid) => s + projOf(wkProj, pid), 0);
        if (projTotal > 0) residuals.push(m.points - projTotal);
      });
    });
    const DEFAULT_SD = 22; // typical weekly PPR lineup forecast error, until the league has its own history
    const baseSd = residuals.length >= 10
      ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length)
      : DEFAULT_SD;
    const dists = matchups.filter(m => aliveIds.has(m.roster_id)).map(m => {
      let banked = 0, remainingProj = 0, fullProj = 0, toPlay = 0;
      m.starters.forEach(pid => {
        if (!pid || pid === '0') return;
        const pp = projOf(state.projections, pid);
        fullProj += pp;
        if (hasPlayed(state.stats, pid)) banked += (m.players_points || {})[pid] || 0;
        else { remainingProj += pp; toPlay += 1; }
      });
      const share = fullProj > 0 ? remainingProj / fullProj : 1;
      return { roster_id: m.roster_id, mu: banked + remainingProj, sd: Math.max(1, baseSd * Math.sqrt(share)), banked, toPlay };
    });
    if (dists.length >= 2) {
      const erf = x => {
        const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
        return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
      };
      const cdf = (x, d) => 0.5 * (1 + erf((x - d.mu) / (d.sd * Math.SQRT2)));
      const pdf = (x, d) => Math.exp(-0.5 * ((x - d.mu) / d.sd) ** 2) / (d.sd * Math.sqrt(2 * Math.PI));
      const lo = Math.min(...dists.map(d => d.mu - 6 * d.sd));
      const hi = Math.max(...dists.map(d => d.mu + 6 * d.sd));
      const step = (hi - lo) / 2000;
      const risk = dists.map(() => 0);
      for (let x = lo; x <= hi; x += step) {
        const surv = dists.map(d => 1 - cdf(x, d));
        dists.forEach((d, i) => {
          let p = pdf(x, d) * step;
          surv.forEach((s, j) => { if (j !== i) p *= s; });
          risk[i] += p;
        });
      }
      const totalRisk = risk.reduce((a, b) => a + b, 0) || 1;
      const riskRows = dists.map((d, i) => ({ ...d, p: risk[i] / totalRisk })).sort((a, b) => b.p - a.p);
      chopRiskRows = riskRows;
      chopRiskBaseSd = baseSd;
      chopRiskFromLeague = residuals.length >= 10;
      const top = riskRows[0];
      strategyTiles.push({
        eyebrow: 'Chop Risk',
        headline: teamLabel(top.roster_id),
        detail: `${pct(top.p)} chance of the week's lowest score — ${anyPlayedThisWeek ? 'tracking' : 'projected'} ${fmt(top.mu)} ± ${fmt(top.sd)}`,
        info: `Each team's chance of posting the week's lowest score. Score = points already banked + projections for starters yet to play, with ± uncertainty set by ${residuals.length >= 10 ? `this league's own projection miss (±${fmt(baseSd)} per lineup over ${residuals.length} team-weeks)` : `a typical ±${DEFAULT_SD} PPR forecast miss until this league has 10+ team-weeks of history`}, shrinking as games finish. In a chop league you're managing downside risk, not upside: a risky lineup near the bottom should chase a safer floor.`,
        rows: riskRows.map(r => {
          const m = matchupByRoster.get(r.roster_id);
          const ptsOf = currentPtsOf(m);
          return {
            label: teamLabel(r.roster_id),
            value: `${r.p < 0.005 ? '<1%' : pct(r.p)} · ${fmt(r.mu)}`,
            moves: m.starters.filter(pid => pid && pid !== '0').map(pid => `${posOf(pid) || '—'} ${playerLabel(pid).name}: ${currentPtsLabel(ptsOf, pid)}`),
          };
        }),
      });
    }
  }

  // Bye Week Crunch: for each upcoming week, how many of a team's current
  // starters are on bye — the week their lineup has holes to fill.
  {
    const crunch = aliveTeams.map(t => {
      const byWeek = new Map();
      t.starters.forEach(pid => {
        const p = state.players[pid];
        const bye = p && BYE_WEEKS[p.team];
        if (bye && bye > league.current_week) {
          if (!byWeek.has(bye)) byWeek.set(bye, []);
          byWeek.get(bye).push(pid);
        }
      });
      let week = null, pids = [];
      byWeek.forEach((v, w) => { if (v.length > pids.length || (v.length === pids.length && w < week)) { week = w; pids = v; } });
      return { rid: t.roster_id, week, pids };
    }).filter(c => c.pids.length >= 2).sort((a, b) => b.pids.length - a.pids.length || a.week - b.week);
    strategyTiles.push({
      eyebrow: 'Bye Week Crunch',
      headline: crunch[0] ? teamLabel(crunch[0].rid) : 'No crunch ahead',
      detail: crunch[0]
        ? `${crunch[0].pids.length} of ${lineupSlots.length} current starters on bye in Week ${crunch[0].week} — needs a plan before then`
        : 'no team loses 2+ current starters to the same upcoming bye',
      info: "Each team's worst upcoming week: the most current starters sharing a bye. Stacking a QB with his receivers is fine for upside, but it also means losing them all in the same week. Tap a team for the players.",
      rows: crunch.map(c => ({
        label: teamLabel(c.rid),
        value: `Wk ${c.week}: ${c.pids.length} starters`,
        moves: c.pids.map(pid => `${playerLabel(pid).name} (${playerLabel(pid).pos}, ${playerLabel(pid).team})`),
      })),
      emptyMessage: 'Every lineup is spread across different bye weeks.',
    });
  }

  // Dead Roster Spots: rostered players who can't score for the
  // foreseeable future — each one is a roster spot that could be holding a
  // waiver pickup instead.
  {
    const DEAD_STATUS = new Set(['Out', 'IR', 'PUP', 'NA', 'Sus']);
    const dead = aliveTeams.map(t => {
      const pids = t.players.filter(pid => {
        const p = state.players[pid];
        return p && (p.status === 'Inactive' || DEAD_STATUS.has(p.injury_status) || !p.team);
      });
      return { rid: t.roster_id, pids };
    }).filter(d => d.pids.length).sort((a, b) => b.pids.length - a.pids.length);
    if (dead.length) {
      const flagOf = pid => {
        const p = state.players[pid];
        return !p.team ? 'no NFL team' : (p.status === 'Inactive' ? 'Inactive' : p.injury_status);
      };
      strategyTiles.push({
        eyebrow: 'Dead Roster Spots',
        headline: teamLabel(dead[0].rid),
        detail: `${dead[0].pids.length} of ${teamByRoster.get(dead[0].rid).players.length} roster spots tied up in players who can't play right now`,
        info: 'Rostered players who are Out, on IR/PUP, suspended, inactive, or without an NFL team. This league has no IR slot, so each one takes a spot a waiver pickup could use. Worth stashing only if he returns before you can be chopped.',
        rows: dead.map(d => ({
          label: teamLabel(d.rid),
          value: `${d.pids.length} dead`,
          moves: d.pids.map(pid => `${playerLabel(pid).name} (${playerLabel(pid).pos}) — ${flagOf(pid)}`),
        })),
      });
    }
  }

  // Dry Powder: remaining FAAB as a share of the league's total — each
  // chop dumps an entire roster onto waivers at once, and FAAB is the only
  // currency for bidding on it.
  {
    const budget = league.waiver_budget;
    const faab = aliveTeams.map(t => ({ rid: t.roster_id, left: Math.max(0, budget - (t.waiver_budget_used || 0)) }))
      .sort((a, b) => b.left - a.left);
    const totalLeft = faab.reduce((s, f) => s + f.left, 0);
    if (faab.length && totalLeft > 0) {
      const sortedLeft = faab.map(f => f.left).sort((a, b) => a - b);
      const median = sortedLeft[Math.floor(sortedLeft.length / 2)];
      const even = faab[0].left === faab[faab.length - 1].left;
      const bidsByRoster = new Map();
      allWeekNumbers.forEach((wk, i) => allWeeksTxns[i].forEach(tx => {
        if (tx.type !== 'waiver' || tx.status !== 'complete') return;
        const bid = tx.settings && tx.settings.waiver_bid;
        Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
          if (!bidsByRoster.has(rid)) bidsByRoster.set(rid, []);
          bidsByRoster.get(rid).push(`Week ${wk}: $${bid || 0} on ${playerLabel(pid).name} (${playerLabel(pid).pos || '—'})`);
        });
      }));
      strategyTiles.push({
        eyebrow: 'Dry Powder',
        headline: even ? 'Even money' : teamLabel(faab[0].rid),
        detail: even
          ? `Every team still has $${faab[0].left} of FAAB — first big bid on a chopped roster's players sets the market`
          : `$${faab[0].left} of FAAB left — ${pct(faab[0].left / totalLeft)} of all the buying power left in the league (median team: $${median})`,
        info: "Every chop dumps a whole roster, often with a couple of starters, onto waivers at once, and FAAB is the only way to bid on them. Share = each team's remaining budget over the league's total. Teams with the most left can outbid everyone on the next chopped team's best players.",
        rows: faab.map(f => ({ label: teamLabel(f.rid), value: `$${f.left} · ${pct(f.left / totalLeft)}`, moves: bidsByRoster.get(f.rid) || ['No waiver claims won yet'] })),
      });
    }
  }

  // Best Available: the highest-projected unrostered players this week,
  // and how many teams' weakest starter at that position they'd beat.
  const fas = [];
  {
    const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
    const HURT = new Set(['Out', 'IR', 'PUP', 'NA', 'Sus', 'Doubtful']);
    Object.entries(state.players).forEach(([pid, p]) => {
      if (rosteredIds.has(pid) || !p || !SKILL.has(p.position) || !p.team || HURT.has(p.injury_status)) return;
      const pp = projOf(state.projections, pid);
      if (pp >= BOOM_BUST_MIN_PROJECTION) fas.push({ pid, pos: p.position, proj: pp });
    });
    const upgradesFor = fa => aliveTeams.map(t => {
      const weakest = t.starters.filter(pid => posOf(pid) === fa.pos)
        .sort((a, b) => projOf(state.projections, a) - projOf(state.projections, b))[0];
      return weakest && projOf(state.projections, weakest) < fa.proj
        ? `${teamLabel(t.roster_id)}: over ${playerLabel(weakest).name} (${fmt(projOf(state.projections, weakest))} proj), +${fmt(fa.proj - projOf(state.projections, weakest))}`
        : null;
    }).filter(Boolean);
    fas.forEach(fa => { fa.upgrades = upgradesFor(fa); fa.beats = fa.upgrades.length; });
    fas.sort((a, b) => b.beats - a.beats || b.proj - a.proj);
    if (fas.length) {
      const topFa = fas[0];
      const faLabel = fa => {
        const info = playerLabel(fa.pid);
        const bye = BYE_WEEKS[info.team];
        return `${info.name} (${fa.pos}, ${info.team}${bye ? `, Wk ${bye} bye` : ''})`;
      };
      strategyTiles.push({
        eyebrow: 'Best Available',
        headline: playerLabel(topFa.pid).name,
        detail: `Unrostered ${topFa.pos} projected for ${fmt(topFa.proj)} this week — would out-project the weakest starting ${topFa.pos} on ${topFa.beats} team${topFa.beats === 1 ? '' : 's'}`,
        info: "Healthy unrostered QB/RB/WR/TE, ranked by how many teams he'd be an instant upgrade for (\"beats\" = out-projects that team's weakest starter at his position this week), then by Sleeper's projection.",
        rows: fas.slice(0, 10).map(fa => ({ label: faLabel(fa), value: `${fmt(fa.proj)} proj · beats ${fa.beats}`, moves: fa.upgrades.length ? fa.upgrades : ['Not an upgrade on any current lineup'] })),
      });
    }
  }

  renderStatCards(strategyGrid, strategyTiles, 'strategy');

  // ---- Chopping Block + Danger Zone: the team with the highest Chop Risk,
  // then the next three. Same model as the Chop Risk tile (banked points +
  // projections for starters yet to play), so a Thursday-night score counts
  // but a Sunday starter isn't treated as a 0. Each one expands into why
  // they're there and a concrete, point-valued escape plan. ----
  const posAvgProj = new Map();
  {
    const byPos = new Map();
    matchups.filter(m => aliveIds.has(m.roster_id)).forEach(m => m.starters.forEach(pid => {
      const pos = posOf(pid);
      if (!pos) return;
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos).push(projOf(state.projections, pid));
    }));
    byPos.forEach((v, pos) => posAvgProj.set(pos, v.reduce((a, b) => a + b, 0) / v.length));
  }
  const byMuAsc = chopRiskRows.slice().sort((a, b) => a.mu - b.mu);
  const allLocked = chopRiskRows.every(r => r.toPlay === 0);

  function escapePlan(r) {
    const m = matchupByRoster.get(r.roster_id);
    const g = currentGaps.find(x => x.roster_id === r.roster_id);
    const rank = byMuAsc.findIndex(x => x.roster_id === r.roster_id) + 1; // 1 = lowest
    const above = byMuAsc[rank]; // next team up
    const bottom = byMuAsc[0];
    const starters = m.starters.filter(pid => pid && pid !== '0');
    const unplayed = pid => !hasPlayed(state.stats, pid);

    // Why: dead starters and the weakest spots vs. the average starter at
    // that position this week.
    const dead = landmines.filter(l => l.rid === r.roster_id);
    const weakSpots = starters.filter(unplayed).map(pid => ({ pid, pos: posOf(pid), proj: projOf(state.projections, pid) }))
      .filter(s => posAvgProj.has(s.pos))
      .map(s => ({ ...s, vsAvg: s.proj - posAvgProj.get(s.pos) }))
      .filter(s => s.vsAvg < 0)
      .sort((a, b) => a.vsAvg - b.vsAvg)
      .slice(0, 3);

    // How to get out, part 1: start/sit fixes still possible (both players
    // yet to play — anyone who's played is locked).
    const fixes = g ? g.pairs.filter(sw => sw.gain > 0.1 && unplayed(sw.inPid) && (!sw.outPid || unplayed(sw.outPid))) : [];
    const fixGain = fixes.reduce((s, sw) => s + sw.gain, 0);

    // Part 2: waiver/free-agent adds that out-project an unplayed starter
    // at the same position (after the lineup fixes above), best gains
    // first, each free agent used once.
    const benched = new Set(fixes.map(sw => sw.outPid));
    const lineupAfterFixes = starters.filter(pid => !benched.has(pid)).concat(fixes.map(sw => sw.inPid));
    const usedFa = new Set();
    const adds = [];
    lineupAfterFixes.filter(unplayed).map(pid => ({ pid, pos: posOf(pid), proj: projOf(state.projections, pid) }))
      .map(s => {
        const fa = fas.filter(f => f.pos === s.pos && unplayed(f.pid) && f.proj > s.proj + 0.5).sort((a, b) => b.proj - a.proj);
        return { s, fa };
      })
      .filter(x => x.fa.length)
      .sort((a, b) => (b.fa[0].proj - b.s.proj) - (a.fa[0].proj - a.s.proj))
      .forEach(({ s, fa }) => {
        const pick = fa.find(f => !usedFa.has(f.pid));
        if (!pick || adds.length >= 3) return;
        usedFa.add(pick.pid);
        adds.push({ add: pick, drop: s, gain: pick.proj - s.proj });
      });
    const addGain = adds.reduce((s, a) => s + a.gain, 0);

    const newMu = r.mu + fixGain + addGain;
    const others = byMuAsc.filter(x => x.roster_id !== r.roster_id);
    const newRank = 1 + others.filter(x => x.mu < newMu).length;
    const cushion = rank === 1 ? null : r.mu - bottom.mu;
    const zCushion = cushion != null ? cushion / Math.sqrt(r.sd ** 2 + bottom.sd ** 2) : null;

    // The why/how summary, as the panel's explainer.
    const whyParts = [];
    if (rank === 1) whyParts.push(`Lowest ${anyPlayedThisWeek ? 'live + projected' : 'projected'} score among the ${byMuAsc.length} teams left${above ? `, ${fmt(above.mu - r.mu)} behind ${teamLabel(above.roster_id)}` : ''}.`);
    else whyParts.push(`#${rank} lowest of ${byMuAsc.length}, only ${fmt(cushion)} points (${zCushion.toFixed(1)} standard deviations) above ${teamLabel(bottom.roster_id)} at the bottom.`);
    if (dead.length) whyParts.push(`${dead.length} starter${dead.length === 1 ? '' : 's'} can't score.`);
    if (weakSpots.length) whyParts.push(`Weakest spot: ${playerLabel(weakSpots[0].pid).name} (${weakSpots[0].pos}), ${fmt(Math.abs(weakSpots[0].vsAvg))} below the average starting ${weakSpots[0].pos}.`);
    let how;
    if (r.toPlay === 0) how = 'Locked in: every starter has played, so nothing left to change this week.';
    else if (fixGain + addGain < 0.5) how = rank === 1
      ? 'No clear upgrade on paper. The bottom team needs variance, so in close start/sit calls pick the higher-ceiling player (a deep-threat WR, a TD-dependent RB). A safe floor only locks in last place.'
      : 'Lineup is already the best available on paper. With a cushion, lower the risk: in close calls start the steadier, higher-floor player.';
    else if (rank === 1) how = newRank > 1
      ? `Making the moves below projects ${fmt(newMu)} (+${fmt(fixGain + addGain)}), enough to climb past ${newRank - 1} team${newRank - 1 === 1 ? '' : 's'}. On top of that, pick higher-ceiling players in close calls. The bottom team needs variance.`
      : `The moves below add ${fmt(fixGain + addGain)} but still project lowest. Make them, then pick higher-ceiling players in close calls. The bottom team needs variance.`;
    else how = `The moves below add ${fmt(fixGain + addGain)}${newRank > rank ? `, moving them from #${rank} to #${newRank} lowest` : `, widening the cushion to ${fmt(newMu - bottom.mu)}`}. With a cushion, lower the risk: in close calls start the steadier, higher-floor player.`;

    const rows = [
      { label: 'Chop risk', value: `${r.p < 0.005 ? '<1%' : pct(r.p)} · #${rank} lowest of ${byMuAsc.length}` },
      { label: anyPlayedThisWeek ? 'Live + projected score' : 'Projected score', value: `${fmt(r.mu)} ± ${fmt(r.sd)}` },
    ];
    if (anyPlayedThisWeek) rows.push({ label: 'Already banked', value: `${fmt(r.banked)} · ${r.toPlay} of ${starters.length} starters left` });
    rows.push(rank === 1
      ? { label: 'Gap to safety', value: above ? `${fmt(above.mu - r.mu)} behind ${teamLabel(above.roster_id)}` : '—' }
      : { label: 'Cushion over the bottom', value: `+${fmt(cushion)} over ${teamLabel(bottom.roster_id)}` });
    if (dead.length) rows.push({ label: "Starters who can't score", value: `${dead.length}`, moves: dead.map(d => `${d.player} (${d.flag}) — bench him`) });
    if (weakSpots.length) rows.push({
      label: 'Weakest spots',
      value: `${weakSpots.length} below avg`,
      moves: weakSpots.map(w => `${playerLabel(w.pid).name} (${w.pos}): ${fmt(w.proj)} proj vs ${fmt(posAvgProj.get(w.pos))} for the avg starting ${w.pos}`),
    });
    rows.push(fixes.length
      ? { label: 'Lineup fixes', value: `+${fmt(fixGain)}`, moves: fixes.map(sw => `${swapText(g.ptsOf, sw)}: +${fmt(sw.gain)}`) }
      : { label: 'Lineup fixes', value: 'none needed' });
    rows.push(adds.length
      ? {
        label: 'Waiver / free-agent adds',
        value: `+${fmt(addGain)}`,
        moves: adds.map(a => `Add ${playerLabel(a.add.pid).name} (${a.add.pos}, ${playerLabel(a.add.pid).team}, ${fmt(a.add.proj)} proj) for ${playerLabel(a.drop.pid).name} (${fmt(a.drop.proj)} proj): +${fmt(a.gain)}`),
      }
      : { label: 'Waiver / free-agent adds', value: 'no upgrade available' });
    if (fixGain + addGain >= 0.5) rows.push({ label: 'After every move', value: `${fmt(newMu)} · #${newRank} lowest` });

    return {
      info: `Why: ${whyParts.join(' ')}\n\nHow to get out: ${how}${adds.length ? ' Free-agent adds only work for players not stuck on waivers; check Sleeper for claim timing.' : ''}`,
      rows,
    };
  }

  const chopCard = document.getElementById('chop-card');
  const chopNote = document.getElementById('chop-note');
  const chopWrap = document.getElementById('chop-wrap');
  const chopDetail = document.getElementById('chop-detail');
  if (chopRiskRows.length) {
    const featured = chopRiskRows[0];
    const featuredTeam = teamByRoster.get(featured.roster_id) || {};
    const rank1 = byMuAsc[0].roster_id === featured.roster_id;
    const nextUp = byMuAsc[1];
    chopNote.textContent = `Week ${league.current_week} · highest chop risk`;
    const wasOpen = chopWrap.classList.contains('is-expanded');
    chopCard.innerHTML = `
      <div class="chop-visual">${CHOP_SVG}</div>
      <div class="chop-info">
        <div class="chop-tag">☠️ On the Chopping Block${anyPlayedThisWeek ? ' (Live)' : ' (Projected)'}</div>
        <div class="chop-team"></div>
        <div class="chop-pts">${fmt(featured.mu)} ${allLocked ? 'final' : (anyPlayedThisWeek ? 'live + projected' : 'projected')} points · ${pct(featured.p)} chop risk</div>
        <div class="chop-note"></div>
        <button type="button" class="chop-toggle" aria-controls="chop-detail" aria-expanded="${wasOpen}">Why &amp; how to escape
          <svg class="chevron-sm" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`;
    const teamCell = chopCard.querySelector('.chop-team');
    teamCell.appendChild(avatarEl(featuredTeam));
    const nameEl = document.createElement('div');
    nameEl.className = 'chop-name';
    nameEl.textContent = featuredTeam.team_name || featuredTeam.display_name || `Roster ${featured.roster_id}`;
    teamCell.appendChild(nameEl);
    chopCard.querySelector('.chop-note').textContent = rank1 && nextUp
      ? `Just ${fmt(nextUp.mu - featured.mu)} points behind ${teamLabel(nextUp.roster_id)}`
      : '';
    fillDetailPanel(chopDetail, escapePlan(featured));
    chopDetail.hidden = !wasOpen;
    const toggle = chopCard.querySelector('.chop-toggle');
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      chopDetail.hidden = expanded;
      chopWrap.classList.toggle('is-expanded', !expanded);
    });
  } else {
    chopCard.innerHTML = '';
    chopDetail.hidden = true;
  }

  const dangerTiles = chopRiskRows.slice(1, 4).map((r, i) => {
    const plan = escapePlan(r);
    const cushion = r.mu - byMuAsc[0].mu;
    return {
      eyebrow: `#${i + 1} · ${r.p < 0.005 ? '<1%' : pct(r.p)} chop risk`,
      headline: teamLabel(r.roster_id),
      detail: `${fmt(r.mu)} ${anyPlayedThisWeek ? 'live + projected' : 'projected'}${cushion > 0 ? ` · ${fmt(cushion)} above the bottom` : ''}`,
      info: plan.info,
      rows: plan.rows,
    };
  });
  renderStatCards(document.getElementById('danger-grid'), dangerTiles, 'danger');
  document.getElementById('sec-danger').hidden = !dangerTiles.length;

  // ---- League Insights: backward-looking patterns in the data — who's
  // good at this, where the edge is, and how the season is shaping up. ----
  const insightsGrid = document.getElementById('insights-grid');
  const insightTiles = [];

  // Positional Edge: which position separates good lineups from bad ones.
  // Every started player-week in completed weeks, grouped by position; the
  // spread between a 75th- and 25th-percentile start is the swing a manager
  // controls by having the better player there.
  if (completedWeeks.length) {
    const samples = new Map();
    const startLog = new Map();
    completedWeeks.forEach(({ week, matchups: wm }) => wm.forEach(m => m.starters.forEach(pid => {
      const pos = posOf(pid);
      if (!pos || !pid || pid === '0') return;
      if (!samples.has(pos)) samples.set(pos, []);
      samples.get(pos).push((m.players_points || {})[pid] || 0);
      if (!startLog.has(pos)) startLog.set(pos, []);
      startLog.get(pos).push({ pid, rid: m.roster_id, week, pts: (m.players_points || {})[pid] || 0 });
    })));
    const quantile = (sorted, q) => {
      const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
    };
    const posRows = Array.from(samples.entries()).filter(([, v]) => v.length >= 5).map(([pos, v]) => {
      const s = v.slice().sort((a, b) => a - b);
      return { pos, avg: s.reduce((a, b) => a + b, 0) / s.length, spread: quantile(s, 0.75) - quantile(s, 0.25), n: s.length };
    }).sort((a, b) => b.spread - a.spread);
    if (posRows.length) {
      const top = posRows[0];
      insightTiles.push({
        eyebrow: 'Positional Edge',
        headline: `${top.pos} is where weeks are won`,
        detail: `A 75th-percentile ${top.pos} start outscores a 25th-percentile one by ${fmt(top.spread)} points, the widest gap of any position (${weeksRange})`,
        info: 'Every player started in a completed week, grouped by position. Avg = points per start. Spread = 75th minus 25th percentile start, i.e. how much having the better player there typically swings a week. The biggest spread is where waiver adds and trades move the needle most.',
        rows: posRows.map(r => {
          const log = startLog.get(r.pos).slice().sort((a, b) => b.pts - a.pts);
          const line = (tag, e) => `${tag}: ${playerLabel(e.pid).name} ${fmt(e.pts)} (Wk ${e.week}, ${teamLabel(e.rid)})`;
          return {
            label: `${r.pos} · ${fmt(r.avg)} avg per start`,
            value: `${fmt(r.spread)} spread`,
            moves: [...log.slice(0, 3).map(e => line('Best', e)), ...log.slice(-3).reverse().map(e => line('Worst', e))],
          };
        }),
      });
    }
  }

  // Lineup Efficiency: share of the best-possible lineup's points that
  // each manager actually started, season to date.
  if (completedWeeks.length) {
    const eff = new Map();
    lineupGapsByWeek.forEach(({ rows }) => rows.forEach(r => {
      if (!aliveIds.has(r.roster_id)) return;
      const e = eff.get(r.roster_id) || { actual: 0, optimal: 0 };
      e.actual += r.actual;
      e.optimal += r.optimal;
      eff.set(r.roster_id, e);
    }));
    const effRows = Array.from(eff.entries()).filter(([, e]) => e.optimal > 0)
      .map(([rid, e]) => ({ rid, ratio: e.actual / e.optimal })).sort((a, b) => b.ratio - a.ratio);
    if (effRows.length >= 2) {
      const best = effRows[0], worst = effRows[effRows.length - 1];
      insightTiles.push({
        eyebrow: 'Lineup Efficiency',
        headline: teamLabel(best.rid),
        detail: `Started ${(best.ratio * 100).toFixed(1)}% of their best possible lineup's points (${weeksRange}); ${teamLabel(worst.rid)} is last at ${(worst.ratio * 100).toFixed(1)}%`,
        info: "Points actually scored divided by what the best possible lineup from the same roster would have scored, season to date. 100% means every start/sit call was right. It's the clean measure of lineup-setting skill, separate from how good the roster is.",
        rows: effRows.map(r => ({
          label: teamLabel(r.rid),
          value: `${(r.ratio * 100).toFixed(1)}%`,
          moves: lineupGapsByWeek.map(({ week, rows }) => {
            const w = rows.find(x => x.roster_id === r.rid);
            return w && w.optimal > 0 ? `Week ${week}: ${fmt(w.actual)} of ${fmt(w.optimal)} possible (${(w.actual / w.optimal * 100).toFixed(1)}%)` : null;
          }).filter(Boolean),
        })),
      });
    }
  }

  // Beats the Projections: lineup actual minus lineup projected, summed
  // over completed weeks — are a manager's starters outrunning Sleeper's
  // numbers or lagging them?
  if (completedWeeks.length) {
    const edge = new Map();
    completedWeeks.forEach(({ week, matchups: wm, proj: wkProj }) => wm.forEach(m => {
      if (!aliveIds.has(m.roster_id)) return;
      const projTotal = m.starters.reduce((s, pid) => s + projOf(wkProj, pid), 0);
      if (projTotal <= 0) return;
      const e = edge.get(m.roster_id) || { sum: 0, weeks: 0, log: [] };
      e.sum += m.points - projTotal;
      e.weeks += 1;
      const deltas = m.starters.filter(pid => pid && pid !== '0')
        .map(pid => ({ pid, d: ((m.players_points || {})[pid] || 0) - projOf(wkProj, pid) })).sort((a, b) => b.d - a.d);
      const hi = deltas[0], lo = deltas[deltas.length - 1];
      e.log.push(`Week ${week}: ${fmt(m.points)} vs ${fmt(projTotal)} proj (${signed(m.points - projTotal)}). Best: ${playerLabel(hi.pid).name} ${signed(hi.d)}; worst: ${playerLabel(lo.pid).name} ${signed(lo.d)}`);
      edge.set(m.roster_id, e);
    }));
    const edgeRows = Array.from(edge.entries()).map(([rid, e]) => ({ rid, ...e })).sort((a, b) => b.sum - a.sum);
    if (edgeRows.length >= 2) {
      const best = edgeRows[0], worst = edgeRows[edgeRows.length - 1];
      insightTiles.push({
        eyebrow: 'Beats the Projections',
        headline: teamLabel(best.rid),
        detail: `Lineups have outscored Sleeper's projections by ${fmt(best.sum)} points (${fmt(best.sum / best.weeks)}/week); ${teamLabel(worst.rid)} trails by ${fmt(Math.abs(worst.sum))}${smallSample ? ' (small sample)' : ''}`,
        info: `Actual lineup points minus Sleeper's pre-game projection for the same starters, summed over ${weeksRange}. Consistently positive means picking starters the market underrates. Over a few weeks it's mostly luck; if it holds up past week 6 or so, it's probably skill.`,
        rows: edgeRows.map(r => ({ label: teamLabel(r.rid), value: `${signed(r.sum)} · ${signed(r.sum / r.weeks)}/wk`, moves: r.log })),
      });
    }
  }

  // Consistency: week-to-week volatility (standard deviation) of each
  // team's score. Needs 3+ completed weeks to mean anything.
  if (completedWeeks.length >= 3) {
    const scores = new Map();
    completedWeeks.forEach(({ week, matchups: wm }) => wm.forEach(m => {
      if (!aliveIds.has(m.roster_id)) return;
      if (!scores.has(m.roster_id)) scores.set(m.roster_id, []);
      scores.get(m.roster_id).push({ week, pts: m.points });
    }));
    const volRows = Array.from(scores.entries()).filter(([, wv]) => wv.length >= 3).map(([rid, wv]) => {
      const v = wv.map(w => w.pts);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
      return { rid, mean, sd, weekly: wv };
    }).sort((a, b) => a.sd - b.sd);
    if (volRows.length >= 2) {
      const steady = volRows[0], wild = volRows[volRows.length - 1];
      insightTiles.push({
        eyebrow: 'Consistency',
        headline: `Steadiest: ${teamLabel(steady.rid)}`,
        detail: `${fmt(steady.mean)} avg, ± ${fmt(steady.sd)} week to week. Wildest ride: ${teamLabel(wild.rid)} at ± ${fmt(wild.sd)}`,
        info: `Average weekly score ± standard deviation over ${weeksRange}. In a chop league volatility is the enemy: one bad week ends your season, so a team's floor (roughly avg minus 1 SD) matters more than its ceiling. Sorted steadiest first.`,
        rows: volRows.map(r => ({ label: teamLabel(r.rid), value: `${fmt(r.mean)} ± ${fmt(r.sd)}`, moves: r.weekly.map(w => `Week ${w.week}: ${fmt(w.pts)}`) })),
      });
    }
  }

  // One-Man Team: a starter carrying more than half their team's points.
  // Before live scoring starts, fall back to projected shares — reverts to
  // the real live version automatically once any scoring comes in.
  {
    // Same actual-where-played, projected-otherwise blend as Points Left
    // on the Table — otherwise the first Thursday-night scorer on a team
    // reads as "100% of their points".
    let bestRid = null, bestPid = null, bestShare = 0, bestPts = 0, bestTotal = 0;
    const isProjected = !anyPlayedThisWeek;
    const allPlayed = matchups.every(m => m.starters.every(pid => !pid || pid === '0' || hasPlayed(state.stats, pid)));
    matchups.filter(m => aliveIds.has(m.roster_id)).forEach(m => {
      const ptsOf = currentPtsOf(m);
      const total = m.starters.reduce((s, pid) => s + ptsOf(pid), 0);
      if (total <= 0) return;
      m.starters.forEach(pid => {
        const share = ptsOf(pid) / total;
        if (share > bestShare) { bestShare = share; bestRid = m.roster_id; bestPid = pid; bestPts = ptsOf(pid); bestTotal = total; }
      });
    });
    if (bestRid != null && bestShare >= 0.3) {
      const info = playerLabel(bestPid);
      insightTiles.push({
        eyebrow: isProjected ? 'One-Man Team (Projected)' : 'One-Man Team',
        headline: teamLabel(bestRid),
        detail: `${info.name} ${isProjected ? 'is projected for' : (allPlayed ? 'scored' : 'is on pace for')} ${Math.round(bestShare * 100)}% of their ${fmt(bestTotal)} ${isProjected ? 'projected ' : (allPlayed ? '' : 'live + projected ')}points this week`,
        info: `The single starter responsible for the biggest share of his team's points this week. An even split across ${lineupSlots.length} starters would be about ${Math.round(100 / Math.max(1, lineupSlots.length))}% each, so anything well above that is a concentrated bet on one player.`,
        rows: (() => {
          const m = matchupByRoster.get(bestRid);
          const ptsOf = currentPtsOf(m);
          return m.starters.filter(pid => pid && pid !== '0').sort((a, b) => ptsOf(b) - ptsOf(a))
            .map(pid => ({ label: `${playerLabel(pid).name} (${posOf(pid) || '—'})`, value: `${currentPtsLabel(ptsOf, pid)} · ${Math.round(ptsOf(pid) / bestTotal * 100)}%` }));
        })(),
      });
    }
  }

  // Weekly rankings of completed weeks only (teams alive that week), for
  // Squeaked By / Living Dangerously / Top Dog — a half-played or
  // projected current week isn't a result yet.
  const weeklyRankings = completedWeeks.map(({ week, matchups: wm }) => ({
    week,
    ranked: wm.slice().sort((a, b) => b.points - a.points),
  })).filter(r => r.ranked.length >= 2);

  // Squeaked By: the tightest margin, in any week, between the team that
  // got chopped and the team just above them.
  if (weeklyRankings.length) {
    const weeklyGaps = weeklyRankings.map(({ week, ranked }) => {
      const n = ranked.length;
      return { week, gap: ranked[n - 2].points - ranked[n - 1].points, bottom: ranked[n - 1], safe: ranked[n - 2] };
    }).sort((a, b) => a.gap - b.gap);
    const closest = weeklyGaps[0];
    insightTiles.push({
      eyebrow: 'Squeaked By',
      headline: teamLabel(closest.safe.roster_id),
      detail: `Stayed off the bottom in Week ${closest.week} by just ${fmt(closest.gap)} point${closest.gap === 1 ? '' : 's'} over ${teamLabel(closest.bottom.roster_id)}`,
      info: 'Margin between the lowest score (chopped) and the second-lowest (survived) each completed week, closest call first.',
      rows: weeklyGaps.slice(0, 8).map(g => {
        const gapOf = rid => ((lineupGapsByWeek.find(x => x.week === g.week) || { rows: [] }).rows.find(x => x.roster_id === rid) || { gap: 0 }).gap;
        return {
          label: `Week ${g.week}: ${teamLabel(g.safe.roster_id)} over ${teamLabel(g.bottom.roster_id)}`,
          value: fmt(g.gap),
          moves: [
            `${teamLabel(g.safe.roster_id)} (survived): ${fmt(g.safe.points)}`,
            `${teamLabel(g.bottom.roster_id)} (lowest): ${fmt(g.bottom.points)}${gapOf(g.bottom.roster_id) > g.gap ? `, and left ${fmt(gapOf(g.bottom.roster_id))} on their bench, more than enough to survive` : ''}`,
          ],
        };
      }),
    });
  }

  // Living Dangerously: teams that keep finishing 2nd- or 3rd-lowest —
  // surviving, but not by much.
  {
    const dangerCounts = new Map();
    const dangerLog = new Map();
    weeklyRankings.filter(r => r.ranked.length >= 3).forEach(({ week, ranked }) => {
      const n = ranked.length;
      [ranked[n - 2], ranked[n - 3]].forEach((m, k) => {
        if (!aliveIds.has(m.roster_id)) return;
        dangerCounts.set(m.roster_id, (dangerCounts.get(m.roster_id) || 0) + 1);
        if (!dangerLog.has(m.roster_id)) dangerLog.set(m.roster_id, []);
        dangerLog.get(m.roster_id).push(`Week ${week}: ${k === 0 ? '2nd' : '3rd'}-lowest of ${n}, ${fmt(m.points)} pts, ${fmt(m.points - ranked[n - 1].points)} above ${teamLabel(ranked[n - 1].roster_id)}`);
      });
    });
    const dangerSorted = Array.from(dangerCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (dangerSorted.length && dangerSorted[0][1] >= 2) {
      insightTiles.push({
        eyebrow: 'Living Dangerously',
        headline: teamLabel(dangerSorted[0][0]),
        detail: `${dangerSorted[0][1]} weeks finishing 2nd- or 3rd-lowest without getting chopped — living on borrowed time`,
        info: 'Completed weeks finishing 2nd- or 3rd-lowest: one or two spots above the team that got chopped.',
        rows: dangerSorted.map(([rid, c]) => ({ label: teamLabel(rid), value: `${c} week${c === 1 ? '' : 's'}`, moves: dangerLog.get(rid) })),
      });
    }
  }

  // Top Dog: most weeks with the league's single highest score.
  if (weeklyRankings.length) {
    const winCounts = new Map();
    const winLog = new Map();
    weeklyRankings.forEach(({ week, ranked }) => {
      const rid = ranked[0].roster_id;
      winCounts.set(rid, (winCounts.get(rid) || 0) + 1);
      if (!winLog.has(rid)) winLog.set(rid, []);
      winLog.get(rid).push(`Week ${week}: ${fmt(ranked[0].points)} pts, ${fmt(ranked[0].points - ranked[1].points)} ahead of ${teamLabel(ranked[1].roster_id)}`);
    });
    const winSorted = Array.from(winCounts.entries()).sort((a, b) => b[1] - a[1]);
    insightTiles.push({
      eyebrow: 'Top Dog',
      headline: teamLabel(winSorted[0][0]),
      detail: `${winSorted[0][1]} week${winSorted[0][1] === 1 ? '' : 's'} with the league's highest score (${weeksRange})`,
      rows: winSorted.map(([rid, c]) => ({ label: teamLabel(rid), value: `${c} week${c === 1 ? '' : 's'}`, moves: winLog.get(rid) })),
    });
  }

  // Set It and Forget It: fewest completed roster moves all season, while
  // the league as a whole has clearly been active. Uses real per-week
  // transaction counts rather than Sleeper's settings.total_moves, which
  // this league never populates (always 0). Failed waiver bids don't count.
  {
    const txnSeasonCountByRoster = new Map();
    const txnLog = new Map();
    allWeeksTxns.forEach((wkTxns, i) => wkTxns.forEach(tx => {
      if (tx.status && tx.status !== 'complete') return;
      (tx.roster_ids || []).forEach(rid => {
        txnSeasonCountByRoster.set(rid, (txnSeasonCountByRoster.get(rid) || 0) + 1);
        if (!txnLog.has(rid)) txnLog.set(rid, []);
        txnLog.get(rid).push(`Week ${allWeekNumbers[i]}: ${describeTransactionForRoster(tx, rid)}`);
      });
    }));
    const moveCounts = aliveTeams.map(t => ({ rid: t.roster_id, count: txnSeasonCountByRoster.get(t.roster_id) || 0 }))
      .sort((a, b) => a.count - b.count);
    if (moveCounts.length && moveCounts[moveCounts.length - 1].count > 0) {
      const quietest = moveCounts[0];
      insightTiles.push({
        eyebrow: 'Set It and Forget It',
        headline: teamLabel(quietest.rid),
        detail: `Just ${quietest.count} roster move${quietest.count === 1 ? '' : 's'} all season — autopilot engaged`,
        info: 'Completed adds, drops, waiver claims and trades this season. Failed waiver bids are excluded.',
        rows: moveCounts.map(m => ({ label: teamLabel(m.rid), value: `${m.count} move${m.count === 1 ? '' : 's'}`, moves: txnLog.get(m.rid) || ['No moves yet'] })),
      });
    }
  }

  // Draft Grades: each drafted player's season points vs. his draft slot.
  // "Value" is pick number minus season scoring rank among all drafted
  // players: big positive = steal (drafted late, producing early), big
  // negative = bust. Before any actual stats exist, falls back to this
  // week's projections.
  if (draftPicks && draftPicks.length) {
    const seasonPtsFor = (pid) => {
      let total = 0;
      allWeeksStatsProj.forEach(({ stats: wkStats, proj: wkProj }, i) => {
        const isCurrent = i === allWeeksStatsProj.length - 1;
        const source = (isCurrent && !isLiveThisWeek) ? wkProj : wkStats;
        const s = source[pid];
        if (s && s.pts_ppr != null) total += s.pts_ppr;
      });
      return total;
    };
    const draftRows = draftPicks
      .filter(p => p.player_id)
      .map(p => ({ pid: p.player_id, pickNo: p.pick_no, round: p.round, rosterId: p.roster_id, pts: seasonPtsFor(p.player_id) }));
    if (draftRows.length) {
      const byPts = draftRows.slice().sort((a, b) => b.pts - a.pts);
      const finishRank = new Map(byPts.map((r, i) => [r.pid, i + 1]));
      const valued = draftRows.map(r => ({ ...r, finishRank: finishRank.get(r.pid), valueGap: r.pickNo - finishRank.get(r.pid) }));
      const steal = valued.slice().sort((a, b) => b.valueGap - a.valueGap)[0];
      const bust = valued.slice().sort((a, b) => a.valueGap - b.valueGap)[0];
      const rowFor = r => {
        const p = state.players[r.pid] || {};
        const weekly = allWeekNumbers.map((wk, i) => {
          const st = allWeeksStatsProj[i].stats[r.pid];
          if (i === allWeekNumbers.length - 1 && !hasPlayed(state.stats, r.pid)) return null;
          return `Wk ${wk}: ${st && st.pts_ppr != null ? fmt(st.pts_ppr) : (st && st.gp ? '0.00' : 'did not play')}`;
        }).filter(Boolean);
        const status = p.injury_status ? `${p.injury_status}${p.injury_body_part ? ` (${p.injury_body_part})` : ''}` : (p.team ? 'Healthy' : 'No NFL team');
        return {
          label: `${playerLabel(r.pid).name} — Pick ${r.pickNo} (Rd ${r.round}), ${teamLabel(r.rosterId)}`,
          value: `${r.valueGap > 0 ? '+' : ''}${r.valueGap} (${fmt(r.pts)} pts)`,
          moves: [
            `${p.position || '—'}, ${p.team || 'FA'} · drafted #${r.pickNo}, scoring #${r.finishRank} among drafted players`,
            `Status: ${status}`,
            ...weekly,
          ],
        };
      };
      insightTiles.push({
        eyebrow: (isLiveThisWeek || historyWeeks.length) ? 'Draft Grades' : 'Draft Grades (Projected)',
        headline: `Steal: ${playerLabel(steal.pid).name}`,
        detail: `Picked ${steal.pickNo} overall (Round ${steal.round}) by ${teamLabel(steal.rosterId)}, now the #${steal.finishRank} scorer among all drafted players with ${fmt(steal.pts)} points. Biggest bust: ${playerLabel(bust.pid).name}, picked ${bust.pickNo} (Round ${bust.round}) by ${teamLabel(bust.rosterId)}, only #${bust.finishRank} in scoring so far.${smallSample ? ' Small sample — early-season injuries and byes swing this a lot.' : ''}`,
        info: 'Value = draft pick number minus season scoring rank among all drafted players. +50 means a player drafted 50 spots later than where he\'s producing (a steal); a big negative means an early pick producing like a late one. Top 4 steals, then top 4 busts.',
        rows: [
          ...valued.slice().sort((a, b) => b.valueGap - a.valueGap).slice(0, 4).map(rowFor),
          ...valued.slice().sort((a, b) => a.valueGap - b.valueGap).slice(0, 4).map(rowFor),
        ],
      });
    }
  }

  // Rookie Reliance: teams leaning hardest on first-year players in
  // their lineup this week.
  {
    const rookieCounts = aliveTeams.map(t => ({
      rid: t.roster_id,
      pids: t.starters.filter(pid => state.players[pid] && state.players[pid].years_exp === 0),
    })).map(r => ({ ...r, count: r.pids.length })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);
    if (rookieCounts.length && rookieCounts[0].count >= 2) {
      insightTiles.push({
        eyebrow: 'Rookie Reliance',
        headline: teamLabel(rookieCounts[0].rid),
        detail: `Starting ${rookieCounts[0].count} rookies this week, the most in the league`,
        info: "First-year players in this week's starting lineup. Rookie roles tend to grow through the season, so this is usually a bet that gets better with time.",
        rows: rookieCounts.map(r => ({ label: teamLabel(r.rid), value: `${r.count} rookie${r.count === 1 ? '' : 's'}`, moves: r.pids.map(pid => `${playerLabel(pid).name} (${posOf(pid)}, ${playerLabel(pid).team || 'FA'}): ${fmt(projOf(state.projections, pid))} proj this week`) })),
      });
    }
  }

  // Grizzled Veterans: average roster age extremes.
  {
    const ageByRoster = aliveTeams.map(t => {
      const ages = (t.players || []).map(pid => state.players[pid] && state.players[pid].age).filter(a => a != null);
      const avg = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
      const byAgeDesc = (t.players || []).filter(pid => state.players[pid] && state.players[pid].age != null)
        .sort((a, b) => state.players[b].age - state.players[a].age);
      return { roster_id: t.roster_id, avg, players: byAgeDesc };
    }).filter(r => r.avg != null);
    if (ageByRoster.length) {
      const byAge = ageByRoster.slice().sort((a, b) => b.avg - a.avg);
      const oldest = byAge[0], youngest = byAge[byAge.length - 1];
      insightTiles.push({
        eyebrow: 'Grizzled Veterans',
        headline: teamLabel(oldest.roster_id),
        detail: `Oldest roster in the league at ${oldest.avg.toFixed(1)} years average — ${teamLabel(youngest.roster_id)} is the youngest at ${youngest.avg.toFixed(1)}`,
        info: 'Average age across the whole roster. RBs typically decline around 27–28 and WRs around 30, so an old roster is a bet on production now over later.',
        rows: byAge.map(r => ({ label: teamLabel(r.roster_id), value: `${r.avg.toFixed(1)} yrs`, moves: r.players.map(pid => `${playerLabel(pid).name} (${posOf(pid)}): ${state.players[pid].age}`) })),
      });
    }
  }

  // Alma Mater: a roster stacked with players from the same college —
  // pure trivia, only surfaced when it's actually notable (3+ players).
  {
    const collegeStacks = aliveTeams.map(t => {
      const counts = new Map();
      (t.players || []).forEach(pid => {
        const college = state.players[pid] && state.players[pid].college;
        if (college) counts.set(college, (counts.get(college) || 0) + 1);
      });
      let topCollege = null, topCount = 0;
      counts.forEach((v, k) => { if (v > topCount) { topCount = v; topCollege = k; } });
      const pids = (t.players || []).filter(pid => state.players[pid] && state.players[pid].college === topCollege);
      return { roster_id: t.roster_id, topCollege, topCount, pids };
    }).filter(s => s.topCount >= 3).sort((a, b) => b.topCount - a.topCount);
    if (collegeStacks.length) {
      insightTiles.push({
        eyebrow: 'Alma Mater',
        headline: `${collegeStacks[0].topCount} players from ${collegeStacks[0].topCollege}`,
        detail: `${teamLabel(collegeStacks[0].roster_id)} is running a mini ${collegeStacks[0].topCollege} reunion`,
        rows: collegeStacks.map(s => ({ label: teamLabel(s.roster_id), value: `${s.topCount} from ${s.topCollege}`, moves: s.pids.map(pid => `${playerLabel(pid).name} (${posOf(pid)}, ${playerLabel(pid).team || 'FA'})`) })),
      });
    }
  }

  renderStatCards(insightsGrid, insightTiles, 'insight');

  // ---- Boom & bust: rostered players whose actual points this week are
  // furthest above/below Sleeper's pre-game projection ----
  function renderBoomBustList(container, rows, kind, mode, emptyMessage) {
    container.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'stat-detail-empty';
      empty.textContent = emptyMessage || 'No projections available yet.';
      container.appendChild(empty);
      return;
    }
    rows.forEach(r => {
      const info = playerLabel(r.pid);
      const row = document.createElement('div');
      row.className = 'boombust-row';
      const badge = document.createElement('div');
      badge.className = 'pos-badge';
      const posVar = POS_VAR[info.pos] || null;
      badge.style.background = posVar ? `var(${posVar})` : 'var(--ink-faint)';
      badge.textContent = info.pos || '—';
      const mid = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'bb-name';
      nameEl.textContent = info.name + (info.team ? ` · ${info.team}` : '');
      const metaEl = document.createElement('div');
      metaEl.className = 'bb-meta';
      const ownerPart = r.owners.length ? ` · ${r.owners.join(', ')}` : '';
      const deltaEl = document.createElement('div');
      if (mode === 'proj') {
        metaEl.textContent = `${fmt(r.projPts)} projected${ownerPart}`;
        deltaEl.className = 'bb-delta';
        deltaEl.textContent = fmt(r.projPts);
      } else {
        metaEl.textContent = `${fmt(r.projPts)} proj → ${fmt(r.actualPts)} actual${ownerPart}`;
        deltaEl.className = `bb-delta ${kind}`;
        deltaEl.textContent = `${r.delta > 0 ? '+' : ''}${fmt(r.delta)}`;
      }
      mid.appendChild(nameEl);
      mid.appendChild(metaEl);
      row.appendChild(badge);
      row.appendChild(mid);
      row.appendChild(deltaEl);
      container.appendChild(row);
    });
  }

  const boombustNote = document.getElementById('boombust-note');
  const boomLabel = document.getElementById('boom-label');
  const bustLabel = document.getElementById('bust-label');
  if (!boomBustRows.length && projOnlyRows.length) {
    boombustNote.textContent = "No live stats yet — showing Sleeper's pre-game projections";
    boomLabel.textContent = '🚀 Highest Projected';
    bustLabel.textContent = '📉 Lowest Projected';
    renderBoomBustList(document.getElementById('boom-list'), projOnlyRows.slice(0, BOOM_BUST_COUNT), 'boom', 'proj');
    renderBoomBustList(document.getElementById('bust-list'), projOnlyRows.slice(-BOOM_BUST_COUNT).reverse(), 'bust', 'proj');
  } else {
    boombustNote.textContent = "Live points vs. Sleeper's pre-game projection, rostered players only";
    boomLabel.textContent = '🚀 Overperforming';
    bustLabel.textContent = '📉 Underperforming';
    // Only players actually beating (or missing) their projection: with few
    // games played, the "top 6" would otherwise pad out with players on the
    // wrong side of zero.
    const boomRows = boomBustRows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, BOOM_BUST_COUNT);
    const bustRows = worstBustRows.filter(r => r.delta < 0).slice(0, BOOM_BUST_COUNT);
    renderBoomBustList(document.getElementById('boom-list'), boomRows, 'boom', undefined, 'Nobody is beating their projection yet.');
    renderBoomBustList(document.getElementById('bust-list'), bustRows, 'bust', undefined, 'Nobody is under their projection yet.');
  }

  // ---- Bench points ----
  const benchList = document.getElementById('bench-list');
  benchList.innerHTML = '';
  // Same optimal-lineup gap as the Trash Talk tile: live points for
  // players who've played, projections for everyone else.
  document.getElementById('bench-note').textContent = anyPlayedThisWeek
    ? `Week ${league.current_week} · best possible lineup minus the one set (live + projected for games not yet played)`
    : `Week ${league.current_week} · best projected lineup minus the one currently set`;
  const benchData = currentGaps.map(g => ({ roster_id: g.roster_id, bench: g.gap }));
  const maxBench = Math.max(1, ...benchData.map(b => b.bench));
  benchData.forEach(b => {
    const t = teamByRoster.get(b.roster_id);
    const row = document.createElement('div');
    row.className = 'bench-row';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = t ? (t.team_name || t.display_name) : `Roster ${b.roster_id}`;
    const track = document.createElement('div');
    track.className = 'bench-track';
    const fill = document.createElement('div');
    fill.className = 'bench-fill';
    fill.style.width = Math.max(1, (b.bench / maxBench) * 100) + '%';
    track.appendChild(fill);
    const val = document.createElement('div');
    val.className = 'bench-val';
    val.textContent = fmt(b.bench);
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(val);
    benchList.appendChild(row);
  });

  // ---- FAAB remaining: each team's waiver budget left, out of the
  // league's full season budget (not the highest remaining team — a $0
  // team should read as fully empty, not nearly full). Chopped teams are
  // left out: they can't bid anymore, so their leftover budget is moot. ----
  const faabBudget = league.waiver_budget;
  document.getElementById('faab-note').textContent = `$${faabBudget} budget per team to start the season`;
  const faabList = document.getElementById('faab-list');
  faabList.innerHTML = '';
  aliveTeams
    .map(t => ({ roster_id: t.roster_id, remaining: Math.max(0, faabBudget - (t.waiver_budget_used || 0)) }))
    .sort((a, b) => a.remaining - b.remaining)
    .forEach(f => {
      const row = document.createElement('div');
      row.className = 'faab-row';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = teamLabel(f.roster_id);
      const track = document.createElement('div');
      track.className = 'faab-track';
      const fill = document.createElement('div');
      fill.className = 'faab-fill';
      fill.style.width = Math.max(1, (f.remaining / faabBudget) * 100) + '%';
      track.appendChild(fill);
      const val = document.createElement('div');
      val.className = 'faab-val';
      val.textContent = `$${f.remaining}`;
      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(val);
      faabList.appendChild(row);
    });

  // ---- Roster picker ----
  const picker = document.getElementById('team-picker');
  const prevValue = picker.value;
  picker.innerHTML = '';
  teams.slice().sort((a, b) => (a.team_name || a.display_name).localeCompare(b.team_name || b.display_name))
    .forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.roster_id;
      opt.textContent = t.team_name || t.display_name;
      picker.appendChild(opt);
    });
  if (prevValue && teams.some(t => String(t.roster_id) === prevValue)) picker.value = prevValue;

  function renderRoster() {
    const rid = Number(picker.value);
    const t = teamByRoster.get(rid);
    const m = matchupByRoster.get(rid);
    const startersEl = document.getElementById('roster-starters');
    const benchEl = document.getElementById('roster-bench');
    startersEl.innerHTML = '';
    benchEl.innerHTML = '';
    if (!t) return;
    const starterSet = new Set(t.starters);
    function rowFor(pid, pts) {
      const info = playerLabel(pid);
      const row = document.createElement('div');
      row.className = 'player-row';
      const badge = document.createElement('div');
      badge.className = 'pos-badge';
      const posVar = POS_VAR[info.pos] || null;
      badge.style.background = posVar ? `var(${posVar})` : 'var(--ink-faint)';
      badge.textContent = info.pos || '—';
      const nameWrap = document.createElement('div');
      nameWrap.innerHTML = `<span class="player-name">${esc(info.name)}</span>${info.team ? `<span class="player-team">${esc(info.team)}</span>` : ''}`;
      const ptsEl = document.createElement('div');
      ptsEl.className = 'player-pts';
      ptsEl.textContent = fmt(pts);
      row.appendChild(badge);
      row.appendChild(nameWrap);
      row.appendChild(ptsEl);
      return row;
    }
    t.starters.forEach(pid => startersEl.appendChild(rowFor(pid, (m && m.players_points && m.players_points[pid]) || 0)));
    t.players.filter(pid => !starterSet.has(pid)).forEach(pid => benchEl.appendChild(rowFor(pid, (m && m.players_points && m.players_points[pid]) || 0)));
  }
  picker.onchange = renderRoster;
  renderRoster();
}
