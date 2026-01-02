import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "posts");
const OUT_DIR = path.join(ROOT, "public");
const OUT_FILE = path.join(OUT_DIR, "posts.json");

function toIso(x) {
  if (!x) return null;
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeMedia(m) {
  if (!m) return [];
  if (!Array.isArray(m)) return [];
  return m.map((it) => ({
    type: it.type === "video" ? "video" : "image",
    url: String(it.url || "").trim(),
    thumb_url: it.thumb_url ? String(it.thumb_url).trim() : undefined,
    aspect: it.aspect ?? undefined,
    caption: it.caption ?? undefined,
  })).filter(it => it.url);
}

function readMarkdownPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const files = fs.readdirSync(POSTS_DIR)
    .filter(f => f.toLowerCase().endsWith(".md"))
    .map(f => path.join(POSTS_DIR, f));

  const posts = [];
  for (const fp of files) {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = matter(raw);
    const data = parsed.data || {};
    const body = (parsed.content || "").trim();

    const fallbackId = path.basename(fp).replace(/\.md$/i, "");
    const post_id = String(data.post_id || fallbackId);

    const created_at =
      toIso(data.created_at) ||
      new Date(fs.statSync(fp).mtimeMs).toISOString();

    posts.push({
      post_id,
      created_at,
      group_title: data.group_title,
      caption_text: (data.caption_text ? String(data.caption_text) : body),
      media: normalizeMedia(data.media),
      views: Number.isFinite(Number(data.views)) ? Number(data.views) : 0,
      tags: data.tags,
      pinned: data.pinned === true,
    });
  }

  // Newest first
  posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return posts;
}

const posts = readMarkdownPosts();
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(posts, null, 2), "utf8");
console.log(`Wrote ${posts.length} posts -> ${path.relative(ROOT, OUT_FILE)}`);
