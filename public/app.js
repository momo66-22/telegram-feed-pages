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
// Caption rendering (safe, minimal)
// - escapes HTML
// - supports **bold**, *italic*, `code`, and [text](url)
// -----------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
function renderCaption(md) {
  const s = escapeHtml(md || "");
  let out = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  out = out.replace(/\n/g, "<br>");
  return out;
}

// -----------------------
// Groups support
// -----------------------
function assetUrl(path) {
  // Relative to current page (works for /, /public/index.html in Live Server, etc.)
  return new URL(path, window.location.href).toString();
}

async function loadGroups() {
  try {
    const r = await fetch(assetUrl("groups.json"), { cache: "no-store" });
    if (!r.ok) return [];
    const groups = await r.json();
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

function getGroupFromUrl(groups) {
  const url = new URL(location.href);
  const slug = (url.searchParams.get("g") || "").trim();

  if (!slug) return { mode: "group", group: groups[0] || null, slug: groups[0]?.slug || "" };
  if (slug.toLowerCase() === "all") return { mode: "all", group: null, slug: "all" };

  const found = groups.find((g) => String(g.slug || "").toLowerCase() === slug.toLowerCase());
  return { mode: "group", group: found || groups[0] || null, slug: (found || groups[0] || {}).slug || "" };
}

function applyGroupToConfig(sel) {
  // Default behavior if no groups.json or no match
  if (sel.mode === "all") {
    CONFIG.channelTitle = "ALL";
    CONFIG.defaultGroupTitle = "All";
    // accent stays whatever CSS default is
    return;
  }
  if (!sel.group) return;

  CONFIG.channelTitle = (sel.group.channelTitle || sel.group.title || CONFIG.channelTitle || "").toUpperCase();
  CONFIG.defaultGroupTitle = sel.group.title || CONFIG.defaultGroupTitle;
  if (sel.group.avatarUrl) CONFIG.avatarUrl = sel.group.avatarUrl;
  if (sel.group.accent) document.documentElement.style.setProperty("--accent", sel.group.accent);
}

// -----------------------
// Lightbox viewer (fixed: no-scroll + arrows + swipe)
// -----------------------
const lightbox = document.getElementById("lightbox");
const lbBackdrop = document.getElementById("lbBackdrop");
const lbClose = document.getElementById("lbClose");
const lbPrev = document.getElementById("lbPrev");
const lbNext = document.getElementById("lbNext");
const lbContent = document.getElementById("lbContent");
const lbCaption = document.getElementById("lbCaption");

const LB_STATE = { media: [], index: 0 };

let _lockedScrollY = 0;

function lockBodyScroll() {
  _lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.classList.add("no-scroll");
  document.body.style.top = `-${_lockedScrollY}px`;
}
function unlockBodyScroll() {
  if (!document.body.classList.contains("no-scroll")) return;
  document.body.classList.remove("no-scroll");
  document.body.style.top = "";
  window.scrollTo(0, _lockedScrollY);
}

function renderLightbox() {
  const item = LB_STATE.media[LB_STATE.index];
  lbContent.innerHTML = "";
  if (lbCaption) lbCaption.textContent = "";

  if (!item) return;

  const src = item.url || item.thumb_url;
  if (!src) {
    lbContent.innerHTML = `<div style="padding:16px;color:#fff;opacity:.9">Missing media URL</div>`;
    return;
  }

  if (item.type === "video") {
    const v = document.createElement("video");
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = src;
    if (item.thumb_url) v.poster = item.thumb_url;

    v.addEventListener("error", () => {
      lbContent.innerHTML = `<div style="padding:16px;color:#fff;opacity:.9">Couldn’t load this video.</div>`;
    });

    lbContent.appendChild(v);
  } else {
    const img = document.createElement("img");
    img.alt = item.caption || "";
    img.loading = "eager";
    img.decoding = "async";
    img.src = src;

    img.addEventListener("error", () => {
      lbContent.innerHTML = `<div style="padding:16px;color:#fff;opacity:.9">Couldn’t load this image.</div>`;
    });

    lbContent.appendChild(img);
  }

  if (lbCaption) lbCaption.textContent = item.caption || "";

  const hasMany = LB_STATE.media.length > 1;
  if (lbPrev) lbPrev.style.display = hasMany ? "" : "none";
  if (lbNext) lbNext.style.display = hasMany ? "" : "none";
}

function openLightbox(media, index = 0) {
  if (!Array.isArray(media) || media.length === 0) return;

  LB_STATE.media = media;
  LB_STATE.index = Math.max(0, Math.min(index, media.length - 1));

  renderLightbox();
  lightbox.setAttribute("aria-hidden", "false");
  lockBodyScroll();
  lbClose?.focus?.();
}

function closeLightbox() {
  lightbox.setAttribute("aria-hidden", "true");
  lbContent.innerHTML = "";
  if (lbCaption) lbCaption.textContent = "";
  unlockBodyScroll();
}

function step(dir) {
  const m = LB_STATE.media;
  if (!m || m.length === 0) return;
  LB_STATE.index = (LB_STATE.index + dir + m.length) % m.length;
  renderLightbox();
}

lbClose?.addEventListener("click", closeLightbox);
lbBackdrop?.addEventListener("click", closeLightbox);
lbPrev?.addEventListener("click", () => step(-1));
lbNext?.addEventListener("click", () => step(1));

document.addEventListener("keydown", (e) => {
  if (lightbox.getAttribute("aria-hidden") === "true") return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

// Swipe support
let swipe = { active: false, startX: 0, startY: 0 };

lbContent?.addEventListener("pointerdown", (e) => {
  if (lightbox.getAttribute("aria-hidden") === "true") return;
  swipe.active = true;
  swipe.startX = e.clientX;
  swipe.startY = e.clientY;
  try { lbContent.setPointerCapture(e.pointerId); } catch {}
});

lbContent?.addEventListener("pointerup", (e) => {
  if (!swipe.active) return;
  swipe.active = false;

  const dx = e.clientX - swipe.startX;
  const dy = e.clientY - swipe.startY;

  // swipe left/right only if it's mostly horizontal
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
    step(dx < 0 ? 1 : -1);
  }
});

lbContent?.addEventListener("pointercancel", () => { swipe.active = false; });

// -----------------------
// Collage templates (1–10)
// -----------------------
function tileFor(item, onClick, overlayText = null) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");

  tile.addEventListener("click", onClick);
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  });

  // Use <img> in the feed for both images and video thumbs (fast).
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";

  if (item.type === "video") {
    img.src = item.thumb_url || item.url;
  } else {
    img.src = item.url;
  }
  img.alt = item.caption || "";
  tile.appendChild(img);

  if (item.type === "video") {
    const play = document.createElement("div");
    play.className = "play-badge";
    play.innerHTML = "<span>▶</span>";
    tile.appendChild(play);
  }

  if (overlayText) {
    const more = document.createElement("div");
    more.className = "more-badge";
    more.textContent = overlayText;
    tile.appendChild(more);
  }

  return tile;
}

