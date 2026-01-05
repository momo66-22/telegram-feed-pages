/* Telegram-style feed (NEW) */

const CONFIG = {
  channelTitle: "MEDIA",                  // header title (ALL CAPS)
  defaultGroupTitle: "Media",             // label shown on every post bubble (top-left)
  avatarUrl: "https://picsum.photos/200", // replace with your avatar image URL
  fallbackBackUrl: "/",            // used if there's no browser history
  reactions: ["❤", "👍", "🔥"],
};

const feedEl = document.getElementById("feed");
const loadingEl = document.getElementById("loading");
const channelTitleEl = document.getElementById("channelTitle");
const avatarImgEl = document.getElementById("avatarImg");
const backBtn = document.getElementById("backBtn");

function applyHeader() {
  if (channelTitleEl) channelTitleEl.textContent = CONFIG.channelTitle || "";
  if (avatarImgEl) {
    avatarImgEl.src = CONFIG.avatarUrl || "";
    avatarImgEl.alt = (CONFIG.defaultGroupTitle || "Avatar") + " avatar";
  }
}

function setBackBehavior() {
  if (!backBtn) return;
  backBtn.onclick = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = CONFIG.fallbackBackUrl || "/";
  };
}

// -----------------------
// Anonymous user identity
// -----------------------
function getUserId() {
  const key = "tg_uid";
  let id = localStorage.getItem(key);
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
  }
  return id;
}
const USER_ID = getUserId();

// -----------------------
// Live refresh (polling)
// -----------------------
// We only refresh posts that are currently on-screen to keep traffic reasonable.
const ACTIVE_POSTS = new Set();              // postIds currently intersecting viewport
const SEEN_POSTS = new Set();                // postIds that have been marked seen (safe to re-hit /views/seen fallback)
const REACTION_CONTROLLERS = new Map();      // postId -> reaction controller
const VIEW_UPDATERS = new Map();             // postId -> (views:number)=>void

const LIVE_REFRESH_MS = 4000;                // "every few seconds"
const MAX_LIVE_POSTS = 10;                   // cap per tick
let liveTimer = null;

function stopLiveRefresh() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
}

function startLiveRefresh() {
  stopLiveRefresh();

  const tick = () => refreshLive().catch(() => {});
  tick(); // run once immediately

  liveTimer = setInterval(() => {
    if (document.hidden) return; // don't waste requests in background tabs
    tick();
  }, LIVE_REFRESH_MS);
}

async function refreshLive() {
  const ids = Array.from(ACTIVE_POSTS).slice(0, MAX_LIVE_POSTS);
  if (ids.length === 0) return;

  const tasks = [];
  for (const postId of ids) {
    const rx = REACTION_CONTROLLERS.get(postId);
    if (rx) {
      tasks.push(
        apiGetReactions(postId)
          .then((data) => rx.setFromServer(data))
          .catch(() => {})
      );
    }

    const updateViews = VIEW_UPDATERS.get(postId);
    if (updateViews) {
      tasks.push(
        refreshViewsFor(postId, updateViews).catch(() => {})
      );
    }
  }

  await Promise.all(tasks);
}

async function refreshViewsFor(postId, updateViews) {
  // Prefer a read-only endpoint if you add it (recommended).
  const data = await apiGetViews(postId);
  if (data?.views != null) {
    updateViews(data.views);
    return;
  }

  // Fallback: re-call /api/views/seen ONLY for posts we've already seen
  // (should not increment again if your backend de-dupes by user_id).
  if (!SEEN_POSTS.has(postId)) return;

  const seen = await apiSeenView(postId);
  if (seen?.views != null) updateViews(seen.views);
}

// Pause/resume polling when tab visibility changes
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopLiveRefresh();
  else startLiveRefresh();
});

