// Sleeper API fetching, localStorage caching, and shaping raw responses into `state`.
// Plain (non-module) scripts sharing one global scope, loaded in order by index.html.

// ---------------------------------------------------------------
// Data fetching (direct client-side calls to Sleeper's public API)
// ---------------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

// Read-through localStorage cache around fetchJSON. With maxAgeMs the
// entry expires; without it the entry is kept forever (for data that's
// final once fetched, like a past week's matchups). Storage errors (private
// mode, quota) are swallowed so the page still works uncached.
async function cachedFetchJSON(cacheKey, url, maxAgeMs) {
  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && cached.data && (maxAgeMs == null || Date.now() - cached.ts < maxAgeMs)) return cached.data;
    }
  } catch (e) { /* ignore cache errors */ }
  const data = await fetchJSON(url);
  try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* quota etc, ignore */ }
  return data;
}

async function loadPlayers() {
  return cachedFetchJSON(PLAYERS_CACHE_KEY, `${API}/players/nfl`, PLAYERS_MAX_AGE_MS);
}

// Sleeper's per-player pre-game projection for the week, keyed by player_id
// (undocumented but public/CORS-open endpoint, same host). Cached for an
// hour since projections are locked pre-game and don't move like actual
// stats do during games.
async function loadProjections(season, week) {
  return cachedFetchJSON(`${PROJECTIONS_CACHE_PREFIX}_${season}_${week}`, `${API}/projections/nfl/regular/${season}/${week}`, PROJECTIONS_MAX_AGE_MS);
}

function scoringTypeFrom(league) {
  const rec = league.scoring_settings ? league.scoring_settings.rec : 0;
  if (rec >= 1) return 'PPR';
  if (rec >= 0.5) return 'Half PPR';
  return 'Standard';
}

function buildTeams(users, rosters, draftOrder) {
  const userById = new Map(users.map(u => [u.user_id, u]));
  return rosters.map(r => {
    const u = userById.get(r.owner_id) || {};
    const s = r.settings || {};
    return {
      roster_id: r.roster_id,
      owner_id: r.owner_id,
      display_name: u.display_name || `Roster ${r.roster_id}`,
      team_name: (u.metadata && u.metadata.team_name) || null,
      avatar: u.avatar || null,
      wins: s.wins || 0,
      losses: s.losses || 0,
      ties: s.ties || 0,
      eliminated: !!s.eliminated,
      fpts: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
      waiver_position: s.waiver_position,
      waiver_budget_used: s.waiver_budget_used,
      total_moves: s.total_moves,
      players: r.players || [],
      starters: r.starters || [],
      draft_position: draftOrder ? (draftOrder[r.owner_id] ?? null) : null,
    };
  });
}

function buildMatchups(raw) {
  return (raw || []).map(m => ({
    matchup_id: m.matchup_id,
    roster_id: m.roster_id,
    points: m.points || 0,
    starters: m.starters || [],
    players: m.players || [],
    starters_points: m.starters_points || [],
    players_points: m.players_points || {},
  }));
}

// Past weeks' matchups are final and never change, so cache them
// indefinitely (unlike the current week's, which is polled fresh).
async function loadWeekMatchupsCached(season, week) {
  return cachedFetchJSON(`${CHOP_HISTORY_CACHE_PREFIX}_${season}_${week}`, `${API}/league/${LEAGUE_ID}/matchups/${week}`);
}

// Sleeper only exposes a final settings.eliminated flag per roster, not
// which week it happened in — so replay the league's own chop rule (lowest
// score among teams still alive is out each week) over the completed weeks
// to recover it for the Graveyard section.
async function computeChopHistory(teams, season, currentWeek) {
  const eliminatedIds = new Set(teams.filter(t => t.eliminated).map(t => t.roster_id));
  const history = {};
  if (!eliminatedIds.size || currentWeek <= 1) return history;
  const weeks = [];
  for (let w = 1; w < currentWeek; w++) weeks.push(w);
  const weekMatchups = await Promise.all(weeks.map(w => loadWeekMatchupsCached(season, w).catch(() => [])));
  const active = new Set(teams.map(t => t.roster_id));
  weeks.forEach((w, i) => {
    if (!active.size) return;
    const rows = (weekMatchups[i] || []).filter(m => active.has(m.roster_id));
    if (!rows.length) return;
    const minPts = Math.min(...rows.map(m => m.points || 0));
    const chopped = rows.find(m => (m.points || 0) === minPts && eliminatedIds.has(m.roster_id));
    if (chopped) {
      history[chopped.roster_id] = { week: w, points: chopped.points || 0 };
      active.delete(chopped.roster_id);
    }
  });
  return history;
}

// Same reasoning as loadWeekMatchupsCached: a past week's transactions,
// actual stats, and projections are all final and never change once the
// next week starts, so cache them indefinitely too.
async function loadWeekTxnsCached(season, week) {
  return cachedFetchJSON(`${TXNS_HISTORY_CACHE_PREFIX}_${season}_${week}`, `${API}/league/${LEAGUE_ID}/transactions/${week}`);
}

async function loadWeekStatsCached(season, week) {
  return cachedFetchJSON(`${STATS_HISTORY_CACHE_PREFIX}_${season}_${week}`, `${API}/stats/nfl/regular/${season}/${week}`);
}

