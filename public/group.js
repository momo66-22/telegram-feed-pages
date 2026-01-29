// public/group.js
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

  document.cookie = `visitor_id=${encodeURIComponent(vid)}; path=/; max-age=31536000; SameSite=Lax`;
  return vid;
}

function getSlugFromURL() {
  const url = new URL(location.href);

  // Option A
  let slug = url.searchParams.get("g") || "";

  // fallback: if someone manually hits /media etc.
  if (!slug) {
    const p = url.pathname.replace(/^\/+|\/+$/g, "");
    if (p && p !== "group") slug = decodeURIComponent(p);
  }

  // IMPORTANT: URLSearchParams turns "+" into space sometimes. Undo that.
  slug = (slug || "").trim().replace(/ /g, "+");
  return slug;
}

function getInvFromURL() {
  const url = new URL(location.href);
  let inv = url.searchParams.get("inv") || "";
  inv = (inv || "").trim().replace(/ /g, "+");
  return inv;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { res, data, text };
}

async function getGroup(slug) {
  // If your /api/groups supports ?slug= use it, otherwise fall back to list
  const tryOne = await fetchJSON(`/api/groups?slug=${encodeURIComponent(slug)}`);
  if (tryOne.res.ok && tryOne.data?.group) return tryOne.data.group;

  const list = await fetchJSON("/api/groups");
  if (!list.res.ok) throw new Error(`Failed to load groups: HTTP ${list.res.status}`);
  const groups = list.data?.groups || [];

  const want = slug.toLowerCase();
  const found = groups.find(g => String(g.slug_lc || g.slug || "").toLowerCase() === want);
  if (!found) throw new Error(`Group not found: ${slug}`);
  return found;
}

async function getStatus(groupSlug, visitorId) {
  const u = new URL("/api/referrals/status", location.origin);
  u.searchParams.set("group_slug", groupSlug);
  u.searchParams.set("visitor_id", visitorId);

  const { res, data } = await fetchJSON(u.toString());
  if (!res.ok) return null;
  return data;
}

async function getMyCode(groupSlug, visitorId) {
  const { res, data, text } = await fetchJSON("/api/referrals/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ group_slug: groupSlug, visitor_id: visitorId })
  });
  if (!res.ok) throw new Error(text || `code failed: HTTP ${res.status}`);
  return data?.code || "";
}

async function claimIfNeeded(groupSlug, visitorId, creditedCode) {
  if (!creditedCode) return null;

  const { res, data } = await fetchJSON("/api/referrals/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      group_slug: groupSlug,
      visitor_id: visitorId,
      credited_code: creditedCode
    })
  });

  if (!res.ok) return null;
  return data;
}

function setProgress(invites, needed) {
  const fill = $("progressFill");
  const text = $("progressText");
  const pct = needed > 0 ? Math.min(100, Math.round((invites / needed) * 100)) : 0;

  fill.style.width = `${pct}%`;
  text.textContent = `${invites}/${needed}`;
}

function showGate() {
  $("gate").style.display = "";
  $("feedPage").style.display = "none";
}

function showFeed() {
  $("gate").style.display = "none";
  $("feedPage").style.display = "";
  // load feed renderer if you use app.js for posts
  if (!window.__feedLoaded) {
    window.__feedLoaded = true;
    const s = document.createElement("script");
    s.src = "/app.js";
    s.defer = true;
    document.body.appendChild(s);
  }
}

function setNote(msg) {
  const el = $("gateNote");
  el.textContent = msg || "";
}

async function shareLink(link) {
  try {
    if (navigator.share) {
      await navigator.share({ url: link });
      return "Shared.";
    }
  } catch {}
  try {
    await navigator.clipboard.writeText(link);
    return "Link copied.";
  } catch {
    return link; // fallback: show link
  }
}

async function main() {
  const backBtn = $("backBtn");
  if (backBtn) backBtn.addEventListener("click", () => (location.href = "/"));

  const visitorId = ensureVisitorId();
  const slug = getSlugFromURL();
  const creditedCode = getInvFromURL();

  if (!slug) {
    $("gateTitle").textContent = "Missing group";
    $("gateSub").textContent = "No group provided.";
    showGate();
    return;
  }

  let group;
  try {
    group = await getGroup(slug);
  } catch (e) {
    $("gateTitle").textContent = "Group not found";
    $("gateSub").textContent = String(e.message || e);
    showGate();
    return;
  }

  // UI titles/avatars
  $("gateTitle").textContent = group.title || group.slug;
  $("channelTitle").textContent = (group.title || group.slug || "GROUP").toUpperCase();

  const avatar = $("avatarImg");
  if (avatar) {
    if (group.avatar_url) {
      avatar.src = group.avatar_url;
      avatar.style.display = "";
    } else {
      avatar.style.display = "none";
    }
  }

  const type = (group.type || "").toLowerCase();
  const isFree = type === "free";

  // Free groups: go straight to feed
  if (isFree) {
    showFeed();
    return;
  }

  // Invite groups: show gate and status
  showGate();

  async function refreshStatus() {
    const st = await getStatus(group.slug, visitorId);
    const invites = Number(st?.invites || 0);
    const needed = Number(st?.invites_needed || group.invites_needed || 0);

    setProgress(invites, needed);

    if (st?.unlocked) {
      showFeed();
      return true;
    }
    return false;
  }

  await refreshStatus();

  const shareBtn = $("shareBtn");
  shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    setNote("Working…");

    try {
      // Credit inviter ONLY when THIS visitor clicks Share (first time is deduped server-side)
      const claimRes = await claimIfNeeded(group.slug, visitorId, creditedCode);

      // Get my own code + build my share link
      const myCode = await getMyCode(group.slug, visitorId);
      const link = `${location.origin}/group?g=${encodeURIComponent(group.slug)}&inv=${encodeURIComponent(myCode)}`;

      const msg = await shareLink(link);

      if (claimRes?.credited) {
        setNote(`${msg} +1 invite credited.`);
      } else {
        setNote(msg);
      }

      await refreshStatus();
    } catch (e) {
      setNote(String(e.message || e));
    } finally {
      shareBtn.disabled = false;
    }
  });
}

main();