// -----------------------
// Number formatting (1K, 1.2K, 10.5K, 1M…)
// -----------------------
function formatCompact(n) {
  const num = Number(n || 0);
  if (!isFinite(num)) return "0";
  const abs = Math.abs(num);

  const fmt = (v, suffix) => {
    const rounded1 = Math.round(v * 10) / 10;
    if (Math.abs(rounded1 - Math.round(rounded1)) < 1e-9) return `${Math.round(rounded1)}${suffix}`;
    return `${rounded1}${suffix}`;
  };

  if (abs < 1000) return String(num);
  if (abs < 100_000) return fmt(num / 1000, "K"); // 1200 -> 1.2K, 10500 -> 10.5K
  if (abs < 1_000_000) return `${Math.round(num / 1000)}K`; // 100000 -> 100K
  if (abs < 10_000_000) return fmt(num / 1_000_000, "M");   // 1.2M
  if (abs < 1_000_000_000) return `${Math.round(num / 1_000_000)}M`;
  return fmt(num / 1_000_000_000, "B");
}

function formatTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

// -----------------------
// Captions: safe-ish text formatting
// -----------------------
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkify(s) {
  const text = escapeHtml(s);
  const urlRe = /(https?:\/\/[^\s<]+)/g;
  return text.replace(urlRe, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
}

function renderCaption(captionText) {
  return linkify(captionText).replace(/\n/g, "<br>");
}

// -----------------------
// Groups support
// -----------------------
async function loadGroups() {
  try {
    const r = await fetch("/groups.json", { cache: "no-store" });
    if (!r.ok) return [];
    const groups = await r.json();
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

function getGroupFromUrl(groups) {
  const url = new URL(location.href);
  const slug = (url.searchParams.get("g") || "").trim().toLowerCase();

  if (!slug) return { mode: "group", group: groups[0] || null };
  if (slug === "all") return { mode: "all", group: null };

  const found = groups.find((g) => (g.slug || "").toLowerCase() === slug);
  return { mode: "group", group: found || groups[0] || null };
}

function applyGroupToConfig(sel) {
  if (sel.mode === "all") {
    CONFIG.channelTitle = "ALL";
    CONFIG.defaultGroupTitle = "All";
    return;
  }
  if (!sel.group) return;

  CONFIG.channelTitle = sel.group.channelTitle || (sel.group.title || "").toUpperCase();
  CONFIG.defaultGroupTitle = sel.group.title || CONFIG.defaultGroupTitle;
  if (sel.group.avatarUrl) CONFIG.avatarUrl = sel.group.avatarUrl;
}

// -----------------------
// Collage renderer
// -----------------------
function renderCollage(media = []) {
  const items = Array.isArray(media) ? media : [];
  if (items.length === 0) return null;

  const wrap = document.createElement("div");
  wrap.className = "collage";

  // Helper to create rows with a given count split
  const makeRows = (rowCounts) => {
    let idx = 0;
    rowCounts.forEach((count) => {
      const row = document.createElement("div");
      row.className = "collage__row";
      for (let i = 0; i < count; i++) {
        const m = items[idx++];
        if (!m) break;

        const cell = document.createElement("button");
        cell.className = "collage__cell";
        cell.type = "button";

        if (m.type === "video") {
          const v = document.createElement("video");
          v.src = m.url;
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          v.className = "collage__media";
          cell.appendChild(v);
        } else {
          const img = document.createElement("img");
          img.src = m.url;
          img.alt = "";
          img.loading = "lazy";
          img.className = "collage__media";
          cell.appendChild(img);
        }

        cell.addEventListener("click", () => openLightbox(items, idx - 1));
        row.appendChild(cell);
      }
      wrap.appendChild(row);
    });
  };

  const n = items.length;

  if (n === 1) return makeRows([1]), wrap;
  if (n === 2) return makeRows([2]), wrap;
  if (n === 3) return makeRows([3]), wrap;
  if (n === 4) return makeRows([2, 2]), wrap;

  if (n === 5) return makeRows([2, 3]), wrap;
  if (n === 6) return makeRows([3, 3]), wrap;
  if (n === 7) return makeRows([2, 2, 3]), wrap;
  if (n === 8) return makeRows([2, 3, 3]), wrap;
  if (n === 9) return makeRows([3, 3, 3]), wrap;
  if (n === 10) return makeRows([3, 4, 3]), wrap;

  // Fallback
  return makeRows([3, 4, 3]), wrap;
}

// -----------------------
// Lightbox
// -----------------------
let lightboxEl = null;

function ensureLightbox() {
  if (lightboxEl) return lightboxEl;

  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `
    <div class="lightbox__backdrop"></div>
    <div class="lightbox__content">
      <button class="lightbox__close" type="button">✕</button>
      <div class="lightbox__stage"></div>
      <div class="lightbox__nav">
        <button class="lightbox__prev" type="button">‹</button>
        <button class="lightbox__next" type="button">›</button>
      </div>
    </div>
  `;
  document.body.appendChild(lb);

  const backdrop = lb.querySelector(".lightbox__backdrop");
  const closeBtn = lb.querySelector(".lightbox__close");

  const close = () => lb.classList.remove("lightbox--open");
  backdrop?.addEventListener("click", close);
  closeBtn?.addEventListener("click", close);

  lightboxEl = lb;
  return lb;
}

function openLightbox(items, index) {
  const lb = ensureLightbox();
  const stage = lb.querySelector(".lightbox__stage");
  const prev = lb.querySelector(".lightbox__prev");
  const next = lb.querySelector(".lightbox__next");

  let cur = index;

  const render = () => {
    const m = items[cur];
    if (!stage || !m) return;
    stage.innerHTML = "";

    if (m.type === "video") {
      const v = document.createElement("video");
      v.src = m.url;
      v.controls = true;
      v.autoplay = true;
      v.playsInline = true;
      v.className = "lightbox__media";
      stage.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = m.url;
      img.alt = "";
      img.className = "lightbox__media";
      stage.appendChild(img);
    }
  };

  const goPrev = () => {
    cur = (cur - 1 + items.length) % items.length;
    render();
  };

  const goNext = () => {
    cur = (cur + 1) % items.length;
    render();
  };

  prev?.addEventListener("click", goPrev, { once: true });
  next?.addEventListener("click", goNext, { once: true });

  render();
  lb.classList.add("lightbox--open");
}

// -----------------------
// API helpers (no-store + timeout)
// -----------------------
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function apiGetReactions(postId) {
  const u = new URL("/api/reactions", location.origin);
  u.searchParams.set("post_id", postId);
  u.searchParams.set("user_id", USER_ID);

  const res = await fetchWithTimeout(u.toString(), {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }, 8000);

  if (!res.ok) throw new Error("reactions GET failed");
  return res.json();
}

async function apiToggleReaction(postId, emoji) {
  const res = await fetchWithTimeout("/api/reactions/toggle", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji, user_id: USER_ID }),
  }, 8000);

  if (!res.ok) throw new Error("reactions toggle failed");
  return res.json();
}

