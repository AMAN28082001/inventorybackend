import fs from 'fs';
import iconv from 'iconv-lite';

const REPLACEMENT_CHAR = '\uFFFD';

/**
 * Read a text file that may be UTF-8 (with/without BOM) or Windows-1252 (common Excel CSV on Windows).
 * Invalid UTF-8 sequences become U+FFFD when decoded as UTF-8 — we retry win1252 when that happens.
 */
export function readTextFileAutoEncoding(filePath: string): string {
  const buf = fs.readFileSync(filePath);

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8');
  }

  const utf8 = iconv.decode(buf, 'utf8');
  const replacementCount = (utf8.match(new RegExp(REPLACEMENT_CHAR, 'g')) || []).length;
  if (replacementCount > 0) {
    return iconv.decode(buf, 'win1252');
  }

  return utf8;
}
