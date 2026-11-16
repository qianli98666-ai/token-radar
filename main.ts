// A token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the comparables model in lib/model.ts, writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ to /output. The three screenshots live
// in this repository as text, screenshots.json (one base64 line per image), because the repository is
// kept text-only; this program decodes them to /output/screenshots/ as whole PNG files. Last, it
// writes /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. The page
// recomputes every row from the snapshot figures, so its numbers and the board's numbers are visibly
// the same arithmetic.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

/**
 * The screenshots, decoded from screenshots.json at the repository root: an object of file name to
 * base64 PNG or JPEG bytes. The repository stays text-only, so the images travel as text and this
 * program restores them, whole, into /output/screenshots/. Each file is checked to be a whole PNG or
 * JPEG inside the scorer's byte cap before it is written.
 */
function decodeScreenshots(to: string): string[] {
  const manifestPath = join(here, 'screenshots.json');
  if (!existsSync(manifestPath)) {
    process.stderr.write('token radar: no screenshots.json: capture the three views and store them as base64 in screenshots.json\n');
    process.exit(1);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    process.stderr.write('token radar: screenshots.json is not JSON\n');
    process.exit(1);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    process.stderr.write('token radar: screenshots.json is not an object of name to base64\n');
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  const written: string[] = [];
  for (const [name, value] of Object.entries(manifest as Record<string, unknown>)) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots.json names ${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(value)) {
      process.stderr.write(`token radar: screenshots.json holds no base64 for ${name}\n`);
      process.exit(1);
    }
    const bytes = Buffer.from(value, 'base64');
    const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
    const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
    if (!isPng && !isJpeg) {
      process.stderr.write(`token radar: screenshots/${name} decodes to neither a PNG nor a JPEG\n`);
      process.exit(1);
    }
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
      process.stderr.write(`token radar: screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap\n`);
      process.exit(1);
    }
    writeFileSync(join(to, name), bytes);
    written.push(name);
  }
  return written.sort();
}

const shots = decodeScreenshots(join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots.json holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
