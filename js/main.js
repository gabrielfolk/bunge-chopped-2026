// Boot sequence and 30s polling. Loaded last.
// Plain (non-module) scripts sharing one global scope, loaded in order by index.html.

// ---------------------------------------------------------------
// Boot sequence + polling
// ---------------------------------------------------------------

function applyLoaded(data) {
  state.league = data.league;
  state.teams = data.teams;
  state.players = data.players;
  state.matchups = data.matchups;
  state.txns = data.txns;
  state.projections = data.projections || {};
  state.stats = data.stats || {};
  state.chopHistory = data.chopHistory || {};
  state.seasonHistory = data.seasonHistory || { weeks: [], matchupsByWeek: {}, txnsByWeek: {}, statsByWeek: {}, projByWeek: {} };
  state.draftPicks = data.draftPicks || [];
}

async function refresh() {
  try {
    const data = await loadLiveState();
    applyLoaded(data);
    lastFetchOk = new Date();
    lastFetchError = null;
    cacheState(data);
  } catch (e) {
    lastFetchError = e.message || String(e);
    // keep showing whatever we already had in `state`
  }
  updateSyncPill();
  renderTopBanner();
  render();
}

async function boot() {
  const cached = loadCachedState();
  if (cached) {
    applyLoaded({ ...cached.data, players: {}, projections: {}, stats: {} }); // filled in once the real load completes
    lastFetchOk = new Date(cached.ts);
    render();
    updateSyncPill();
  }
  await refresh();

  let pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}

boot();
