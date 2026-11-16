// The gate, checked locally before anything is submitted: the same seven rows the sealed scorer
// checks, against one /output directory and the snapshot it was built from. It never writes to the
// entry; it only reads. Screenshots are checked as whole images with their dimensions, so run it
// after the real screenshots are in place.
//
//   node check-gate.mjs [output-dir] [snapshot.json]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const out = process.argv[2] ?? 'out';
const snapshotPath = process.argv[3] ?? '../token-radar-01-kit/input/snapshot.json';

let failures = 0;
function check(name, ok, detail = '') {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
  if (!ok) failures += 1;
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = snapshot.watchlist;

// 1. dashboard_files: at most 400 files and 4 MiB, naming no network address.
const dashDir = join(out, 'dashboard');
const dashFiles = existsSync(dashDir) ? readdirSync(dashDir).filter((f) => statSync(join(dashDir, f)).isFile()) : [];
const dashBytes = dashFiles.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
let networkHit = null;
for (const f of dashFiles) {
  const text = readFileSync(join(dashDir, f), 'utf8');
  // The scorer refuses an http(s) address in an HTML attribute value, a <style> body, an inline
  // <script> import, a CSS file, or a JavaScript import, export-from, require or dynamic import.
  // Visible text and comments may carry URLs, so only those positions are checked.
  const bad = text.match(/(?:href|src|action|poster|cite|data)=["'][^"']*https?:\/\/|@import\s+["']https?:\/\/|import\s+(?:[^'"]*\s+from\s+)?["']https?:\/\/|export\s+(?:[^'"]*\s+from\s+)?["']https?:\/\/|require\(\s*["']https?:\/\/|import\(\s*["']https?:\/\//);
  if (bad !== null) { networkHit = `${f}: ${bad[0].slice(0, 60)}`; break; }
}
check('dashboard_files', dashFiles.length <= 400 && dashBytes <= 4_194_304 && networkHit === null,
  `${dashFiles.length} files, ${dashBytes} bytes${networkHit === null ? '' : `, network address in ${networkHit}`}`);

// 2 + 3 + 4 + 5. board.json: shape, order, coverage, farm steps.
const boardPath = join(out, 'board.json');
let board = null;
try {
  const raw = JSON.parse(readFileSync(boardPath, 'utf8'));
  board = Array.isArray(raw) ? raw : raw.rows;
} catch { /* reported below */ }
const boardBytes = existsSync(boardPath) ? statSync(boardPath).size : 0;
let boardOk = Array.isArray(board) && board.length >= 100 && board.length <= 4000 && boardBytes <= 8_388_608;
let boardDetail = board === null ? 'board.json is not JSON' : `${board.length} rows, ${boardBytes} bytes`;
const seenSlugs = new Set();
if (Array.isArray(board)) {
  for (const [i, r] of board.entries()) {
    const slugOk = typeof r.slug === 'string' && /^[^\s]{1,128}$/.test(r.slug) && slugs.has(r.slug) && !seenSlugs.has(r.slug);
    seenSlugs.add(r.slug);
    const rowOk = slugOk
      && typeof r.name === 'string' && r.name.length > 0
      && Number.isInteger(r.rank) && r.rank > 0
      && Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 100_000_000_000_000
      && Array.isArray(r.farm_steps);
    if (!rowOk) { boardOk = false; boardDetail = `row ${i} (${r.slug ?? 'no slug'}) fails the shape`; break; }
  }
}
check('board_file', boardOk, boardDetail);

let sortedOk = false;
let sortedDetail = '';
if (Array.isArray(board) && board.length > 0) {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  const orderOk = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
  const distinctOk = new Set(board.map((r) => r.implied_value_usd)).size > 1 || board.length < 2;
  sortedOk = ranksOk && orderOk && distinctOk;
  sortedDetail = `ranks 1..${board.length} ${ranksOk ? 'exact' : 'BROKEN'}, implied non-rising ${orderOk ? 'yes' : 'NO'}`;
}
check('sorted_by_value', sortedOk, sortedDetail);

const missing = watchlist.filter((s) => !seenSlugs.has(s));
check('coverage', missing.length === 0, `${watchlist.length - missing.length}/${watchlist.length} watchlist slugs${missing.length > 0 ? `, missing ${missing.slice(0, 5).join(', ')}` : ''}`);

let farmOk = true;
let farmDetail = '';
if (Array.isArray(board)) {
  for (const [i, r] of board.entries()) {
    const stepsOk = Array.isArray(r.farm_steps) && r.farm_steps.length >= 3 && r.farm_steps.length <= 12
      && r.farm_steps.every((s) => typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600);
    if (!stepsOk) { farmOk = false; farmDetail = `row ${i} (${r.slug}) farm_steps out of shape`; break; }
  }
  if (farmOk) farmDetail = `every row carries ${board[0].farm_steps.length} steps of 20-600 characters`;
}
check('farm_steps', farmOk, farmDetail);

// 6. screenshots: 3 to 4 whole PNG or JPEG images, each at most 512 KiB, long side at most 1440,
//    short side at least 800.
function pngSize(bytes) {
  if (bytes.length < 24) return null;
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!magic.every((b, i) => bytes[i] === b)) return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
const shotsDir = join(out, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => statSync(join(shotsDir, f)).isFile()).sort() : [];
let shotsOk = shots.length >= 3 && shots.length <= 4;
let shotsDetail = `${shots.length} images`;
for (const f of shots) {
  const bytes = readFileSync(join(shotsDir, f));
  const size = pngSize(bytes) ?? jpegSize(bytes);
  if (size === null) { shotsOk = false; shotsDetail = `${f} is not a whole PNG or JPEG`; break; }
  const long = Math.max(size.w, size.h);
  const short = Math.min(size.w, size.h);
  if (bytes.length > 524_288 || long > 1440 || short < 800) {
    shotsOk = false;
    shotsDetail = `${f} is ${size.w}x${size.h}, ${bytes.length} bytes (cap 512 KiB, long side 1440, short side 800)`;
    break;
  }
}
check('screenshots', shotsOk, shotsDetail);

// 7. dossier_matches: dossier.json is byte-identical to what buildDossier writes from this /output.
let dossierOk = false;
let dossierDetail = '';
try {
  const written = readFileSync(join(out, 'dossier.json'));
  const rebuilt = buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
  dossierOk = Buffer.from(rebuilt, 'utf8').equals(written);
  dossierDetail = `${written.length} bytes${dossierOk ? ', identical to a fresh buildDossier' : ', DIFFERS from a fresh buildDossier'}`;
} catch (e) {
  dossierDetail = `buildDossier refused this /output: ${e.message}`;
}
check('dossier_matches', dossierOk, dossierDetail);

process.stdout.write(failures === 0 ? 'gate: all seven rows pass\n' : `gate: ${failures} row${failures === 1 ? '' : 's'} failing\n`);
process.exit(failures === 0 ? 0 : 1);
