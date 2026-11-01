// Constants and shared mutable state. Loaded first; everything below reads these globals.
// Plain (non-module) scripts sharing one global scope, loaded in order by index.html.

const LEAGUE_ID = '1398014426640044032';
const API = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE_KEY = 'bunge_players_cache_v1';
const PROJECTIONS_CACHE_PREFIX = 'bunge_projections_cache_v1';
const STATE_CACHE_KEY = 'bunge_state_cache_v1';
const CHOP_HISTORY_CACHE_PREFIX = 'bunge_matchups_history_v1';
const TXNS_HISTORY_CACHE_PREFIX = 'bunge_txns_history_v1';
const STATS_HISTORY_CACHE_PREFIX = 'bunge_stats_history_v1';
const PROJ_HISTORY_CACHE_PREFIX = 'bunge_proj_history_v1';
const DRAFT_PICKS_CACHE_PREFIX = 'bunge_draft_picks_v1';
const PLAYERS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const PROJECTIONS_MAX_AGE_MS = 60 * 60 * 1000; // 1h — projections don't move mid-game like actual stats do
const BOOM_BUST_MIN_PROJECTION = 2; // filter out irrelevant scrubs so the list isn't noise
const BOOM_BUST_COUNT = 6;
// 2026 NFL bye weeks (Sleeper has no bye endpoint; derived from the
// published schedule). Keys use Sleeper's team abbreviations.
const BYE_WEEKS = {
  ARI: 14, ATL: 11, BAL: 13, BUF: 7, CAR: 5, CHI: 10, CIN: 6, CLE: 11,
  DAL: 14, DEN: 10, DET: 6, GB: 11, HOU: 8, IND: 13, JAX: 7, KC: 5,
  LAC: 7, LAR: 11, LV: 13, MIA: 6, MIN: 6, NE: 11, NO: 8, NYG: 8,
  NYJ: 13, PHI: 10, PIT: 9, SEA: 11, SF: 8, TB: 10, TEN: 9, WAS: 7,
};
const POLL_MS = 30 * 1000; // 30s while tab is visible

const AVATAR_COLORS = ['--avatar-a', '--avatar-b', '--avatar-c', '--avatar-d', '--avatar-e', '--avatar-f'];
const POS_VAR = { QB: '--pos-qb', RB: '--pos-rb', WR: '--pos-wr', TE: '--pos-te', FLEX: '--pos-te' };

const state = { league: null, teams: [], players: {}, matchups: [], txns: [], projections: {}, stats: {}, chopHistory: {}, seasonHistory: null, draftPicks: [] };
let lastFetchOk = null; // Date of last successful fetch
let lastFetchError = null;
