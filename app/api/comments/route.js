import { extractVideoId, fetchAllComments, MAX_COMMENTS, YouTubeApiError } from '@/lib/youtube';
import { toTxt, toCsv, toXlsx } from '@/lib/format';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

const VALID_FORMATS = new Set(['txt', 'csv', 'xlsx']);

export const runtime = 'nodejs';

// Streams newline-delimited JSON progress events while comments are being
// fetched, then a final "done" event carrying the finished file content.
// The frontend reads this as a stream so it can render a live
// "Fetched N of ~total comments..." indicator instead of blocking on one
// big response.
export async function POST(request) {
  const ip = getClientIp(request);
  const { allowed } = checkRateLimit(ip);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please try again later.', code: 'rate_limited' }) + '\n',
      { status: 429, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const videoId = extractVideoId(body.url);
  const format = VALID_FORMATS.has(body.format) ? body.format : 'txt';

  if (!videoId) {
    return new Response(
      JSON.stringify({ error: 'Could not parse a video ID from that input.', code: 'invalid_url' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));

      try {
        const { comments, capped } = await fetchAllComments(videoId, (fetched) => {
          send({ type: 'progress', fetched });
        });

        // .xlsx is binary, so it's base64-encoded before going through this
        // text-based NDJSON stream. txt/csv stay as plain text — the
        // frontend picks the right decode path based on `encoding`.
        let content;
        let encoding = 'utf8';
        if (format === 'csv') {
          content = toCsv(comments);
        } else if (format === 'xlsx') {
          const buffer = await toXlsx(comments);
          content = buffer.toString('base64');
          encoding = 'base64';
        } else {
          content = toTxt(comments);
        }

        const filename = `${videoId}-comments.${format}`;

        send({
          type: 'done',
          filename,
          format,
          encoding,
          total: comments.length,
          capped,
          maxComments: MAX_COMMENTS,
          content,
        });
      } catch (err) {
        if (err instanceof YouTubeApiError) {
          send({ type: 'error', error: err.message, code: err.code });
        } else {
          console.error('comments fetch error', err);
          send({ type: 'error', error: 'Unexpected server error.', code: 'server_error' });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}
