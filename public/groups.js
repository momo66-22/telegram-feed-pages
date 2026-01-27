// public/groups.js
// Renders the Groups List UI (index.html) using the CSS from /assets/site.css

function getOrCreateVisitorId() {
  const KEY = "tg_visitor_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    // Prefer randomUUID when available
    id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ("v_" + Math.random().toString(16).slice(2) + Date.now().toString(16));
    localStorage.setItem(KEY, id);
  }
  return id;
}

function hashTo1to7(str) {
  // Simple deterministic hash → 1..7 (for placeholder icons)
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 7) + 1;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function loadGroups() {
  const data = await fetchJSON("/api/groups");
  return Array.isArray(data) ? data : (data.groups || []);
}

async function getStatus(groupSlug, visitorId) {
  const u = new URL("/api/referrals/status", location.origin);
  u.searchParams.set("group_slug", groupSlug);
  u.searchParams.set("visitor_id", visitorId);
  try {
    return await fetchJSON(u.toString());
  } catch (e) {
    return { ok: false, unlocked: false, invites_count: 0, invites_needed: 0 };
  }
}

function cardHTML({ href, title, desc, iconSrc, tagText, tagKind, progressText, cardClass, isNew }) {
  const safeTitle = (title || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeDesc = (desc || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeProg = (progressText || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const newAttr = isNew ? ' data-new="true"' : "";

  return `
    <div class="card ${cardClass}"${newAttr}>
      <a href="${href}" class="icon-link" aria-label="Open group">
        <img src="${iconSrc}" alt="Group icon" />
      </a>

      <div class="card-content">
        <p class="platform">Telegram</p>
        <a href="${href}" class="group-name">${safeTitle}</a>
        <p class="desc">${safeDesc}</p>
        ${safeProg ? `<div class="progress-mini">${safeProg}</div>` : ``}
      </div>

      <div class="card-buttons">
        <span class="tag ${tagKind}">${tagText}</span>
        <a href="${href}" class="join-btn">JOIN</a>
      </div>
    </div>
  `;
}

function renderCards(container, cards) {
  container.innerHTML = cards.join("");
}

function show(el) { el.style.display = ""; }
function hide(el) { el.style.display = "none"; }

async function main() {
  const freeEl = document.getElementById("freeGroups");
  const unlockedSection = document.getElementById("unlockedSection");
  const unlockedEl = document.getElementById("unlockedGroups");
  const lockedEl = document.getElementById("lockedGroups");

  const visitorId = getOrCreateVisitorId();

  let groups = [];
  try {
    groups = await loadGroups();
  } catch (e) {
    freeEl.innerHTML = `<p class="subtitle">Couldn’t load groups. Check /api/groups.</p>`;
    return;
  }

  const free = groups.filter(g => (g.type || "").toLowerCase() === "free");
  const invite = groups.filter(g => (g.type || "").toLowerCase() === "invite");

  // Render Free
  const freeCards = free.map((g, idx) => {
    const href = g.feed_path || `/${g.slug || ""}`;
    const iconSrc = g.icon_url || `/assets/ph-${hashTo1to7(g.slug || g.title || "g")}.svg`;
    const title = g.title || g.slug || "Group";
    const desc = g.description || "Public feed";
    const cardClass = idx === 0 ? "trending is-highlight hl-purple" : "trending";
    return cardHTML({
      href, title, desc, iconSrc,
      tagText: "Free To Join",
      tagKind: "open",
      progressText: "",
      cardClass,
      isNew: false
    });
  });

  renderCards(freeEl, freeCards.length ? freeCards : [
    `<p class="subtitle">No free groups yet. Add rows to D1 “groups” table.</p>`
  ]);

  // For invite groups, ask the server if this visitor has unlocked each one
  const unlockedCards = [];
  const lockedCards = [];

  for (const g of invite) {
    const href = g.gate_path || g.feed_path || `/${g.slug || ""}`;
    const iconSrc = g.icon_url || `/assets/ph-${hashTo1to7(g.slug || g.title || "g")}.svg`;
    const title = g.title || g.slug || "Locked Group";
    const status = await getStatus(g.slug, visitorId);

    const needed = Number(status.invites_needed ?? g.invites_needed ?? 0);
    const have = Number(status.invites_count ?? 0);

    const progress = (needed > 0) ? `<b>${have}</b> / <b>${needed}</b> invites` : "";

    const descBase = g.description || "Invite only group";
    const desc = needed > 0 ? `${descBase}` : descBase;

    const unlocked = !!status.unlocked;

    const html = cardHTML({
      href, title, desc, iconSrc,
      tagText: unlocked ? "Unlocked" : "Invite Required",
      tagKind: unlocked ? "open" : "locked",
      progressText: progress,
      cardClass: unlocked ? "trending" : "general",
      isNew: false
    });

    if (unlocked) unlockedCards.push(html);
    else lockedCards.push(html);
  }

  if (unlockedCards.length) {
    show(unlockedSection);
    renderCards(unlockedEl, unlockedCards);
  } else {
    hide(unlockedSection);
  }

  renderCards(lockedEl, lockedCards.length ? lockedCards : [
    `<p class="subtitle">No invite-required groups yet. Add rows to D1 “groups” table.</p>`
  ]);
}

document.addEventListener("DOMContentLoaded", main);
