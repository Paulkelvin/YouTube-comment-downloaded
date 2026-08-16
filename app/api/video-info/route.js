import { NextResponse } from 'next/server';
import { extractVideoId, getVideoInfo, YouTubeApiError } from '@/lib/youtube';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  const ip = getClientIp(request);
  const { allowed } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.', code: 'rate_limited' },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const videoId = extractVideoId(body.url);

  if (!videoId) {
    return NextResponse.json(
      { error: 'Could not parse a video ID from that input. Paste a full YouTube URL or an 11-character video ID.', code: 'invalid_url' },
      { status: 400 }
    );
  }

  try {
    const info = await getVideoInfo(videoId);
    return NextResponse.json(info);
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('video-info error', err);
    return NextResponse.json({ error: 'Unexpected server error.', code: 'server_error' }, { status: 500 });
  }
}
