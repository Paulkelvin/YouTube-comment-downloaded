// Turns a list of comment objects into downloadable file contents.

function sanitizeLine(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').trim();
}

export function toTxt(comments) {
  return comments.map((c) => `${sanitizeLine(c.author)}: ${sanitizeLine(c.text)}`).join('\n');
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(comments) {
  const header = 'author,comment,likeCount,publishedAt';
  const rows = comments.map((c) =>
    [csvEscape(c.author), csvEscape(c.text), csvEscape(c.likeCount), csvEscape(c.publishedAt)].join(',')
  );
  return [header, ...rows].join('\n');
}
