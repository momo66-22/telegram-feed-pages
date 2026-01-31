function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function hashTo1to7(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 7) + 1;
}

function encodePathSegmentKeepPlus(s) {
  return encodeURIComponent(String(s || "")).replace(/%2B/gi, "+");
}

function el(sel) {
  return document.querySelector(sel);
}

function cardHTML({ letter, tag, tagText, title, desc, rightText, href }) {
  return `
    <a class="group-card ${tag}" href="${href}">
      <div class="group-left">
        <div class="group-icon">${letter}</div>
        <div class="group-info">
          <div class="group-meta">Telegram</div>
          <div class="group-title">${title}</div>
          <div class="group-desc">${desc}</div>
        </div>
      </div>

      <div class="group-right">
        ${tagText ? `<div class="group-pill">${tagText}</div>` : ``}
        ${rightText ? `<div class="group-sub">${rightText}</div>` : ``}
        <div class="group-join">JOIN</div>
      </div>
    </a>
  `;
}

async function fetchGroups() {
  const res = await fetch("/api/groups", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.groups || [];
}

function readUnlocked() {
  try {
    const raw = localStorage.getItem("unlocked_groups_v1") || "[]";
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function writeUnlocked(set) {
  try {
    localStorage.setItem("unlocked_groups_v1", JSON.stringify([...set]));
  } catch {}
}

async function render() {
  const freeWrap = el("#freeGroups");
  const lockedWrap = el("#lockedGroups");
  const unlockedSection = el("#unlockedSection");
  const unlockedWrap = el("#unlockedGroups");

  if (!freeWrap || !lockedWrap) return;

  freeWrap.innerHTML = "";
  lockedWrap.innerHTML = "";
  if (unlockedWrap) unlockedWrap.innerHTML = "";
  if (unlockedSection) unlockedSection.style.display = "none";

  let groups = [];
  try {
    groups = await fetchGroups();
  } catch (e) {
    freeWrap.innerHTML = `<div class="empty">Failed to load groups. ${String(e.message || e)}</div>`;
    return;
  }

  const unlocked = readUnlocked();

  const free = groups.filter((g) => g.type === "free");
  const locked = groups.filter((g) => g.type !== "free");

  // Unlocked groups = locked groups that user has unlocked locally
  const unlockedGroups = locked.filter((g) => unlocked.has(String(g.slug_lc || g.slug || "").toLowerCase()));
  const stillLocked = locked.filter((g) => !unlocked.has(String(g.slug_lc || g.slug || "").toLowerCase()));

  // Free
  const freeCards =
    free
      .map((g) => {
        const slug = g.slug || "";
        const href = `/joinchat/${encodePathSegmentKeepPlus(slug)}`;
        const letter = String(g.title || slug || "A").trim().slice(0, 1).toUpperCase() || "A";

        return cardHTML({
          letter,
          tag: "free",
          tagText: "FREE TO JOIN",
          title: g.title || slug || "Free Group",
          desc: g.description || "Public feed",
          rightText: "",
          href,
        });
      })
      .join("") || `<div class="empty">No free groups yet.</div>`;

  freeWrap.innerHTML = freeCards;

  // Unlocked
  if (unlockedWrap && unlockedGroups.length) {
    unlockedSection.style.display = "";
    unlockedWrap.innerHTML = unlockedGroups
      .map((g) => {
        const slug = g.slug || "";
        const href = `/joinchat/${encodePathSegmentKeepPlus(slug)}`;
        const letter = String(g.title || slug || "A").trim().slice(0, 1).toUpperCase() || "A";
        const need = Number(g.invites_needed || 0);
        return cardHTML({
          letter,
          tag: "free",
          tagText: "UNLOCKED",
          title: g.title || slug || "Unlocked Group",
          desc: g.description || "Unlocked by invites",
          rightText: need ? `0 / ${need} invites` : "",
          href,
        });
      })
      .join("");
  }

  // Locked
  lockedWrap.innerHTML =
    stillLocked
      .map((g) => {
        const slug = g.slug || "";
        const href = `/joinchat/${encodePathSegmentKeepPlus(slug)}`;
        const letter = String(g.title || slug || "A").trim().slice(0, 1).toUpperCase() || "A";
        const need = Number(g.invites_needed || 0);

        return cardHTML({
          letter,
          tag: "locked",
          tagText: "INVITE REQUIRED",
          title: g.title || slug || "Locked Group",
          desc: g.description || "Invite only group",
          rightText: need ? `0 / ${need} invites` : "",
          href,
        });
      })
      .join("") || `<div class="empty">No invite-required groups yet.</div>`;
}

render();
