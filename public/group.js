// public/group.js
// Gate + referral flow for URL style: /<groupSlug>?inv=ABCDE
// Shows gate until unlocked, then loads the feed (app.js) on the same page.

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

function getSlugFromPath() {
  // "/+93OGk" -> "+93OGk"
  const raw = (location.pathname || "").replace(/^\/+/, "");
  const first = raw.split("/")[0] || "";
  try {
    return decodeURIComponent(first);
  } catch {
    return first;
  }
}

function safePathSlug(slug) {
  // Keep "+" readable in URLs while still encoding other unsafe chars
  return encodeURIComponent(slug).replace(/%2B/gi, "+");
}

async function fetchJSON(url, options) {
  const r = await fetch(url, { cache: "no-store", ...options });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function getStatus(groupSlug, visitorId) {
  const u = new URL("/api/referrals/status", location.origin);
  u.searchParams.set("group_slug", groupSlug);
  u.searchParams.set("visitor_id", visitorId);
  return await fetchJSON(u.toString());
}

async function getMyCode(groupSlug, visitorId) {
  return await fetchJSON("/api/referrals/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_slug: groupSlug, visitor_id: visitorId }),
  });
}

async function claimCredit(groupSlug, visitorId, referredBy) {
  return await fetchJSON("/api/referrals/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group_slug: groupSlug,
      visitor_id: visitorId,
      referred_by: referredBy || "",
    }),
  });
}

// UI elements (from your group.html)
const gate = document.getElementById("gate");
const gateTitle = document.getElementById("gateTitle");
const gateSub = document.getElementById("gateSub");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const shareBtn = document.getElementById("shareBtn");
const gateNote = document.getElementById("gateNote");

const feedPage = document.getElementById("feedPage");

function setProgress(have, need) {
  const n = Math.max(0, Number(need || 0));
  const h = Math.max(0, Number(have || 0));
  if (progressText) progressText.textContent = `${h}/${n}`;
  const pct = n > 0 ? Math.min(100, Math.round((h / n) * 100)) : 0;
  if (progressFill) progressFill.style.width = `${pct}%`;
}

function showGate() {
  if (gate) gate.style.display = "";
  if (feedPage) feedPage.style.display = "none";
}

function showFeed(slug) {
  if (gate) gate.style.display = "none";
  if (feedPage) feedPage.style.display = "";

  // Tell app.js which group to load (pathname-style)
  window.__FEED_GROUP_SLUG = slug;

  // Load app.js once
  if (!document.getElementById("feedAppScript")) {
    const s = document.createElement("script");
    s.id = "feedAppScript";
    s.src = "/app.js";
    document.body.appendChild(s);
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const slug = getSlugFromPath();
  if (!slug || slug.toLowerCase() === "index.html") {
    location.href = "/";
    return;
  }

  const visitorId = getOrCreateVisitorId();

  // Capture ?inv=XXXXX (store it so you can still credit even if user refreshes)
  const url = new URL(location.href);
  const inv = (url.searchParams.get("inv") || "").trim();
  if (inv) {
    localStorage.setItem(`tg_referred_by__${slug.toLowerCase()}`, inv);
  }

  // Initial status
  let status;
  try {
    status = await getStatus(slug, visitorId);
  } catch (e) {
    showGate();
    if (gateTitle) gateTitle.textContent = slug;
    if (gateSub) gateSub.textContent = "Couldn’t load status. Check /api/referrals/status.";
    if (gateNote) gateNote.textContent = "";
    return;
  }

  const title = status.group_title || slug;
  const need = Number(status.invites_needed ?? 0);
  const have = Number(status.invites_count ?? 0);
  const unlocked = !!status.unlocked;

  if (gateTitle) gateTitle.textContent = title;
  if (gateSub) gateSub.textContent = need > 0 ? "Invite people to unlock." : "Free group.";
  setProgress(have, need);

  if (unlocked || need <= 0) {
    showFeed(slug);
    return;
  }

  showGate();

  // Share button
  shareBtn.onclick = async () => {
    shareBtn.disabled = true;
    if (gateNote) gateNote.textContent = "Preparing your invite link…";

    // 1) Ensure we have our own invite code (server-side)
    let my;
    try {
      my = await getMyCode(slug, visitorId);
    } catch (e) {
      shareBtn.disabled = false;
      if (gateNote) gateNote.textContent = "Couldn’t generate invite code. Try again.";
      return;
    }

    const code = (my.my_invite_code || "").trim();
    const shareUrl =
      (my.share_url && String(my.share_url)) ||
      `${location.origin}/${safePathSlug(slug)}?inv=${encodeURIComponent(code)}`;

    // 2) Claim credit for whoever referred THIS visitor (only counted server-side once)
    const storedInv = localStorage.getItem(`tg_referred_by__${slug.toLowerCase()}`) || "";
    try {
      const claimedKey = `tg_claimed__${slug.toLowerCase()}`;
      const alreadyClaimed = localStorage.getItem(claimedKey) === "1";

      if (!alreadyClaimed && storedInv) {
        const claimRes = await claimCredit(slug, visitorId, storedInv);
        // Mark locally to avoid re-posting (server is still the real dedupe)
        localStorage.setItem(claimedKey, "1");

        // Update progress from server response if present
        const newHave = Number(claimRes.invites_count ?? claimRes.credits ?? have);
        const newNeed = Number(claimRes.invites_needed ?? need);
        const nowUnlocked = !!claimRes.unlocked;

        setProgress(newHave, newNeed);

        if (nowUnlocked) {
          if (gateNote) gateNote.textContent = "Unlocked ✅ Loading…";
          showFeed(slug);
          return;
        }
      }
    } catch {
      // ignore; server still dedupes, user can refresh
    }

    // 3) Copy + open Telegram share
    const copied = await copyToClipboard(shareUrl);
    if (gateNote) gateNote.textContent = copied
      ? "Copied your invite link ✅ Opening share…"
      : "Opening share…";

    const tgShare = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}`;
    window.open(tgShare, "_blank", "noopener,noreferrer");

    // 4) Refresh status (so progress updates after share)
    try {
      const fresh = await getStatus(slug, visitorId);
      setProgress(Number(fresh.invites_count ?? 0), Number(fresh.invites_needed ?? 0));
      if (fresh.unlocked) {
        if (gateNote) gateNote.textContent = "Unlocked ✅ Loading…";
        showFeed(slug);
        return;
      }
    } catch {}

    shareBtn.disabled = false;
  };
}

document.addEventListener("DOMContentLoaded", main);
