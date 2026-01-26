// public/groups.js
// Renders the groups list from D1 via /api/groups
// Shows unlocked invite-groups for this visitor via /api/referrals/summary

const els = {
  free: document.getElementById("freeGroups"),
  locked: document.getElementById("lockedGroups"),
  unlockedSection: document.getElementById("unlockedSection"),
  unlocked: document.getElementById("unlockedGroups"),
};

function safeText(v) {
  return (v == null ? "" : String(v));
}

function firstLetter(v) {
  const s = safeText(v).trim();
  return (s ? s[0] : "?").toUpperCase();
}

function pickHref(group, unlocked) {
  // Prefer explicit paths from D1 so you can change routing later without changing code.
  const slugPath = "/" + encodeURIComponent(group.slug || "");
  const feed = group.feed_path || slugPath;
  const gate = group.gate_path || feed;

  if (group.type === "free") return feed;
  return unlocked ? feed : gate;
}

function makeCard(group, inviteCount, unlocked) {
  const a = document.createElement("a");
  a.className =
    "gcard " +
    (group.type === "free" ? "gcard--free" : unlocked ? "gcard--unlocked" : "gcard--locked");
  a.href = pickHref(group, unlocked);

  // Left avatar (image if icon_url exists, else letter)
  const avatar = document.createElement("div");
  avatar.className = "gcard__avatar";
  if (group.icon_url) {
    const img = document.createElement("img");
    img.alt = safeText(group.title || group.slug || "Group");
    img.src = group.icon_url;
    avatar.appendChild(img);
  } else {
    avatar.textContent = firstLetter(group.title || group.slug);
  }

  // Body
  const body = document.createElement("div");
  body.className = "gcard__body";

  const brand = document.createElement("div");
  brand.className = "gcard__brand";
  brand.textContent = "Telegram";

  const title = document.createElement("div");
  title.className = "gcard__title";
  title.textContent = safeText(group.title || group.slug);

  const desc = document.createElement("div");
  desc.className = "gcard__desc";
  desc.textContent = safeText(group.description || "");

  body.appendChild(brand);
  body.appendChild(title);
  if (group.description) body.appendChild(desc);

  // Invite progress (only for invite groups)
  if (group.type === "invite") {
    const need = Number(group.invites_needed || 0);
    const have = Number(inviteCount || 0);
    const pct = need > 0 ? Math.max(0, Math.min(100, Math.round((have / need) * 100))) : 0;

    const prog = document.createElement("div");
    prog.className = "gcard__progress";

    const bar = document.createElement("div");
    bar.className = "gcard__bar";

    const fill = document.createElement("div");
    fill.className = "gcard__fill";
    fill.style.width = pct + "%";
    bar.appendChild(fill);

    const count = document.createElement("div");
    count.className = "gcard__count";
    count.textContent = `${have}/${need}`;

    prog.appendChild(bar);
    prog.appendChild(count);
    body.appendChild(prog);
  }

  // Right (tag + join)
  const right = document.createElement("div");
  right.className = "gcard__right";

  const tag = document.createElement("span");
  tag.className =
    "gcard__tag " +
    (group.type === "free"
      ? "gcard__tag--free"
      : unlocked
      ? "gcard__tag--unlocked"
      : "gcard__tag--invite");

  if (group.type === "free") tag.textContent = "FREE TO JOIN";
  else if (unlocked) tag.textContent = "UNLOCKED";
  else tag.textContent = "INVITE REQUIRED";

  const join = document.createElement("span");
  join.className = "gcard__join";
  join.textContent = "JOIN";

  right.appendChild(tag);
  right.appendChild(join);

  a.appendChild(avatar);
  a.appendChild(body);
  a.appendChild(right);

  return a;
}

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function main() {
  // Clear containers
  els.free.innerHTML = "";
  els.locked.innerHTML = "";
  els.unlocked.innerHTML = "";
  els.unlockedSection.style.display = "none";

  let groups = [];
  try {
    groups = await fetchJSON("/api/groups");
  } catch (e) {
    els.locked.textContent = "Failed to load groups.";
    return;
  }

  let summary = { visitor_id: "", unlocked: [], invite_counts: {} };
  try {
    summary = await fetchJSON("/api/referrals/summary");
  } catch (e) {
    // If summary fails, still show groups (just without unlocked)
  }

  const unlockedSet = new Set((summary.unlocked || []).map((s) => String(s).toLowerCase()));
  const inviteCounts = summary.invite_counts || {};

  for (const g of groups) {
    const slugLc = String(g.slug_lc || g.slug || "").toLowerCase();
    const unlocked = unlockedSet.has(slugLc);
    const inviteCount = inviteCounts[slugLc] || 0;

    if (g.type === "free") {
      els.free.appendChild(makeCard(g, inviteCount, unlocked));
    } else if (unlocked) {
      els.unlockedSection.style.display = "block";
      els.unlocked.appendChild(makeCard(g, inviteCount, unlocked));
    } else {
      els.locked.appendChild(makeCard(g, inviteCount, unlocked));
    }
  }
}

main();
