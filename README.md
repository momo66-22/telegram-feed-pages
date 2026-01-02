# Telegram-style Feed (Cloudflare Pages)

This repo gives you:
- A Telegram-feeling feed UI (posts newest-first)
- Easy posting workflow (Option A: Markdown files in /posts)
- Global reactions + view counting using **Cloudflare Pages Functions + KV**

## Quick start (local)
1) Install
```bash
npm i
```

2) Build posts.json from /posts
```bash
npm run build
```

3) Run locally
```bash
npm run dev
```

## Deploy (Cloudflare Pages)
- Build command: `npm run build`
- Output directory: `public`

Then create a **KV Namespace** and bind it to your Pages project:
- Binding name: `REACTIONS_KV`

Functions live in `/functions` and will deploy automatically.

## Posting workflow (Option A)
Add a new markdown file in `/posts/` and deploy.
Each file becomes one post at the top of the feed.

Frontmatter fields supported:
- post_id (string, unique)
- created_at (ISO timestamp)
- group_title
- views (number)
- media (array of items: {type,image|video,url,thumb_url?,caption?})
- body becomes caption_text

Run `npm run build` before deploy (Cloudflare Pages does this during build).
