function $(id){ return document.getElementById(id); }

const els = {
  groupName: $("groupName"),
  modalGroupName: $("modalGroupName"),
  subtitle: $("subtitle"),
  avatarImg: $("avatarImg"),
  joinBtn: $("joinBtn"),
  moreGroups: $("moreGroups"),
  overlay: $("overlay"),
  shareBtn: $("shareBtn"),
  skipShare: $("skipShare"),
  okBtn: $("okBtn"),
  progressFill: $("progressFill"),
  progressCount: $("progressCount"),
  pendingStatus: $("pendingStatus"),
  toast: $("toast"),
  downloadBtn: $("downloadBtn"),
};

const TELEGRAM_DOWNLOAD_URL = "https://telegram.org/apps";

// -------- UI helpers --------
function showToast(message){
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function openModal(){
  if (!els.overlay) return;
  els.overlay.classList.add("open");
  els.overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal(){
  if (!els.overlay) return;
  els.overlay.classList.remove("open");
  els.overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function slugLC(s){ return (s || "").toLowerCase(); }
function localKeyForRef(slug){ return `ref_by_${slugLC(slug)}`; }

// -------- URL parsing --------
function safeSlugFromPathOrQuery(){
  const url = new URL(window.location.href);

  // Supports both:
  // 1) /joinchat/<slug>
  // 2) /joinchat/?g=<slug>
  const parts = url.pathname.split("/").filter(Boolean); // ["joinchat","<slug>"]
  let slug = parts.length >= 2 ? parts[1] : "";
  try { slug = decodeURIComponent(slug); } catch {}

  if (!slug) slug = url.searchParams.get("g") || "";

  return slug.trim();
}

// -------- API helpers --------
async function apiGet(path){
  const res = await fetch(path, { credentials: "include" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${data?.error || ""}`.trim());
  return data;
}
async function apiPost(path, body){
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${data?.error || ""}`.trim());
  return data;
}

// -------- State --------
let GROUP = null;
let MY_CODE = null;
let STATUS = null;

// -------- Core load --------
async function loadEverything(){
  const url = new URL(window.location.href);
  const slug = safeSlugFromPathOrQuery();

  if (!slug){
    if (els.groupName) els.groupName.textContent = "Group not found";
    if (els.subtitle) els.subtitle.textContent = "Missing group slug in URL.";
    return;
  }

  // Save inviter code (if present) so it persists (doesn't change later)
  const inv = url.searchParams.get("inv");
  if (inv && inv.length >= 3){
    const k = localKeyForRef(slug);
    if (!localStorage.getItem(k)) localStorage.setItem(k, inv);
  }

  // 1) Fetch group by slug
  const g = await apiGet(`/api/groups?g=${encodeURIComponent(slug)}`);
  if (!g || !g.group){
    if (els.groupName) els.groupName.textContent = "Group not found";
    if (els.subtitle) els.subtitle.textContent = "Check the slug in D1.";
    return;
  }
  GROUP = g.group;

  // Fill UI
  const title = GROUP.title || GROUP.slug || slug;
  if (els.groupName) els.groupName.textContent = title;
  if (els.modalGroupName) els.modalGroupName.textContent = title;

  if (GROUP.icon_url && els.avatarImg) els.avatarImg.src = GROUP.icon_url;

  if (els.subtitle){
    els.subtitle.innerHTML = `You are invited to a <b>group chat</b> on <b>Telegram</b>.`;
  }

  // 2) Ensure my referral code (server sets vid cookie)
  const c = await apiGet(`/api/referrals/code?g=${encodeURIComponent(slug)}`);
  MY_CODE = c.code;

  // 3) Load status (my invites)
  await refreshStatus();

  // Free groups: change join button to "Open" and skip modal
  if (GROUP.type === "free"){
    setJoinUnlocked(true, "Open");
  }

  // Periodic refresh
  setInterval(() => refreshStatus().catch(() => {}), 5000);
}

async function refreshStatus(){
  const slug = GROUP?.slug || safeSlugFromPathOrQuery();
  if (!slug) return;

  const s = await apiGet(`/api/referrals/status?g=${encodeURIComponent(slug)}`);
  STATUS = s;

  const needed = Number(STATUS.needed ?? GROUP?.invites_needed ?? 0);
  const invites = Number(STATUS.invites ?? 0);

  // Progress bar
  const pct = needed > 0 ? Math.round((invites / needed) * 100) : 0;
  if (els.progressFill) els.progressFill.style.width = clamp(pct, 0, 100) + "%";
  if (els.progressCount) els.progressCount.textContent = `${invites}/${needed} invites`;

  // Pending label
  const pending = (needed > 0 && invites < needed);
  if (els.pendingStatus){
    if (pending){
      els.pendingStatus.textContent = "Waiting for invite…";
      els.pendingStatus.classList.remove("hide");
    } else {
      els.pendingStatus.textContent = "";
      els.pendingStatus.classList.add("hide");
    }
  }

  // Unlocked?
  const unlocked = needed === 0 ? true : invites >= needed;
  if (GROUP?.type === "invite"){
    setJoinUnlocked(unlocked);
    if (unlocked) closeModal();
  }
}

function setJoinUnlocked(isUnlocked, overrideText){
  if (!els.joinBtn) return;
  if (isUnlocked){
    els.joinBtn.textContent = overrideText || "Unlocked";
    els.joinBtn.classList.add("unlocked");
  } else {
    els.joinBtn.textContent = "Join Group";
    els.joinBtn.classList.remove("unlocked");
  }
}

// -------- Events --------
if (els.downloadBtn){
  els.downloadBtn.addEventListener("click", () => {
    window.open(TELEGRAM_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
  });
}

if (els.joinBtn){
  els.joinBtn.addEventListener("click", async () => {
    if (!GROUP){
      showToast("Loading…");
      return;
    }

    // Free group => go to feed_path
    if (GROUP.type === "free"){
      window.location.href = GROUP.feed_path || "/";
      return;
    }

    const needed = Number(STATUS?.needed ?? GROUP.invites_needed ?? 0);
    const invites = Number(STATUS?.invites ?? 0);
    const unlocked = needed === 0 ? true : invites >= needed;

    if (unlocked){
      window.location.href = GROUP.feed_path || "/";
    } else {
      openModal();
    }
  });
}

if (els.okBtn) els.okBtn.addEventListener("click", closeModal);
if (els.skipShare){
  els.skipShare.addEventListener("click", (e) => {
    e.preventDefault();
    closeModal();
  });
}

if (els.overlay){
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeModal();
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.overlay?.classList.contains("open")) closeModal();
});

if (els.shareBtn){
  els.shareBtn.addEventListener("click", async () => {
    if (!GROUP){
      showToast("Loading…");
      return;
    }

    const slug = GROUP.slug;
    const shareLink = `${window.location.origin}/joinchat/${encodeURIComponent(slug)}?inv=${encodeURIComponent(MY_CODE || "")}`;
    const shareText = `${GROUP.title || slug}\n${shareLink}`;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(shareText)}`;

    // Open Telegram share immediately (user gesture)
    window.open(tgUrl, "_blank", "noopener,noreferrer");

    // Credit inviter (idempotent)
    const inviter = localStorage.getItem(localKeyForRef(slug)) || "";
    try {
      const out = await apiPost("/api/referrals/claim", { g: slug, inv: inviter });
      if (out?.credited) showToast("✅ Shared (invite credited)");
      else showToast("✅ Shared!");
    } catch {
      showToast("✅ Shared!");
    }

    // Refresh status after a moment
    setTimeout(() => refreshStatus().catch(() => {}), 1200);
  });
}

// Init
loadEverything().catch(() => {
  if (els.groupName) els.groupName.textContent = "Failed to load";
  if (els.subtitle) els.subtitle.textContent = "Please refresh.";
});
