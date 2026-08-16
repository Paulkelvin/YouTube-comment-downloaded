# Comment Extractor

Export every comment — top-level and replies — from a YouTube video to a downloadable `.txt`, `.csv`, or `.xlsx` file. Paste a URL, confirm the video, and download.

## Stack

- Next.js 14 (App Router) + Tailwind CSS
- Next.js API routes (serverless, deployed on Vercel — no separate backend)
- YouTube Data API v3 (`videos.list`, `commentThreads.list`, `comments.list`)
- ExcelJS for `.xlsx` generation
- No database — everything is stateless per request

## How it works

- `app/page.js` — single-page UI: look up a video, confirm it, extract, then download or copy.
- `app/api/video-info/route.js` — resolves a URL/ID to video metadata (title, thumbnail, comment count) for the confirmation card.
- `app/api/comments/route.js` — streams newline-delimited JSON progress events while paginating comments, then a final `done` event with the finished file content. The frontend reads this stream to render a live "Fetched N of ~total" indicator. `.xlsx` content is base64-encoded (`encoding: 'base64'`) since it's binary; `.txt`/`.csv` are sent as plain text.
- `lib/youtube.js` — video ID parsing, YouTube API calls, pagination up to `MAX_COMMENTS` (5,000 by default) across top-level comments **and** replies, and error mapping (comments disabled, quota exceeded, video not found, etc).
- `lib/format.js` — turns comment objects into `.txt` (`Author: comment`, replies indented with `↳`), `.csv` (`author,comment,likeCount,publishedAt,type,replyTo`), or `.xlsx` (same columns as the CSV, as a formatted spreadsheet with a header row and autofilter).
- `lib/rateLimit.js` — best-effort in-memory rate limiting (10 requests/hour per IP) to guard the API quota.

### Pagination and quota

`commentThreads.list` returns up to 100 top-level comments per call and costs 1 quota unit per call. `fetchAllComments` in `lib/youtube.js` loops on `nextPageToken` until either YouTube has no more pages or `MAX_COMMENTS` (default 5,000, counting top-level comments and replies together) is reached, whichever comes first. If the cap is hit, the response is flagged `capped: true` and the UI tells the user their file was truncated.

Replies are fetched via `comments.list?parentId=<topLevelCommentId>`, one extra call per 100 replies — but only for threads whose `totalReplyCount > 0`, so a video with mostly unreplied comments costs barely more than top-level-only extraction did. Each exported row is tagged `type: 'comment' | 'reply'`, with `parentAuthor` set to the top-level comment's author on replies (null on top-level comments), so all three export formats preserve the thread structure.

### Error handling

The YouTube API's various failure reasons (`commentsDisabled`, `quotaExceeded`, `videoNotFound`, private/deleted videos, malformed URLs) are mapped to stable `code` values and friendly messages in `lib/youtube.js`, and surfaced directly in the UI instead of a generic failure.

## Setup

### 1. Get a YouTube Data API v3 key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Go to **APIs & Services → Library**, search for **YouTube Data API v3**, and enable it.
4. Go to **APIs & Services → Credentials → Create Credentials → API key**.
5. (Recommended) Restrict the key to the YouTube Data API v3, and optionally to your server's IPs.

The free tier gives you 10,000 quota units/day. Each page of top-level comments or replies costs 1 unit (up to 100 comments per page), so a full extraction (up to `MAX_COMMENTS`) costs at most ~50 units for videos with few replies, more for heavily-replied-to videos since each replied-to thread needs its own `comments.list` call(s).

### 2. Run locally

```bash
npm install
cp .env.local.example .env.local
# edit .env.local and set YOUTUBE_API_KEY

npm run dev
```

Open http://localhost:3000.

### 3. Deploy to Vercel

1. Push this repo to GitHub and import it in [Vercel](https://vercel.com/new).
2. In the Vercel project settings, add an environment variable:
   - `YOUTUBE_API_KEY` = your API key
3. Deploy — no other configuration is required.

## Configuration

- `MAX_COMMENTS` in `lib/youtube.js` — cap on comments fetched per request (default 5,000).
- `WINDOW_MS` / `MAX_REQUESTS` in `lib/rateLimit.js` — rate limit window/threshold (default 10 requests/hour per IP). Note: this is in-memory per serverless instance, so it's a best-effort abuse guard, not a hard global limit — back it with Vercel KV/Upstash Redis if you need a strict cap.

## License

MIT
