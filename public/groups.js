// public/groups.js
// Groups list page (index.html). Links should be: /<slug> (Option A)

function getOrCreateVisitorId() {
  const KEY = "tg_visitor_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : ("v_" + Math.random().toString(16).slice(2) + Date.now().toString(16));
    localStorage.setItem(KEY, id);
  }
  return id;
}

function hashTo1to7(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 7) + 1;
}

function safePathSlug(slug) {
  return encodeURIComponent(slug).replace(/%2B/gi, "+");
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
  } catch {
    return { ok: false, unlocked: false, invites_count: 0, invites_needed: 0 };
  }
}

function cardHTML({ href, title, desc, iconSrc, tagText, tagKind, progressText, cardClass, isNew }) {
  const esc = (s) => String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const newAttr = isNew ? ' data-new="true"' : "";

  return `
    <div class="card ${cardClass}"${newAttr}>
      <a href="${href}" class="icon-link" aria-label="Open group">
        <img src="${iconSrc}" alt="Group icon" />
      </a>

      <div class="card-content">
        <p class="platform">Telegram</p>
        <a href="${href}" class="group-name">${esc(title)}</a>
        <p class="desc">${esc(desc)}</p>
        ${progressText ? `<div class="progress-mini">${progressText}</div>` : ``}
      </div>

      <div class="card-buttons">
        <span class="tag ${tagKind}">${esc(tagText)}</span>
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
  } catch {
    freeEl.innerHTML = `<p class="subtitle">Couldn’t load groups. Check /api/groups.</p>`;
    return;
  }

  const free = groups.filter(g => (g.type || "").toLowerCase() === "free");
  const invite = groups.filter(g => (g.type || "").toLowerCase() === "invite");

  // FREE cards
  const freeCards = free.map((g, idx) => {
    const href = `/${safePathSlug(g.slug || "")}`;
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

  // INVITE cards (split into unlocked + locked per visitor)
  const unlockedCards = [];
  const lockedCards = [];

  for (const g of invite) {
    const href = `/${safePathSlug(g.slug || "")}`;
    const iconSrc = g.icon_url || `/assets/ph-${hashTo1to7(g.slug || g.title || "g")}.svg`;
    const title = g.title || g.slug || "Locked Group";

    const status = await getStatus(g.slug, visitorId);
    const needed = Number(status.invites_needed ?? g.invites_needed ?? 0);
    const have = Number(status.invites_count ?? 0);
    const unlocked = !!status.unlocked;

    const progress = (needed > 0) ? `<b>${have}</b> / <b>${needed}</b> invites` : "";
    const desc = g.description || "Invite only group";

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
