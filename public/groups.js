const $ = (sel) => document.querySelector(sel);

function htmlEscape(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toSlugHref(slug) {
  // Keep "+" looking normal (no %2B). Slugs should not contain "/" anyway.
  const clean = String(slug || "").replace(/^\/+/, "");
  return encodeURI("/" + clean);
}

function badge({ text, cls }) {
  if (!text) return "";
  return `<span class="badge ${cls || ""}">${htmlEscape(text)}</span>`;
}

function cardHTML(g, { inviteText, badgeText, badgeClass, ring }) {
  const href = toSlugHref(g.slug);

  const icon = (g.icon_url || "").trim();
  const avatar = icon
    ? `<img class="avatar-img" src="${htmlEscape(icon)}" alt="">`
    : `<div class="avatar-fallback">${htmlEscape((g.title || "G").slice(0, 1).toUpperCase())}</div>`;

  const ringClass = ring ? "is-ring" : "";

  return `
    <a class="group-card ${ringClass}" href="${href}">
      <div class="left">
        <div class="avatar">${avatar}</div>
        <div class="meta">
          <div class="topline">
            <span class="brand">Telegram</span>
            ${badge({ text: badgeText, cls: badgeClass })}
          </div>
          <div class="title">${htmlEscape(g.title || g.slug || "Group")}</div>
          <div class="desc">${htmlEscape(g.description || "")}</div>
          ${inviteText ? `<div class="invites">${htmlEscape(inviteText)}</div>` : ``}
        </div>
      </div>
      <div class="right">
        <button class="join-btn" type="button">JOIN</button>
      </div>
    </a>
  `;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function renderSection({ title, icon, list, mountSel }) {
  const mount = $(mountSel);
  if (!mount) return;

  const header = `
    <div class="section-title">
      <span class="section-icon">${icon || ""}</span>
      <span>${htmlEscape(title)}</span>
    </div>
  `;

  if (!list.length) {
    mount.innerHTML = header + `<div class="empty">No groups.</div>`;
    return;
  }

  mount.innerHTML = header + list.join("");
}

(async function main() {
  try {
    // This endpoint is expected to return:
    // { groups: [...], unlocked_slugs: [...], invite_counts: { [slug_lc]: number } }
    // If yours returns different keys, tell me what it returns and I’ll adapt it.
    const data = await fetchJSON("/api/referrals/summary");
    const groups = data.groups || [];
    const unlocked = new Set((data.unlocked_slugs || []).map((s) => String(s).toLowerCase()));
    const inviteCounts = data.invite_counts || {};

    const free = [];
    const locked = [];
    const unlockedCards = [];

    for (const g of groups) {
      const slugLc = String(g.slug || "").toLowerCase();
      const needed = Number(g.invites_needed || 0);

      const isInviteRequired = needed > 0;
      const isUnlocked = unlocked.has(slugLc);

      if (!isInviteRequired) {
        free.push(
          cardHTML(g, {
            inviteText: "Public feed",
            badgeText: "FREE TO JOIN",
            badgeClass: "badge-free",
            ring: true,
          })
        );
      } else if (isUnlocked) {
        const have = Number(inviteCounts[slugLc] || 0);
        unlockedCards.push(
          cardHTML(g, {
            inviteText: `${have} / ${needed} invites`,
            badgeText: "UNLOCKED",
            badgeClass: "badge-unlocked",
            ring: true,
          })
        );
      } else {
        const have = Number(inviteCounts[slugLc] || 0);
        locked.push(
          cardHTML(g, {
            inviteText: `${have} / ${needed} invites`,
            badgeText: "INVITE REQUIRED",
            badgeClass: "badge-locked",
            ring: false,
          })
        );
      }
    }

    renderSection({ title: "Free To Join", icon: "🔥", list: free, mountSel: "#freeGroups" });

    if (unlockedCards.length) {
      renderSection({ title: "Unlocked Groups", icon: "✅", list: unlockedCards, mountSel: "#unlockedGroups" });
    } else {
      const mount = $("#unlockedGroups");
      if (mount) mount.innerHTML = "";
    }

    renderSection({ title: "Invite Required", icon: "🔒", list: locked, mountSel: "#inviteGroups" });
  } catch (e) {
    const mount = $("#inviteGroups") || $("#freeGroups");
    if (mount) mount.innerHTML = `<div class="empty">Failed to load groups: ${htmlEscape(e.message)}</div>`;
  }
})();
