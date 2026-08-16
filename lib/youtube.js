// Helpers for talking to the YouTube Data API v3 and shaping its responses.

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Hard ceiling on how many comments (top-level + replies combined) we'll
// pull for a single request. Keeps response time and quota usage bounded
// for videos with tens/hundreds of thousands of comments.
export const MAX_COMMENTS = 5000;
const PAGE_SIZE = 100;

/**
 * Extracts a YouTube video ID from a full URL, short youtu.be link,
 * embed URL, or a bare 11-character ID typed directly.
 */
export function extractVideoId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Bare video ID (YouTube IDs are 11 chars of [A-Za-z0-9_-]).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return id || null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') {
        return url.searchParams.get('v');
      }
      if (url.pathname.startsWith('/shorts/')) {
        return url.pathname.split('/')[2] || null;
      }
      if (url.pathname.startsWith('/embed/')) {
        return url.pathname.split('/')[2] || null;
      }
      if (url.pathname.startsWith('/live/')) {
        return url.pathname.split('/')[2] || null;
      }
    }
  } catch {
    // Not a valid URL — fall through to null.
  }

  return null;
}

class YouTubeApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'YouTubeApiError';
    this.code = code; // stable machine-readable code for the frontend
    this.status = status;
  }
}

async function youtubeFetch(path, params) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new YouTubeApiError('Server is missing YOUTUBE_API_KEY.', 'missing_api_key', 500);
  }

  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString());
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || 'unknown';
    const message = data?.error?.message || 'YouTube API request failed.';

    if (reason === 'commentsDisabled') {
      throw new YouTubeApiError('Comments are disabled for this video.', 'comments_disabled', 403);
    }
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new YouTubeApiError(
        'The YouTube API quota has been exceeded. Please try again tomorrow.',
        'quota_exceeded',
        429
      );
    }
    if (reason === 'videoNotFound' || res.status === 404) {
      throw new YouTubeApiError('Video not found. It may be private, deleted, or the URL is wrong.', 'video_not_found', 404);
    }
    if (res.status === 403) {
      throw new YouTubeApiError(message, 'forbidden', 403);
    }

    throw new YouTubeApiError(message, 'youtube_error', res.status);
  }

  return data;
}

/**
 * Fetches basic metadata (title, channel, thumbnail, comment count) for a
 * video so the UI can show a confirmation card before extraction starts.
 */
export async function getVideoInfo(videoId) {
  const data = await youtubeFetch('/videos', {
    part: 'snippet,statistics',
    id: videoId,
  });

  const video = data.items?.[0];
  if (!video) {
    throw new YouTubeApiError('Video not found. It may be private, deleted, or the URL is wrong.', 'video_not_found', 404);
  }

  return {
    id: videoId,
    title: video.snippet.title,
    channelTitle: video.snippet.channelTitle,
    thumbnail:
      video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url || null,
    commentCount: video.statistics?.commentCount ? Number(video.statistics.commentCount) : null,
  };
}

/**
 * Fetches every reply under a top-level comment thread, paginating via
 * nextPageToken, stopping early if `budget` (remaining room under
 * MAX_COMMENTS) is used up.
 */
async function fetchReplies(parentId, parentAuthor, budget) {
  const replies = [];
  let pageToken;

  do {
    const data = await youtubeFetch('/comments', {
      part: 'snippet',
      parentId,
      maxResults: PAGE_SIZE,
      textFormat: 'plainText',
      pageToken,
    });

    for (const item of data.items || []) {
      const s = item.snippet;
      replies.push({
        id: item.id,
        author: s.authorDisplayName,
        text: s.textDisplay,
        likeCount: s.likeCount,
        publishedAt: s.publishedAt,
        type: 'reply',
        parentAuthor,
      });

      if (replies.length >= budget) {
        return { replies, hitBudget: true };
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return { replies, hitBudget: false };
}

/**
 * Fetches all comment threads for a video — top-level comments plus their
 * replies — paginating via nextPageToken until either YouTube runs out of
 * pages or we hit MAX_COMMENTS (counting replies too, since that's what
 * the user sees as "total comments"). Each returned item is tagged with
 * `type: 'comment' | 'reply'` and, for replies, `parentAuthor` naming the
 * top-level comment's author, so downstream formatters can present the
 * thread structure.
 *
 * Fetching replies costs one extra `comments.list` call per top-level
 * thread that has replies (1 unit per 100 replies) — top-level threads
 * with no replies (`totalReplyCount === 0`) skip that call entirely, so
 * quota cost scales with actual reply volume, not comment count.
 *
 * @param {string} videoId
 * @param {(fetched: number) => void} [onProgress] optional progress callback
 */
export async function fetchAllComments(videoId, onProgress) {
  const comments = [];
  let pageToken = undefined;
  let capped = false;

  outer: do {
    const data = await youtubeFetch('/commentThreads', {
      part: 'snippet',
      videoId,
      maxResults: PAGE_SIZE,
      order: 'time',
      textFormat: 'plainText',
      pageToken,
    });

    for (const item of data.items || []) {
      const threadId = item.snippet.topLevelComment.id;
      const top = item.snippet.topLevelComment.snippet;
      comments.push({
        id: threadId,
        author: top.authorDisplayName,
        text: top.textDisplay,
        likeCount: top.likeCount,
        publishedAt: top.publishedAt,
        type: 'comment',
        parentAuthor: null,
      });

      if (comments.length >= MAX_COMMENTS) {
        capped = true;
        break outer;
      }

      const totalReplyCount = item.snippet.totalReplyCount || 0;
      if (totalReplyCount > 0) {
        const budget = MAX_COMMENTS - comments.length;
        const { replies, hitBudget } = await fetchReplies(threadId, top.authorDisplayName, budget);
        comments.push(...replies);
        onProgress?.(comments.length);

        if (hitBudget) {
          capped = true;
          break outer;
        }
      }
    }

    onProgress?.(comments.length);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { comments, capped };
}

export { YouTubeApiError };
