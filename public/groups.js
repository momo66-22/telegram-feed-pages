// public/groups.js
(function () {
  // ===== Utilities =====
  function getOrCreateVisitorId() {
    const KEY = "tg_uid"; // keep same key app.js uses
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : ("u_" + Math.random().toString(16).slice(2) + Date.now().toString(16)));
      localStorage.setItem(KEY, id);
    }
    return id;
  }

  const VISITOR_ID = getOrCreateVisitorId();

  function qs(sel) { return document.querySelector(sel); }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "request_failed");
    return data;
  }

  // ===== UI helpers (your existing layout expects these containers) =====
  const freeWrap = document.getElementById("freeGroups");
  const lockedWrap = document.getElementById("lockedGroups");
  const unlockedSection = document.getElementById("unlockedSection");
  const unlockedWrap = document.getElementById("unlockedGroups");

  function empty(el) { if (el) el.innerHTML = ""; }

  function mkCard(g, status) {
    // status can be null if status call fails
    const isInvite = g.type === "invite";
    const isUnlocked = !!status?.unlocked;
    const invitesNeeded = Number(status?.invites_needed ?? g.invites_needed ?? 0);
    const invitesCount = Number(status?.invites_count ?? 0);

    // Build clean path URL: "/<slug>"
    // encodeURI keeps "+" in the PATH (good for your telegram-looking invite slugs)
    const pathSlug = encodeURI(String(g.slug || "").trim());
    const href = `/${pathSlug}?g=${encodeURIComponent(g.slug)}`;

    const a = document.createElement("a");
    a.className = "gCard";           // your CSS
    a.href = href;

    // avatar initial
    const initial = (g.title || g.slug || "?").trim().slice(0, 1).toUpperCase();

    // pill labels
    const rightPill = isInvite ? (isUnlocked ? "UNLOCKED" : "INVITE REQUIRED") : "FREE TO JOIN";

    a.innerHTML = `
      <div class="gLeft">
        <div class="gAvatar">${initial}</div>
        <div class="gText">
          <div class="gTopLine">
            <span class="gBrand">Telegram</span>
            <span class="gPill ${isInvite ? "pillRed" : "pillGreen"}">${rightPill}</span>
          </div>
          <div class="gTitle">${escapeHtml(g.title || g.slug || "Group")}</div>
          <div class="gSub">${escapeHtml(g.description || (isInvite ? "Invite only group" : "Public feed"))}</div>
          ${isInvite ? `<div class="gInvites">${invitesCount} / ${invitesNeeded} invites</div>` : ``}
        </div>
      </div>
      <div class="gRight">
        <button class="gJoinBtn" type="button">JOIN</button>
      </div>
    `;

    // Make button click also go to the link
    const btn = a.querySelector(".gJoinBtn");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = href;
    });

    return a;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function load() {
    empty(freeWrap); empty(lockedWrap); empty(unlockedWrap);
    if (unlockedSection) unlockedSection.style.display = "none";

    const { groups } = await fetchJSON("/api/groups");
    const list = Array.isArray(groups) ? groups : [];

    // Fetch status for each group (so we can show unlocked + counts)
    const statusMap = new Map();
    await Promise.all(list.map(async (g) => {
      try {
        const st = await fetchJSON(`/api/referrals/status?group_slug=${encodeURIComponent(g.slug)}&visitor_id=${encodeURIComponent(VISITOR_ID)}`);
        statusMap.set(g.slug, st);
      } catch {
        statusMap.set(g.slug, null);
      }
    }));

    const free = [];
    const invite = [];
    const unlocked = [];

    for (const g of list) {
      const st = statusMap.get(g.slug);
      if (g.type === "free") free.push(g);
      else {
        invite.push(g);
        if (st?.unlocked) unlocked.push(g);
      }
    }

    // Render free
    if (freeWrap) {
      for (const g of free) freeWrap.appendChild(mkCard(g, statusMap.get(g.slug)));
    }

    // Render unlocked (only invite groups that are unlocked)
    if (unlocked.length && unlockedWrap && unlockedSection) {
      unlockedSection.style.display = "block";
      for (const g of unlocked) unlockedWrap.appendChild(mkCard(g, statusMap.get(g.slug)));
    }

    // Render locked invite groups (exclude unlocked ones from this list if you want)
    if (lockedWrap) {
      const lockedOnly = invite.filter(g => !statusMap.get(g.slug)?.unlocked);
      if (!lockedOnly.length) {
        lockedWrap.innerHTML = `<div class="gEmpty">No invite-required groups yet. Add rows to D1 <code>groups</code> table.</div>`;
      } else {
        for (const g of lockedOnly) lockedWrap.appendChild(mkCard(g, statusMap.get(g.slug)));
      }
    }
  }

  load().catch((e) => {
    console.error(e);
    if (lockedWrap) lockedWrap.innerHTML = `<div class="gEmpty">Failed to load groups.</div>`;
  });
})();
