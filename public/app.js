/* global window, document */

(() => {
  // -----------------------
  // Config
  // -----------------------
  const EMOJIS = ["❤", "👍", "🔥"];
  const USER_ID_KEY = "tgfeed:user_id:v1";

  // -----------------------
  // Elements
  // -----------------------
  const els = {
    app: document.getElementById("app"),
    topbar: document.getElementById("topbar"),
    backBtn: document.getElementById("backBtn"),
    pageTitle: document.getElementById("pageTitle"),
    avatar: document.getElementById("avatar"),
    feed: document.getElementById("feed"),
    empty: document.getElementById("empty"),
    loader: document.getElementById("loader"),
    lightbox: document.getElementById("lightbox"),
    lbBackdrop: document.getElementById("lbBackdrop"),
    lbClose: document.getElementById("lbClose"),
    lbPrev: document.getElementById("lbPrev"),
    lbNext: document.getElementById("lbNext"),
    lbCount: document.getElementById("lbCount"),
    lbMedia: document.getElementById("lbMedia"),
  };

  // -----------------------
  // Utilities
  // -----------------------
  function qs(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setQS(params) {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined || v === "") url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.pushState({}, "", url.toString());
  }

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      const h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, "0");
      const ampm = h >= 12 ? "PM" : "AM";
      const hh = ((h + 11) % 12) + 1;
      return `${hh}:${m} ${ampm}`;
    } catch {
      return "";
    }
  }

  function formatCompact(n) {
    const num = Number(n) || 0;
    if (num < 1000) return String(num);
    if (num < 1_000_000) return `${(num / 1000).toFixed(num >= 10_000 ? 0 : 1)}k`.replace(".0k", "k");
    return `${(num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1)}m`.replace(".0m", "m");
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function getOrCreateUserId() {
    const existing = localStorage.getItem(USER_ID_KEY);
    if (existing) return existing;

    // Stable-ish anonymous ID per browser
    const seed = `${navigator.userAgent}|${screen.width}x${screen.height}|${Date.now()}|${Math.random()}`;
    // We don't need crypto-strong here; just uniqueness.
    // We'll hash it for a clean ID.
    // Note: async hashing, but we want sync return → store a temp and refine later.
    const tmp = `u_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 24);
    localStorage.setItem(USER_ID_KEY, tmp);

    // Upgrade to sha id when ready
    sha256Hex(seed)
      .then(h => {
        const id = `u_${h.slice(0, 24)}`;
        localStorage.setItem(USER_ID_KEY, id);
      })
      .catch(() => {});

    return tmp;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // -----------------------
  // API
  // -----------------------
  async function apiGetFeed() {
    const res = await fetch("/feed.json", { cache: "no-store" });
    if (!res.ok) throw new Error("feed.json failed");
    return res.json();
  }

  async function apiGetGroups() {
    const res = await fetch("/groups.json", { cache: "no-store" });
    if (!res.ok) throw new Error("groups.json failed");
    return res.json();
  }

  async function apiGetReactions(postId) {
    const userId = getOrCreateUserId();
    const res = await fetch(`/api/reactions?post_id=${encodeURIComponent(postId)}&user_id=${encodeURIComponent(userId)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("reactions get failed");
    return res.json();
  }

  async function apiToggleReaction(postId, emoji) {
    const userId = getOrCreateUserId();
    const res = await fetch("/api/reactions/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: postId, user_id: userId, emoji }),
    });
    if (!res.ok) throw new Error("reactions toggle failed");
    return res.json();
  }

  async function apiSeen(postId) {
    // Optional endpoint (if you have it)
    try {
      await fetch("/api/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId }),
      });
    } catch {
      // ignore
    }
  }

  // -----------------------
  // Reactions helpers
  // -----------------------
  function applyReactionsState(pillEls, data) {
    const counts = data?.counts || {};
    const mine = new Set(data?.mine || []);

    for (const [emoji, pill] of pillEls.entries()) {
      const c = Number(counts[emoji] ?? 0) || 0;

      // Store raw values so we can do quick "optimistic" UI updates on click.
      pill.dataset.count = String(c);
      pill.dataset.selected = mine.has(emoji) ? "1" : "0";

      pill.querySelector(".count").textContent = formatCompact(c);

      if (mine.has(emoji)) pill.classList.add("pill--selected");
      else pill.classList.remove("pill--selected");
    }
  }

  function setReactionsDisabled(pillEls, disabled) {
    for (const pill of pillEls.values()) {
      pill.disabled = disabled;
      pill.classList.toggle("pill--busy", disabled);
    }
  }

  function optimisticToggleReactionUI(pillEls, emoji) {
    const pill = pillEls.get(emoji);
    if (!pill) return;

    const wasSelected = pill.classList.contains("pill--selected");
    const cur = Number(pill.dataset.count || "0") || 0;
    const nextSelected = !wasSelected;
    const next = Math.max(0, cur + (nextSelected ? 1 : -1));

    pill.dataset.count = String(next);
    pill.dataset.selected = nextSelected ? "1" : "0";
    pill.querySelector(".count").textContent = formatCompact(next);
    pill.classList.toggle("pill--selected", nextSelected);
  }

  // -----------------------
  // Lightbox
  // -----------------------
  let lbState = {
    items: [],
    index: 0,
  };

  function lbOpen(items, index) {
    lbState.items = items;
    lbState.index = index;
    renderLightbox();
    els.lightbox?.classList.add("open");
    document.body.classList.add("no-scroll");
  }

  function lbClose() {
    els.lightbox?.classList.remove("open");
    document.body.classList.remove("no-scroll");
  }

  function lbPrev() {
    if (!lbState.items.length) return;
    lbState.index = (lbState.index - 1 + lbState.items.length) % lbState.items.length;
    renderLightbox();
  }

  function lbNext() {
    if (!lbState.items.length) return;
    lbState.index = (lbState.index + 1) % lbState.items.length;
    renderLightbox();
  }

  function renderLightbox() {
    const { items, index } = lbState;
    const cur = items[index];
    if (!cur) return;

    if (els.lbCount) els.lbCount.textContent = `${index + 1}/${items.length}`;
    if (!els.lbMedia) return;

    els.lbMedia.innerHTML = "";

    if (cur.type === "video") {
      const v = document.createElement("video");
      v.src = cur.url;
      v.controls = true;
      v.playsInline = true;
      v.autoplay = true;
      v.className = "lb-video";
      els.lbMedia.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = cur.url;
      img.alt = "";
      img.className = "lb-img";
      els.lbMedia.appendChild(img);
    }
  }

  // -----------------------
  // Rendering
  // -----------------------
  async function makePostEl(post) {
    const postEl = document.createElement("article");
    postEl.className = "post";

    const header = document.createElement("div");
    header.className = "post__header";

    const groupTitle = document.createElement("div");
    groupTitle.className = "post__group";
    groupTitle.textContent = post.group_title || "Media";

    const time = document.createElement("div");
    time.className = "post__time";
    time.textContent = formatTime(post.timestamp || Date.now());

    header.appendChild(groupTitle);
    header.appendChild(time);

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "post__media";

    const items = (post.media || []).map(m => ({
      type: m.type || "image",
      url: m.url,
      thumb: m.thumb || m.url,
    }));

    // Simple collage grid (your CSS controls exact look)
    items.forEach((m, idx) => {
      const tile = document.createElement("button");
      tile.className = "tile";
      tile.type = "button";
      tile.addEventListener("click", () => lbOpen(items, idx));

      if (m.type === "video") {
        const img = document.createElement("img");
        img.src = m.thumb || m.url;
        img.alt = "";
        tile.appendChild(img);

        const play = document.createElement("div");
        play.className = "tile__play";
        play.textContent = "▶";
        tile.appendChild(play);
      } else {
        const img = document.createElement("img");
        img.src = m.url;
        img.alt = "";
        tile.appendChild(img);
      }

      mediaWrap.appendChild(tile);
    });

    const caption = document.createElement("div");
    caption.className = "post__caption";
    caption.textContent = post.caption || "";

    const footer = document.createElement("div");
    footer.className = "post__footer";

    const reactions = document.createElement("div");
    reactions.className = "reactions";

    const pillEls = new Map();

    // Per-post lock so we never run 2 toggles at the same time for the same post.
    // (Prevents race conditions + "double counting" when you spam-click.)
    let reactionsBusy = false;
    let queuedEmoji = null;

    async function runReactionToggle(clickedEmoji) {
      reactionsBusy = true;
      setReactionsDisabled(pillEls, true);

      // Make it feel instant (server will correct if needed)
      optimisticToggleReactionUI(pillEls, clickedEmoji);

      try {
        const data = await apiToggleReaction(post.id, clickedEmoji);
        applyReactionsState(pillEls, data);
      } catch (e) {
        console.warn("toggle failed", e);
        // Re-sync from server so UI doesn't get stuck on a wrong number
        try {
          const fresh = await apiGetReactions(post.id);
          applyReactionsState(pillEls, fresh);
        } catch {}
      } finally {
        setReactionsDisabled(pillEls, false);
        reactionsBusy = false;

        // If user clicked again while busy, run exactly one more toggle (latest click wins)
        if (queuedEmoji) {
          const next = queuedEmoji;
          queuedEmoji = null;
          runReactionToggle(next);
        }
      }
    }

    for (const emoji of EMOJIS) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill";

      const e = document.createElement("span");
      e.className = "emoji";
      e.textContent = emoji;

      const c = document.createElement("span");
      c.className = "count";
      c.textContent = "0";

      pill.appendChild(e);
      pill.appendChild(c);

      pill.addEventListener("click", () => {
        if (reactionsBusy) {
          queuedEmoji = emoji;
          return;
        }
        runReactionToggle(emoji);
      });

      pillEls.set(emoji, pill);
      reactions.appendChild(pill);
    }

    footer.appendChild(reactions);

    postEl.appendChild(header);
    postEl.appendChild(mediaWrap);
    postEl.appendChild(caption);
    postEl.appendChild(footer);

    // Load initial reactions state (best-effort)
    try {
      const data = await apiGetReactions(post.id);
      applyReactionsState(pillEls, data);
    } catch (e) {
      console.warn("reactions init failed", e);
    }

    // Seen/analytics (optional)
    apiSeen(post.id);

    return postEl;
  }

  async function renderFeed(posts) {
    els.feed.innerHTML = "";

    if (!posts.length) {
      els.empty?.classList.remove("hidden");
      return;
    }
    els.empty?.classList.add("hidden");

    for (const post of posts) {
      const el = await makePostEl(post);
      els.feed.appendChild(el);
    }
  }

  function setHeader(group) {
    els.pageTitle.textContent = (group?.title || "MEDIA").toUpperCase();
  }

  // -----------------------
  // Main
  // -----------------------
  async function main() {
    // Lightbox controls
    els.lbClose?.addEventListener("click", lbClose);
    els.lbBackdrop?.addEventListener("click", lbClose);
    els.lbPrev?.addEventListener("click", lbPrev);
    els.lbNext?.addEventListener("click", lbNext);

    window.addEventListener("keydown", e => {
      if (!els.lightbox?.classList.contains("open")) return;
      if (e.key === "Escape") lbClose();
      if (e.key === "ArrowLeft") lbPrev();
      if (e.key === "ArrowRight") lbNext();
    });

    els.loader?.classList.remove("hidden");

    const [groups, feed] = await Promise.all([apiGetGroups(), apiGetFeed()]);

    // determine current group by slug (?g=)
    const slug = qs("g") || "";
    const group = groups.find(g => g.slug === slug) || groups[0] || null;
    setHeader(group);

    // Filter feed by group if slug present
    let posts = Array.isArray(feed) ? feed : feed.posts || [];
    if (group?.slug) {
      posts = posts.filter(p => (p.group_slug || "") === group.slug || (p.group_title || "") === group.title);
    }

    // newest first
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    await renderFeed(posts);

    els.loader?.classList.add("hidden");
  }

  main().catch(err => {
    console.error(err);
    els.loader?.classList.add("hidden");
    els.empty?.classList.remove("hidden");
  });
})();