function renderCollage(media) {
  if (!Array.isArray(media) || media.length === 0) return null;

  const full = media.slice(0, 10);
  const overflow = media.length - full.length;

  const openAt = (idx) => openLightbox(media, idx);
  const n = full.length;

  const makeRows = (rows) => {
    const collage = document.createElement("div");
    collage.className = "collage";
    let cursor = 0;

    rows.forEach((cols) => {
      const row = document.createElement("div");
      row.className = `collage-row cols-${cols}`;

      for (let i = 0; i < cols; i++) {
        const item = full[cursor];
        if (!item) break;

        const isLastTile = (cursor === full.length - 1) && overflow > 0;
        const overlay = isLastTile ? `+${overflow}` : null;

        row.appendChild(tileFor(item, () => openAt(cursor), overlay));
        cursor++;
      }
      collage.appendChild(row);
    });

    return collage;
  };

  if (n === 1) {
    const collage = document.createElement("div");
    collage.className = "collage";
    collage.style.height = "auto";

    const row = document.createElement("div");
    row.className = "collage-row cols-1";
    row.style.gridTemplateColumns = "1fr";
    row.style.height = "var(--collage-h)";

    row.appendChild(tileFor(full[0], () => openAt(0)));
    collage.appendChild(row);
    return collage;
  }

  if (n === 2) return makeRows([2]);

  if (n === 3 || n === 4) {
    const wrap = document.createElement("div");
    wrap.className = "collage-split";

    wrap.appendChild(tileFor(full[0], () => openAt(0)));

    const right = document.createElement("div");
    right.className = "collage-split__right";
    right.style.gridTemplateRows = `repeat(${n - 1}, 1fr)`;

    for (let i = 1; i < n; i++) {
      const isLastTile = (i === n - 1) && overflow > 0;
      const overlay = isLastTile ? `+${overflow}` : null;
      right.appendChild(tileFor(full[i], () => openAt(i), overlay));
    }

    wrap.appendChild(right);
    return wrap;
  }

  if (n === 5) return makeRows([2, 3]);
  if (n === 6) return makeRows([3, 3]);
  if (n === 7) return makeRows([2, 2, 3]);
  if (n === 8) return makeRows([2, 3, 3]);
  if (n === 9) return makeRows([3, 3, 3]);
  if (n === 10) return makeRows([3, 4, 3]);

  // Fallback
  return makeRows([3, 4, 3]);
}

