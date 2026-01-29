// public/groups.js
function $(id) {
  return document.getElementById(id);
}

function ensureVisitorId() {
  const KEY = "visitor_id";
  let vid = localStorage.getItem(KEY);

  if (!vid) {
    if (crypto?.randomUUID) vid = crypto.randomUUID();
    else vid = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(KEY, vid);
  }

  // also set cookie (handy if you ever want server reads)
  document.cookie = `visitor_id=${encodeURIComponent(vid)}; path=/; max-age=31536000; SameSite=Lax`;
  return vid;
}

function createCard(g, opts = {}) {
  const href = `/group?g=${encodeURIComponent(g.slug)}`;

  const type = (g.type || "").toLowerCase();
  const isFree = type === "free";
  const isUnlocked = !!opts.unlocked;

  const badgeText = isFree ? "FREE TO JOIN" : (isUnlocked ? "UNLOCKED" : "INVITE REQUIRED");
  const badgeClass = isFree ? "badge-free" : (isUnlocked ? "badge-unlocked" : "badge-locked");

  const invitesNeeded = Number(g.invites_needed || 0);
  const invites = Number(opts.invites || 0);

  const subtitle = isFree
    ? (g.description || "Public feed")
    : `${Math.min(invites, invitesNeeded)} / ${invitesNeeded} invites`;

  const letter = (g.title || g.slug || "G").trim().slice(0, 1).toUpperCase();

  return `
    <a class="group-card ${isFree ? "card-free" : (isUnlocked ? "card-unlocked" : "card-locked")}" href="${href}">
      <div class="group-left">
        <div class="group-avatar">${letter}</div>

        <div class="group-meta">
          <div class="group-top">
            <span class="group-platform">Telegram</span>
            <span class="group-badge ${badgeClass}">${badgeText}</span>
          </div>

          <div class="group-title">${g.title || g.slug}</div>
          <div class="group-sub">${subtitle}</div>
        </div>
      </div>

      <div class="group-right">
        <button class="join-btn" type="button">JOIN</button>
      </div>
    </a>
  `;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { res, data, text };
}

async function getGroups() {
  const { res, data, text } = await fetchJSON("/api/groups");
  if (!res.ok) throw new Error(`Failed to load groups: HTTP ${res.status}\n${text || ""}`);
  return (data && data.groups) ? data.groups : [];
}

async function getStatus(groupSlug, visitorId) {
  const u = new URL("/api/referrals/status", location.origin);
  u.searchParams.set("group_slug", groupSlug);
  u.searchParams.set("visitor_id", visitorId);

  const { res, data } = await fetchJSON(u.toString());
  if (!res.ok) return null;
  return data;
}

async function main() {
  const freeWrap = $("freeGroups");
  const unlockedSection = $("unlockedSection");
  const unlockedWrap = $("unlockedGroups");
  const lockedWrap = $("lockedGroups");

  const visitorId = ensureVisitorId();

  try {
    const groups = await getGroups();

    const freeGroups = groups.filter(g => (g.type || "").toLowerCase() === "free");
    const inviteGroups = groups.filter(g => (g.type || "").toLowerCase() !== "free");

    // Free list
    if (!freeGroups.length) {
      freeWrap.innerHTML = `<div class="muted">No free groups yet.</div>`;
    } else {
      freeWrap.innerHTML = freeGroups.map(g => createCard(g)).join("");
    }

    // Invite groups need status per group
    const statusList = await Promise.all(
      inviteGroups.map(async g => {
        const st = await getStatus(g.slug, visitorId);
        return { g, st };
      })
    );

    const unlocked = [];
    const locked = [];

    for (const { g, st } of statusList) {
      const invites = Number(st?.invites || 0);
      const unlockedNow = !!st?.unlocked;
      (unlockedNow ? unlocked : locked).push({ g, invites, unlocked: unlockedNow });
    }

    // Unlocked section
    if (unlocked.length) {
      unlockedSection.style.display = "";
      unlockedWrap.innerHTML = unlocked
        .map(x => createCard(x.g, { unlocked: true, invites: x.invites }))
        .join("");
    } else {
      unlockedSection.style.display = "none";
      unlockedWrap.innerHTML = "";
    }

    // Locked section
    if (!locked.length) {
      lockedWrap.innerHTML = `<div class="muted">No invite-required groups yet. Add rows to D1 "groups" table.</div>`;
    } else {
      lockedWrap.innerHTML = locked
        .map(x => createCard(x.g, { unlocked: false, invites: x.invites }))
        .join("");
    }

    // Make JOIN button click behave like the card link (no double-click weirdness)
    document.querySelectorAll(".group-card .join-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const a = btn.closest("a.group-card");
        if (a?.href) location.href = a.href;
      });
    });

  } catch (err) {
    freeWrap.innerHTML = `<div class="muted">${String(err.message || err)}</div>`;
    lockedWrap.innerHTML = "";
    unlockedSection.style.display = "none";
  }
}

main();
