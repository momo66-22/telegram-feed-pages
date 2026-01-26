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

function getSlugFromPath() {
  // "/+93OGk" -> "+93OGk"
  // "/media"  -> "media"
  const p = decodeURIComponent(location.pathname || "/");
  return (p.startsWith("/") ? p.slice(1) : p).trim();
}

function getInvFromUrl() {
  const u = new URL(location.href);
  return (u.searchParams.get("inv") || "").trim().toUpperCase();
}

function setProgress(cur, needed) {
  const fill = document.getElementById("progressFill");
  const txt = document.getElementById("progressText");
  const n = Math.max(0, Number(cur || 0));
  const m = Math.max(0, Number(needed || 0));
  const pct = m ? Math.round((n / m) * 100) : 0;
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (txt) txt.textContent = `${n}/${m}`;
}

function showFeed() {
  const gate = document.getElementById("gate");
  const feed = document.getElementById("feedPage");
  if (gate) gate.style.display = "none";
  if (feed) feed.style.display = "";

  // Load your existing feed script ONLY after unlocked
  if (!window.__FEED_LOADED) {
    window.__FEED_LOADED = true;
    const s = document.createElement("script");
    s.src = "/app.js";
    s.defer = true;
    document.body.appendChild(s);
  }
}

async function fetchGroup(slug) {
  const res = await fetch("/api/groups", { cache: "no-store" });
  const data = await res.json();
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const lc = slug.toLowerCase();
  return groups.find(g => String(g.slug_lc || "").toLowerCase() === lc) || null;
}

async function status(slug) {
  const u = new URL("/api/referrals/status", location.origin);
  u.searchParams.set("visitor_id", USER_ID);
  u.searchParams.set("group_slug", slug);
  const res = await fetch(u.toString(), { cache: "no-store" });
  return res.json();
}

async function getMyCode(slug) {
  const res = await fetch("/api/referrals/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: USER_ID, group_slug: slug })
  });
  const data = await res.json();
  if (!data.code) throw new Error("code_failed");
  return data.code;
}

async function claim(slug, creditedCode) {
  const res = await fetch("/api/referrals/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: USER_ID, group_slug: slug, credited_code: creditedCode })
  });
  return res.json();
}

function tgShareLink(url) {
  return "https://t.me/share/url?url=" + encodeURIComponent(url);
}

async function main() {
  const slug = getSlugFromPath();
  if (!slug) location.href = "/";

  const gateTitle = document.getElementById("gateTitle");
  const gateSub = document.getElementById("gateSub");
  const note = document.getElementById("gateNote");
  const shareBtn = document.getElementById("shareBtn");

  // Track who referred this visitor (stored per group)
  const creditedCode = getInvFromUrl();
  const refKey = `tg_ref_${slug.toLowerCase()}`;
  if (creditedCode && /^[A-Z0-9]{5}$/.test(creditedCode)) {
    localStorage.setItem(refKey, creditedCode);
  }

  const group = await fetchGroup(slug);
  if (!group) {
    if (gateTitle) gateTitle.textContent = "Group not found";
    if (gateSub) gateSub.textContent = "This group slug is not in your database.";
    if (shareBtn) shareBtn.disabled = true;
    return;
  }

  document.title = group.title || "Group";
  if (gateTitle) gateTitle.textContent = group.title || group.slug;
  if (gateSub) gateSub.textContent = group.type === "free" ? "Free group" : "Invite people to unlock access.";

  // Free group? show feed immediately
  if (group.type === "free") {
    showFeed();
    return;
  }

  // Invite group: load status
  let st = await status(slug);
  setProgress(st.invite_count || 0, st.group?.invites_needed || group.invites_needed || 0);

  if (st.unlocked) {
    showFeed();
    return;
  }

  // Share click:
  shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    try {
      // 1) Ensure this visitor has THEIR OWN code (generated on Share)
      const myCode = await getMyCode(slug);

      // 2) If they arrived via someone else's ?inv=, credit that inviter ONLY NOW (first share)
      const ref = localStorage.getItem(refKey) || "";
      if (ref && /^[A-Z0-9]{5}$/.test(ref)) {
        await claim(slug, ref);
        // After claiming once, remove it so it can’t be claimed again from this browser
        // (server already dedupes too)
        localStorage.removeItem(refKey);
      }

      // 3) Open Telegram share with the correct link format:
      const shareUrl = `${location.origin}/${slug}?inv=${myCode}`;
      window.open(tgShareLink(shareUrl), "_blank", "noopener,noreferrer");

      // 4) Refresh status UI
      st = await status(slug);
      setProgress(st.invite_count || 0, st.group?.invites_needed || group.invites_needed || 0);

      if (st.unlocked) {
        if (note) note.textContent = "Unlocked ✅";
        showFeed();
      } else {
        if (note) note.textContent = `Your link: /${slug}?inv=${myCode}`;
      }
    } catch (e) {
      if (note) note.textContent = "Share failed. Try again.";
    } finally {
      shareBtn.disabled = false;
    }
  });
}

main().catch(() => {});