async function apiGetViews(postId) {
  // Optional endpoint: functions/api/views/index.js (GET /api/views?post_id=...)
  const u = new URL("/api/views", location.origin);
  u.searchParams.set("post_id", postId);

  const res = await fetchWithTimeout(u.toString(), {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }, 8000);

  if (!res.ok) return null;
  return res.json();
}

async function apiSeenView(postId) {
  const res = await fetchWithTimeout("/api/views/seen", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, user_id: USER_ID }),
  }, 8000);

  if (!res.ok) return null;
  return res.json();
}

// -----------------------
// Reactions controller (stronger anti-spam)
// - optimistic UI (instant)
// - never overlaps requests per post
// - coalesces spam clicks into a "desired state"
// - keeps UI consistent while responses arrive
// -----------------------
function createReactionController(postId, pillEls) {
  // Build base counts from CONFIG.reactions so it's always in sync
  const baseCounts = Object.fromEntries(CONFIG.reactions.map((e) => [e, 0]));

  let serverCounts = { ...baseCounts };
  let serverMine = new Set();

  // parity: 0 = no pending toggle, 1 = pending toggle (odd number of clicks)
  const parity = new Map(CONFIG.reactions.map((e) => [e, 0]));

  let inflight = false;

  function sanitizeServer(data) {
    const c = data?.counts || {};
    const m = data?.mine || [];

    const nextCounts = { ...baseCounts };
    for (const e of Object.keys(baseCounts)) {
      const v = Number(c?.[e] ?? 0);
      nextCounts[e] = Number.isFinite(v) ? v : 0;
    }

    const nextMine = new Set();
    if (Array.isArray(m)) {
      for (const e of m) if (baseCounts[e] !== undefined) nextMine.add(e);
    }

    serverCounts = nextCounts;
    serverMine = nextMine;
  }

  function buildEffectiveState() {
    const counts = { ...serverCounts };
    const mine = new Set(serverMine);

    for (const e of baseCounts ? Object.keys(baseCounts) : CONFIG.reactions) {
      if ((parity.get(e) || 0) % 2 === 0) continue;

      // apply one toggle on top of server truth
      if (mine.has(e)) {
        mine.delete(e);
        counts[e] = Math.max(0, Number(counts[e] || 0) - 1);
      } else {
        mine.add(e);
        counts[e] = Number(counts[e] || 0) + 1;
      }
    }

    return { counts, mine };
  }

  function syncUI() {
    const effective = buildEffectiveState();
    const pending = new Set();
    for (const [e, v] of parity.entries()) if (v % 2 === 1) pending.add(e);
    applyReactionsState(pillEls, effective, pending, inflight);
  }

  function setFromServer(data) {
    sanitizeServer(data);
    syncUI();
  }

  async function flush() {
    if (inflight) return;

    // which emojis have odd parity?
    const pendingEmojis = [];
    for (const [e, v] of parity.entries()) {
      if (v % 2 === 1) pendingEmojis.push(e);
    }
    if (pendingEmojis.length === 0) return;

    inflight = true;
    syncUI();

    try {
      // Send toggles sequentially so server state stays consistent.
      for (const e of pendingEmojis) {
        const data = await apiToggleReaction(postId, e);
        // After each response, reset parity for that emoji (we "paid off" one pending toggle)
        parity.set(e, 0);
        sanitizeServer(data);
        syncUI();
      }
    } catch (err) {
      console.warn(err);
      // On failure, snap to truth and clear pending.
      try {
        const fresh = await apiGetReactions(postId);
        for (const e of parity.keys()) parity.set(e, 0);
        setFromServer(fresh);
      } catch {}
    } finally {
      inflight = false;
      syncUI();

      // If user spam-clicked while inflight, there may be new pending toggles:
      const stillPending = Array.from(parity.values()).some((v) => v % 2 === 1);
      if (stillPending) flush();
    }
  }

  function click(emoji) {
    // flip parity
    parity.set(emoji, (parity.get(emoji) || 0) + 1);
    syncUI();
    flush();
  }

  return { click, setFromServer, enqueue: click };
}

