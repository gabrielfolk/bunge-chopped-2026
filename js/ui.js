// Small render helpers (formatting, avatars, escaping, detail panels, sync pill/banner).
// Plain (non-module) scripts sharing one global scope, loaded in order by index.html.

// ---------------------------------------------------------------
// Render helpers (pure UI, operate on module-level `state`)
// ---------------------------------------------------------------

function initials(name) {
  if (!name) return '??';
  return name.slice(0, 2).toUpperCase();
}

function avatarColorVar(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatarEl(team) {
  const div = document.createElement('div');
  div.className = 'avatar';
  div.style.background = `var(${avatarColorVar(team.owner_id || team.display_name || 'x')})`;
  div.textContent = initials(team.team_name || team.display_name);
  return div;
}

function playerLabel(pid) {
  const p = state.players[pid];
  if (!p) return { name: 'Empty', pos: null, team: null };
  return { name: `${(p.first_name || '').slice(0,1)}. ${p.last_name || pid}`.trim(), pos: p.position, team: p.team };
}

const TXN_TYPE_LABEL = { free_agent: 'Free agent', waiver: 'Waiver claim', trade: 'Trade' };

function describeTransactionForRoster(tx, rid) {
  const parts = [];
  if (tx.adds) Object.entries(tx.adds).forEach(([pid, r]) => { if (r === rid) parts.push(`added ${playerLabel(pid).name}`); });
  if (tx.drops) Object.entries(tx.drops).forEach(([pid, r]) => { if (r === rid) parts.push(`dropped ${playerLabel(pid).name}`); });
  const typeLabel = TXN_TYPE_LABEL[tx.type] || (tx.type ? tx.type[0].toUpperCase() + tx.type.slice(1) : 'Move');
  return `${typeLabel}: ${parts.join(', ') || 'no players listed'} · ${timeAgo(tx.created)}`;
}

function fmt(n) {
  return (Math.round((n || 0) * 100) / 100).toFixed(2);
}

const CHOP_SVG = `
  <svg viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="100%" height="100%">
    <ellipse cx="48" cy="80" rx="34" ry="7" fill="#000" opacity="0.08"/>
    <rect x="18" y="46" width="60" height="32" rx="9" fill="#b5793a"/>
    <rect x="18" y="46" width="60" height="10" rx="5" fill="#a06a30"/>
    <ellipse cx="48" cy="46" rx="30" ry="12" fill="#e2ad6c"/>
    <ellipse cx="48" cy="46" rx="30" ry="12" fill="none" stroke="#a06a30" stroke-width="2"/>
    <ellipse cx="48" cy="46" rx="20" ry="8" fill="none" stroke="#a06a30" stroke-width="1.4" opacity="0.55"/>
    <ellipse cx="48" cy="46" rx="10" ry="4" fill="none" stroke="#a06a30" stroke-width="1.4" opacity="0.55"/>
    <g class="cleaver">
      <!-- Blocky rectangular butcher's-cleaver blade (not a tapered chef's
           knife point), with a hanging hole near the back-top corner --
           modeled on a real cleaver-on-a-board reference photo. -->
      <path d="M26 16 L74 10 L74 34 L22 32 Z" fill="#d7dbe0" stroke="#7d838d" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M30 18 L70 13 L70 16 L29 21 Z" fill="#ffffff" opacity="0.4"/>
      <circle cx="68" cy="17" r="2.4" fill="none" stroke="#7d838d" stroke-width="1.4" opacity="0.7"/>
      <!-- Wooden dowel handle: shaft + rounded knob end + a rivet where it
           meets the blade. Continues the blade's own spine line (rotated
           to match its slight slope) instead of jutting straight up at a
           right angle to it. -->
      <g transform="rotate(-7 74 16)">
        <rect x="74" y="12" width="23" height="8" rx="4" fill="#8b5a2b" stroke="#5c3a1a" stroke-width="1"/>
        <circle cx="97" cy="16" r="5.5" fill="#8b5a2b" stroke="#5c3a1a" stroke-width="1"/>
        <circle cx="77" cy="16" r="1.5" fill="#5c3a1a"/>
      </g>
    </g>
  </svg>`;

// Sleeper account fields (team_name, display_name) are set by league members
// themselves, so they're untrusted input — escape before ever putting them
// (or anything derived from them, like tile labels) into innerHTML.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// The expandable panel under a stat tile (also reused by the Chopping
// Block card): optional explainer, then rows, some with sub-rows.
function fillDetailPanel(panel, t) {
  panel.innerHTML = '';
  if (t.info) {
    const info = document.createElement('div');
    info.className = 'stat-detail-info';
    info.textContent = t.info;
    panel.appendChild(info);
  }
  if (t.rows && t.rows.length) {
    t.rows.forEach(r => {
      if (r.moves && r.moves.length) {
        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'stat-detail-row stat-detail-row-btn';
        rowBtn.setAttribute('aria-expanded', 'false');
        rowBtn.innerHTML = `<span class="label">${esc(r.label)}</span><span class="value mono">${esc(r.value)}<svg class="chevron-sm" width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        const sub = document.createElement('div');
        sub.className = 'stat-detail-sub';
        sub.hidden = true;
        sub.innerHTML = r.moves.map(mv => `<div class="stat-detail-sub-row">${esc(mv)}</div>`).join('');
        rowBtn.addEventListener('click', () => {
          const expanded = rowBtn.getAttribute('aria-expanded') === 'true';
          rowBtn.setAttribute('aria-expanded', String(!expanded));
          sub.hidden = expanded;
        });
        panel.appendChild(rowBtn);
        panel.appendChild(sub);
      } else {
        const row = document.createElement('div');
        row.className = 'stat-detail-row';
        row.innerHTML = `<span class="label">${esc(r.label)}</span><span class="value mono">${esc(r.value)}</span>`;
        panel.appendChild(row);
      }
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'stat-detail-empty';
    empty.textContent = t.emptyMessage || 'No further detail for this stat.';
    panel.appendChild(empty);
  }
}

function renderStatCards(container, tiles, idPrefix) {
  container.innerHTML = '';
  tiles.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'stat-card liftable';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stat-tile';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', `${idPrefix}-detail-${i}`);
    btn.innerHTML = `
      <div class="stat-tile-top">
        <div class="eyebrow">${esc(t.eyebrow)}</div>
        <svg class="chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="headline">${esc(t.headline)}</div>
      <div class="detail">${esc(t.detail)}</div>`;

    const panel = document.createElement('div');
    panel.className = 'stat-detail';
    panel.id = `${idPrefix}-detail-${i}`;
    panel.hidden = true;
    fillDetailPanel(panel, t);

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      card.classList.toggle('is-expanded', !expanded);
    });

    card.appendChild(btn);
    card.appendChild(panel);
    container.appendChild(card);
  });
}

function timeAgo(iso) {
  if (!iso) return 'just now';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function updateSyncPill() {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot';
  if (lastFetchError && !lastFetchOk) {
    dot.classList.add('error');
    label.textContent = 'never synced — see error below';
  } else if (lastFetchError) {
    dot.classList.add('stale');
    label.textContent = `refresh failed, showing data from ${timeAgo(lastFetchOk.toISOString())}`;
  } else if (lastFetchOk) {
    label.textContent = `synced ${timeAgo(lastFetchOk.toISOString())}`;
  } else {
    label.textContent = 'loading…';
  }
}

function renderTopBanner() {
  const el = document.getElementById('top-banner');
  el.innerHTML = '';
  if (lastFetchError) {
    const banner = document.createElement('div');
    banner.className = 'note-banner critical';
    const shown = lastFetchOk ? `Showing data last refreshed ${timeAgo(lastFetchOk.toISOString())}.` : 'No data loaded yet.';
    banner.innerHTML = `<span><b>Couldn't refresh from Sleeper.</b> ${esc(shown)} (${esc(lastFetchError)})</span>`;
    el.appendChild(banner);
  }
}
