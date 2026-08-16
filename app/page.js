'use client';

import { useState, useRef } from 'react';

const STAGE = {
  IDLE: 'idle',
  LOOKING_UP: 'looking_up',
  CONFIRMED: 'confirmed',
  EXTRACTING: 'extracting',
  READY: 'ready',
};

const MIME_TYPES = {
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('txt');
  const [stage, setStage] = useState(STAGE.IDLE);
  const [videoInfo, setVideoInfo] = useState(null);
  const [error, setError] = useState(null);
  const [fetched, setFetched] = useState(0);
  const [result, setResult] = useState(null); // { filename, content, total, capped }
  const [copied, setCopied] = useState(false);

  const abortRef = useRef(null);

  async function handleLookup(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setVideoInfo(null);
    setStage(STAGE.LOOKING_UP);

    try {
      const res = await fetch('/api/video-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
        setStage(STAGE.IDLE);
        return;
      }

      setVideoInfo(data);
      setStage(STAGE.CONFIRMED);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setStage(STAGE.IDLE);
    }
  }

  async function handleExtract() {
    setError(null);
    setFetched(0);
    setResult(null);
    setStage(STAGE.EXTRACTING);

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format }),
      });

      if (!res.ok && !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Something went wrong.');
        setStage(STAGE.CONFIRMED);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

          const event = JSON.parse(line);
          if (event.type === 'progress') {
            setFetched(event.fetched);
          } else if (event.type === 'done') {
            setResult(event);
            setStage(STAGE.READY);
          } else if (event.type === 'error' || event.error) {
            setError(event.error || 'Something went wrong.');
            setStage(STAGE.CONFIRMED);
          }
        }
      }
    } catch {
      setError('Network error while extracting comments. Please try again.');
      setStage(STAGE.CONFIRMED);
    }
  }

  function handleDownload() {
    if (!result) return;
    const mime = MIME_TYPES[result.format] || 'text/plain';
    const blob =
      result.encoding === 'base64'
        ? new Blob([base64ToBytes(result.content)], { type: mime })
        : new Blob([result.content], { type: `${mime};charset=utf-8` });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    setStage(STAGE.IDLE);
    setVideoInfo(null);
    setResult(null);
    setError(null);
    setFetched(0);
  }

  const estimatedTotal = videoInfo?.commentCount ?? null;
  const isBusy = stage === STAGE.LOOKING_UP || stage === STAGE.EXTRACTING;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Comment Extractor</h1>
        <p className="mt-2 text-sm text-slate-500">
          Paste a YouTube video URL and download every comment — including replies — as a text, CSV, or Excel file.
        </p>
      </div>

      <form onSubmit={handleLookup} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          disabled={isBusy}
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-base shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:bg-slate-100 sm:text-sm"
        />
        <button
          type="submit"
          disabled={isBusy || !url.trim()}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {stage === STAGE.LOOKING_UP ? 'Looking up…' : 'Find video'}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {videoInfo && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-4">
            {videoInfo.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={videoInfo.thumbnail}
                alt={videoInfo.title}
                className="h-20 w-28 flex-shrink-0 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{videoInfo.title}</p>
              <p className="text-sm text-slate-500">{videoInfo.channelTitle}</p>
              {estimatedTotal !== null && (
                <p className="mt-1 text-xs text-slate-400">
                  ~{estimatedTotal.toLocaleString()} comments
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">Format:</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={stage === STAGE.EXTRACTING}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="txt">.txt (author: comment)</option>
              <option value="csv">.csv (author, comment, likes, date)</option>
              <option value="xlsx">.xlsx (structured spreadsheet)</option>
            </select>

            {stage !== STAGE.READY && (
              <button
                onClick={handleExtract}
                disabled={stage === STAGE.EXTRACTING}
                className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {stage === STAGE.EXTRACTING ? 'Extracting…' : 'Extract comments'}
              </button>
            )}
          </div>

          {stage === STAGE.EXTRACTING && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-slate-900 transition-all duration-300"
                  style={{
                    width: estimatedTotal
                      ? `${Math.min(100, (fetched / Math.max(estimatedTotal, fetched, 1)) * 100)}%`
                      : '100%',
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Fetched {fetched.toLocaleString()}
                {estimatedTotal ? ` of ~${estimatedTotal.toLocaleString()}` : ''} comments…
              </p>
            </div>
          )}

          {stage === STAGE.READY && result && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-sm text-slate-600">
                Done — {result.total.toLocaleString()} comments extracted
                {result.capped && (
                  <span className="text-amber-600"> (capped at {result.maxComments.toLocaleString()})</span>
                )}
                .
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleDownload}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700"
                >
                  Download .{result.format}
                </button>
                {result.encoding !== 'base64' && (
                  <button
                    onClick={handleCopy}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    {copied ? 'Copied!' : 'Copy to clipboard'}
                  </button>
                )}
                <button
                  onClick={reset}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
                >
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