// -----------------------
// Render post bubble
// -----------------------
function makePostEl(post) {
  const postId = post.post_id;
  const groupTitle = post.group_title || CONFIG.defaultGroupTitle;
  const createdAt = post.created_at || Date.now();

  const bubble = document.createElement("article");
  bubble.className = "post";
  bubble.dataset.postId = postId;

  const inner = document.createElement("div");
  inner.className = "post__inner";

  const gt = document.createElement("div");
  gt.className = "post__group";
  gt.textContent = groupTitle;
  inner.appendChild(gt);

  const collage = renderCollage(post.media || []);
  if (collage) inner.appendChild(collage);

  const caption = document.createElement("div");
  caption.className = "post__caption";
  caption.innerHTML = renderCaption(post.caption_text || "");
  inner.appendChild(caption);

  const reactions = document.createElement("div");
  reactions.className = "reactions";

  const pillEls = new Map();
  const rx = createReactionController(postId, pillEls);

  // register for live refresh
  REACTION_CONTROLLERS.set(postId, rx);

  CONFIG.reactions.forEach((emoji) => {
    const pill = document.createElement("button");
    pill.className = "pill";
    pill.type = "button";
    pill.dataset.emoji = emoji;
    pill.innerHTML = `<span class="emoji">${emoji}</span><span class="count">0</span>`;

    // IMPORTANT: don’t fire overlapping requests.
    // We queue them per-post + update UI instantly.
    pill.addEventListener("click", () => {
      rx.enqueue(emoji);
    });

    pillEls.set(emoji, pill);
    reactions.appendChild(pill);
  });
  inner.appendChild(reactions);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML =
    `<span class="eye">👁</span>` +
    `<span class="views">${formatCompact(post.views || 0)}</span>` +
    `<span class="sep"></span>` +
    `<span class="time">${formatTime(createdAt)}</span>`;
  inner.appendChild(meta);

  bubble.appendChild(inner);

  // Fetch & apply reactions (server truth)
  apiGetReactions(postId)
    .then((data) => rx.setFromServer(data))
    .catch(() => {});

  // View tracking
  bubble._seen = false;
  bubble._updateViews = (v) => {
    const el = bubble.querySelector(".views");
    if (el) el.textContent = formatCompact(v);
  };

  VIEW_UPDATERS.set(postId, bubble._updateViews);

  return bubble;
}

