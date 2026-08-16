// Turns a list of comment objects into downloadable file contents.
//
// Each comment object is { id, author, text, likeCount, publishedAt,
// type: 'comment' | 'reply', parentAuthor }. `parentAuthor` names the
// top-level comment's author for replies, and is null for top-level
// comments — that's the "structure" preserved across all three formats.

import ExcelJS from 'exceljs';

function sanitizeLine(text) {
  return String(text ?? '').replace(/\r?\n/g, ' ').trim();
}

export function toTxt(comments) {
  return comments
    .map((c) => {
      const line = `${sanitizeLine(c.author)}: ${sanitizeLine(c.text)}`;
      return c.type === 'reply' ? `    ↳ ${line}` : line;
    })
    .join('\n');
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(comments) {
  const header = 'author,comment,likeCount,publishedAt,type,replyTo';
  const rows = comments.map((c) =>
    [
      csvEscape(c.author),
      csvEscape(c.text),
      csvEscape(c.likeCount),
      csvEscape(c.publishedAt),
      csvEscape(c.type),
      csvEscape(c.parentAuthor ?? ''),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Builds an .xlsx workbook and returns it as a Buffer. Unlike toTxt/toCsv
 * this is async (ExcelJS's writer is promise-based) and returns binary
 * data, so callers must base64-encode it before sending it through a
 * text-based transport (see app/api/comments/route.js).
 */
export async function toXlsx(comments) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Comments');

  sheet.columns = [
    { header: 'Author', key: 'author', width: 24 },
    { header: 'Comment', key: 'text', width: 70 },
    { header: 'Likes', key: 'likeCount', width: 10 },
    { header: 'Published At', key: 'publishedAt', width: 22 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Reply To', key: 'parentAuthor', width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'F1' };

  for (const c of comments) {
    sheet.addRow({
      author: c.author,
      text: c.text,
      likeCount: c.likeCount,
      publishedAt: c.publishedAt,
      type: c.type,
      parentAuthor: c.parentAuthor ?? '',
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