async function loadWeekProjectionsFinalCached(season, week) {
  return cachedFetchJSON(`${PROJ_HISTORY_CACHE_PREFIX}_${season}_${week}`, `${API}/projections/nfl/regular/${season}/${week}`);
}

// Season-long trends (Trash Talk Stats / League Insights) need every
// completed week's matchups/transactions/stats/projections, not just the
// current week's. The current week's own copies of these are already being
// fetched fresh by loadLiveState, so this only covers weeks 1..currentWeek-1
// and leans entirely on the indefinite per-week caches above/in
// loadWeekMatchupsCached — after a week's data has been fetched once, every
// later page load (and 30s poll) just reads it back from localStorage.
async function loadSeasonHistory(season, currentWeek) {
  const weeks = [];
  for (let w = 1; w < currentWeek; w++) weeks.push(w);
  const [matchupsByWeek, txnsByWeek, statsByWeek, projByWeek] = await Promise.all([
    Promise.all(weeks.map(w => loadWeekMatchupsCached(season, w).then(buildMatchups).catch(() => []))),
    Promise.all(weeks.map(w => loadWeekTxnsCached(season, w).catch(() => []))),
    Promise.all(weeks.map(w => loadWeekStatsCached(season, w).catch(() => ({})))),
    Promise.all(weeks.map(w => loadWeekProjectionsFinalCached(season, w).catch(() => ({})))),
  ]);
  const byWeek = (arr) => Object.fromEntries(weeks.map((w, i) => [w, arr[i]]));
  return {
    weeks,
    matchupsByWeek: byWeek(matchupsByWeek),
    txnsByWeek: byWeek(txnsByWeek),
    statsByWeek: byWeek(statsByWeek),
    projByWeek: byWeek(projByWeek),
  };
}

// Every pick from the draft, with round/pick_no/player/roster — fixed
// once the draft ends, so cache it indefinitely like the other historical
// data above. Powers the Draft Grades insight (value vs. draft slot).
async function loadDraftPicksCached(draftId) {
  if (!draftId) return [];
  return cachedFetchJSON(`${DRAFT_PICKS_CACHE_PREFIX}_${draftId}`, `${API}/draft/${draftId}/picks`);
}

async function loadLiveState() {
  const [nflState, league, users, rosters, drafts] = await Promise.all([
    fetchJSON(`${API}/state/nfl`),
    fetchJSON(`${API}/league/${LEAGUE_ID}`),
    fetchJSON(`${API}/league/${LEAGUE_ID}/users`),
    fetchJSON(`${API}/league/${LEAGUE_ID}/rosters`),
    fetchJSON(`${API}/league/${LEAGUE_ID}/drafts`).catch(() => []),
  ]);
  const week = nflState.week || league.settings.leg || 1;
  const [matchupsRaw, txns, statsRaw, projectionsRaw, players] = await Promise.all([
    fetchJSON(`${API}/league/${LEAGUE_ID}/matchups/${week}`),
    fetchJSON(`${API}/league/${LEAGUE_ID}/transactions/${week}`),
    fetchJSON(`${API}/stats/nfl/regular/${league.season}/${week}`).catch(() => ({})),
    loadProjections(league.season, week).catch(() => ({})),
    loadPlayers(),
  ]);
  const draftOrder = drafts && drafts[0] ? drafts[0].draft_order : null;
  const teamsBuilt = buildTeams(users, rosters, draftOrder);
  const chopHistory = await computeChopHistory(teamsBuilt, league.season, week);
  const seasonHistory = await loadSeasonHistory(league.season, week);
  const draftPicks = await loadDraftPicksCached(drafts && drafts[0] ? drafts[0].draft_id : null);

  return {
    league: {
      name: league.name,
      league_id: LEAGUE_ID,
      season: league.season,
      current_week: week,
      total_rosters: league.total_rosters || rosters.length,
      roster_positions: league.roster_positions,
      scoring_type: scoringTypeFrom(league),
      trade_deadline_week: league.settings ? league.settings.trade_deadline : null,
      playoff_week_start: (league.settings && league.settings.playoff_week_start) || null,
      waiver_budget: (league.settings && league.settings.waiver_budget) || 100,
      last_synced: new Date().toISOString(),
    },
    teams: teamsBuilt,
    players,
    matchups: buildMatchups(matchupsRaw),
    txns: txns || [],
    projections: projectionsRaw || {},
    stats: statsRaw || {},
    chopHistory,
    seasonHistory,
    draftPicks: draftPicks || [],
  };
}

function cacheState(s) {
  try {
    // Skip caching `players`/`projections`/`stats`/`seasonHistory`/`draftPicks`
    // here — they're large and each have their own fetch/cache path already;
    // the "last good state" fallback is meant to be a light snapshot of the rest.
    const { players, projections, stats, seasonHistory, draftPicks, ...rest } = s;
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: rest }));
  } catch (e) { /* ignore */ }
}

function loadCachedState() {
  try {
    const raw = localStorage.getItem(STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? { ts: parsed.ts, data: parsed.data } : null;
  } catch (e) { return null; }
}
