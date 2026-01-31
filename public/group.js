function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------- helpers ----------
function $(id) {
  return document.getElementById(id);
}

function encodePathSegmentKeepPlus(s) {
  return encodeURIComponent(String(s || "")).replace(/%2B/gi, "+");
}

function getSlugFromPath() {
  const raw = decodeURIComponent(location.pathname || "/");
  const parts = raw.split("/").filter(Boolean);

  // New route: /joinchat/<slug>
  if (parts[0] === "joinchat") return (parts[1] || "").trim();

  // Legacy route: /<slug>
  return (parts[0] || "").trim();
}

function getInvFromUrl() {
  return new URL(location.href).searchParams.get("inv") || "";
}

function getOrCreateVisitorId() {
  const key = "vid_v1";
  let v = "";
  try {
    v = localStorage.getItem(key) || "";
  } catch {}
  if (!v) {
    v = crypto.randomUUID();
    try {
      localStorage.setItem(key, v);
    } catch {}
  }
  return v;
}

const USER_ID = getOrCreateVisitorId();

// ---------- DOM ----------
const gate = $("gate");
const feedPage = $("feedPage");

const gateTitle = $("gateTitle");
const gateSub = $("gateSub");
const gateNote = $("gateNote");

const progressFill = $("progressFill");
const progressText = $("progressText");

const shareBtn = $("shareBtn");

// ---------- state ----------
let currentGroup = null;
let pollTimer = null;
let appLoaded = false;

// ---------- API ----------
async function apiGet(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fetchAllGroups() {
  const r = await apiGet("/api/groups");
  if (!r.ok) throw new Error("groups_fetch_failed");
  return r.data.groups || [];
}

function setProgress(current, needed) {
  const n = Math.max(0, Number(needed || 0));
  const c = Math.max(0, Number(current || 0));
  progressText.textContent = `${Math.min(c, n)}/${n}`;
  const pct = n ? Math.min(100, Math.round((c / n) * 100)) : 0;
  progressFill.style.width = `${pct}%`;
}

function markUnlockedLocally(slug) {
  try {
    const key = "unlocked_groups_v1";
    const raw = localStorage.getItem(key) || "[]";
    const arr = JSON.parse(raw);
    const set = new Set(arr.map((x) => String(x).toLowerCase()));
    set.add(String(slug || "").toLowerCase());
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

// ---------- view ----------
function showGate() {
  if (feedPage) feedPage.style.display = "none";
  if (gate) gate.style.display = "";
}

function loadAppOnce() {
  if (appLoaded) return;
  appLoaded = true;

  const s = document.createElement("script");
  s.src = "/app.js";
  s.defer = true;
  document.body.appendChild(s);
}

function showFeed() {
  if (gate) gate.style.display = "none";
  if (feedPage) feedPage.style.display = "";
  loadAppOnce();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(checkStatus, 3000);
}

// ---------- status ----------
async function checkStatus() {
  if (!currentGroup) return;

  const slug = currentGroup.slug || "";
  const r = await apiGet(`/api/referrals/status?group=${encodeURIComponent(slug)}&visitor_id=${encodeURIComponent(USER_ID)}`);
  if (!r.ok) return;

  const { invites = 0, needed = 0, unlocked = false } = r.data || {};
  setProgress(invites, needed);

  if (unlocked) {
    markUnlockedLocally(slug);
    gateNote.textContent = "Unlocked ✅";
    shareBtn.disabled = true;
    stopPolling();
    showFeed();
  }
}

// ---------- share ----------
async function ensureMyCode() {
  const slug = currentGroup.slug || "";
  const r = await apiGet(`/api/referrals/code?group=${encodeURIComponent(slug)}&visitor_id=${encodeURIComponent(USER_ID)}`);
  if (!r.ok) throw new Error("code_failed");
  return r.data.code || "";
}

async function claimIfInvPresent() {
  const inv = getInvFromUrl();
  if (!inv || !currentGroup) return;

  const slug = currentGroup.slug || "";
  await fetch("/api/referrals/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group: slug,
      visitor_id: USER_ID,
      inv,
    }),
  }).catch(() => {});
}

// ---------- init ----------
async function init() {
  showGate();

  const slug = getSlugFromPath();
  if (!slug) {
    gateTitle.textContent = "Missing group slug";
    gateSub.textContent = "Use /joinchat/<slug>";
    return;
  }

  gateTitle.textContent = "Loading…";

  const groups = await fetchAllGroups();
  const g = groups.find((x) => String(x.slug || "").toLowerCase() === String(slug).toLowerCase());

  if (!g) {
    gateTitle.textContent = "Group not found";
    gateSub.textContent = "Check the slug in D1.";
    return;
  }

  currentGroup = g;

  // Title text
  gateTitle.textContent = g.title || g.slug || "Group";
  gateSub.textContent = g.type === "free" ? "Public feed" : "Invite people to unlock.";

  // If free: show feed immediately
  if (g.type === "free") {
    showFeed();
    return;
  }

  // Locked: show gate + status
  setProgress(0, g.invites_needed || 0);

  // if user arrived via ?inv= , we wait until THEY click Share to actually give credit
  // claim endpoint is called on Share click (below), but we can also store inv now (server dedup handles anyway)
  // We'll call claim when share is clicked.
  startPolling();
}

shareBtn?.addEventListener("click", async () => {
  if (!currentGroup) return;

  try {
    shareBtn.disabled = true;
    gateNote.textContent = "Generating your invite link…";

    // If they arrived via an invite, this is where we “count” it (server deduped)
    await claimIfInvPresent();

    const myCode = await ensureMyCode();
    const slug = currentGroup.slug || "";

    const shareUrl = `${location.origin}/joinchat/${encodePathSegmentKeepPlus(slug)}?inv=${myCode}`;

    const tg = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(
      "Join this group"
    )}`;

    gateNote.textContent = "Opening share…";
    window.open(tg, "_blank", "noopener,noreferrer");

    // refresh status right away
    await checkStatus();
  } catch (e) {
    gateNote.textContent = "Share failed. Try again.";
  } finally {
    shareBtn.disabled = false;
  }
});

init().catch(() => {
  gateTitle.textContent = "Failed to load";
  gateSub.textContent = "Check /api/groups works and D1 binding exists.";
});