// -----------------------
// API helpers
// -----------------------
async function apiGetReactions(postId) {
  const u = new URL("/api/reactions", location.origin);
  u.searchParams.set("post_id", postId);
  u.searchParams.set("user_id", USER_ID);
  const res = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("reactions GET failed");
  return res.json();
}

async function apiToggleReaction(postId, emoji) {
  const res = await fetch("/api/reactions/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, emoji, user_id: USER_ID }),
  });
  if (!res.ok) throw new Error("reactions toggle failed");
  return res.json();
}

async function apiSeenView(postId) {
  const res = await fetch("/api/views/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: postId, user_id: USER_ID }),
  });
  if (!res.ok) return null;
  return res.json();
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
  CONFIG.reactions.forEach((emoji) => {
    const pill = document.createElement("button");
    pill.className = "pill";
    pill.type = "button";
    pill.dataset.emoji = emoji;
    pill.innerHTML = `<span class="emoji">${emoji}</span><span class="count">0</span>`;

    pill.addEventListener("click", async () => {
      try {
        pill.disabled = true;
        const data = await apiToggleReaction(postId, emoji);
        applyReactionsState(pillEls, data);
      } catch (e) {
        console.warn(e);
      } finally {
        pill.disabled = false;
      }
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

  // Fetch & apply reactions
  apiGetReactions(postId).then((data) => applyReactionsState(pillEls, data)).catch(() => {});

  // View tracking
  bubble._seen = false;
  bubble._updateViews = (v) => {
    const el = bubble.querySelector(".views");
    if (el) el.textContent = formatCompact(v);
  };

  return bubble;
}

function applyReactionsState(pillEls, data) {
  const counts = data?.counts || {};
  const mine = new Set(data?.mine || []);
  for (const [emoji, pill] of pillEls.entries()) {
    const c = counts[emoji] ?? 0;
    pill.querySelector(".count").textContent = formatCompact(c);
    if (mine.has(emoji)) pill.classList.add("pill--selected");
    else pill.classList.remove("pill--selected");
  }
}

// -----------------------
// Load posts (Option A or B both produce posts.json)
// -----------------------
async function loadPosts() {
  const res = await fetch(assetUrl("posts.json") + `?cb=${Date.now()}`);
  if (!res.ok) throw new Error("posts.json missing");
  const posts = await res.json();
  posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return posts;
}

// -----------------------
// View observer
// -----------------------
const io = new IntersectionObserver(
  async (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      if (el._seen) continue;
      el._seen = true;

      const postId = el.dataset.postId;
      const data = await apiSeenView(postId);
      if (data?.views != null) el._updateViews(data.views);
    }
  },
  { threshold: 0.5 }
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
  } catch (err) {
    console.error(err);
    if (loadingEl) loadingEl.textContent = "Missing posts.json or build failed. Run npm run build.";
  }
}

main();