function applyReactionsState(pillEls, data, pending = new Set(), inflight = false) {
  const counts = data?.counts || {};
  const mine = new Set(data?.mine || []);

  for (const [emoji, pill] of pillEls.entries()) {
    const c = counts[emoji] ?? 0;
    const countEl = pill.querySelector(".count");
    if (countEl) countEl.textContent = formatCompact(c);

    if (mine.has(emoji)) pill.classList.add("pill--selected");
    else pill.classList.remove("pill--selected");

    // Optional: if you add CSS later, these will show "pending" state
    if (pending.has(emoji)) pill.classList.add("pill--pending");
    else pill.classList.remove("pill--pending");

    if (inflight) pill.classList.add("pill--inflight");
    else pill.classList.remove("pill--inflight");
  }
}

// -----------------------
// Load posts (Option A or B both produce posts.json)
// -----------------------
function assetUrl(path) {
  // Allows hosting under subpaths without breaking fetches
  const base = document.querySelector("base")?.href || location.origin + "/";
  return new URL(path, base).toString();
}

async function loadPosts() {
  const res = await fetch(assetUrl("posts.json") + `?cb=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("posts.json missing");
  const posts = await res.json();
  posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return posts;
}

// -----------------------
// View observer (+ live-refresh visibility tracking)
// -----------------------
const io = new IntersectionObserver(
  async (entries) => {
    for (const e of entries) {
      const el = e.target;
      const postId = el?.dataset?.postId;

      // Track what's currently on-screen (for live refresh polling)
      if (postId) {
        if (e.isIntersecting) ACTIVE_POSTS.add(postId);
        else ACTIVE_POSTS.delete(postId);
      }

      // Only count a view when the post is at least 50% visible
      if (!e.isIntersecting || e.intersectionRatio < 0.5) continue;

      if (el._seen) continue;
      el._seen = true;

      if (!postId) continue;
      SEEN_POSTS.add(postId);

      const data = await apiSeenView(postId);
      if (data?.views != null) el._updateViews(data.views);
    }
  },
  { threshold: [0, 0.5] }
);

// -----------------------
// Main
// -----------------------
async function main() {
  try {
    // Load groups and select one based on ?g=
    const groups = await loadGroups();
    const sel = getGroupFromUrl(groups);
    applyGroupToConfig(sel);

    // Apply header/back after CONFIG updates
    applyHeader();
    setBackBehavior();

    // Load posts
    let posts = await loadPosts();

    // Filter by group (unless "all")
    if (sel.mode === "group" && sel.slug) {
      const slug = String(sel.slug).toLowerCase();
      const title = String(sel.group?.title || CONFIG.defaultGroupTitle || "").toLowerCase();

      posts = posts.filter((p) => {
        const pSlug = String(p.group_slug || "").toLowerCase();
        const pTitle = String(p.group_title || "").toLowerCase();

        // Prefer strict slug match; fallback to title match for older posts
        if (pSlug) return pSlug === slug;
        return !!title && pTitle === title;
      });
    }

    // Render
    loadingEl?.remove();
    const frag = document.createDocumentFragment();
    for (const post of posts) {
      frag.appendChild(makePostEl(post));
    }
    feedEl.appendChild(frag);

    // Attach view observer after render
    document.querySelectorAll(".post").forEach((el) => io.observe(el));

    // Live refresh (reactions + views) for on-screen posts
    startLiveRefresh();
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.textContent = "Missing posts.json or build failed. Run npm run build.";
  }
}

main();
