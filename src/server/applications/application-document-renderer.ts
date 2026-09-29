/**
 * Locked RoleDawn document template.
 *
 * Renders the typed résumé and cover-letter models from
 * `application-documents.ts` into PDF (pdfkit) and DOCX (docx) with the same
 * hierarchy. The layout engine in this module owns line breaking, pagination,
 * and one-page fitting; pdfkit only paints positioned text runs and rules.
 *
 * ATS rules hold by construction:
 * - one column, every glyph is real text drawn in reading order;
 * - no character spacing and no ligatures, so extraction yields plain words;
 * - no images, tables, text boxes, headers, or footers;
 * - contact details are text, and email and profile URLs are real links.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Tab,
  TabStopType,
  TextRun,
  type INumberingOptions,
  type IParagraphStyleOptions,
  type IParagraphStylePropertiesOptions,
  type IRunStylePropertiesOptions,
  type IStylesOptions,
  type ParagraphChild,
} from "docx";
// @ts-expect-error -- fontkit is pdfkit's font engine and ships no type declarations; FontkitFont below types the calls made here.
import { create as createFontkitFont } from "fontkit";
import mammoth from "mammoth";
import PDFDocument from "pdfkit";
import { getDocumentProxy } from "unpdf";

import {
  displayUrl,
  type CoverLetterDocumentModel,
  type DocumentContact,
  type ResumeDocumentModel,
  type ResumeEducationEntry,
  type ResumeExperienceEntry,
  type ResumeSection,
} from "../../domain/application-documents.ts";
import { DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE } from "../resume/extract-resume.ts";

export const APPLICATION_DOCUMENT_RENDERER_RELEASE = "roledawn-documents/3";

export type RenderedDocument = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  /** Null for DOCX: Word decides pagination when the file is opened. */
  pageCount: number | null;
  /** Bullet text removed to respect the page limit, in document order. */
  droppedBullets: readonly string[];
}>;

// ---------------------------------------------------------------------------
// Template tokens
// ---------------------------------------------------------------------------

const INK = "#111827";
const MUTED = "#4b5563";
const ACCENT = "#1d3f72";
const HEADER_RULE = "#d1d5db";
const SECTION_RULE = "#b4c0d3";
const BULLET_MARK = "#6b7280";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

/** Fixed so identical input produces identical PDF bytes (it seeds the file ID). */
const PDF_FILE_ID_SEED_DATE = new Date(Date.UTC(2026, 0, 1));

/** Typical lowercase descender depth; used to centre the ink band in a line box. */
const DESCENDER_EM = 0.24;

/** Past this many words of experience/project bullets, a second page is earned. */
const TWO_PAGE_BULLET_WORDS = 420;
/** A one-page overflow this small is resolved by trimming the oldest entries' last bullets. */
const MAX_ONE_PAGE_DROPPED_BULLETS = 3;

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

type FontkitFont = Readonly<{
  unitsPerEm: number;
  capHeight: number;
  hasGlyphForCodePoint(codePoint: number): boolean;
  layout(text: string, features?: Record<string, boolean>): Readonly<{ advanceWidth: number }>;
}>;

type FaceId = "serif" | "serifItalic" | "serifSemibold" | "sans" | "sansMedium" | "sansSemibold";

/**
 * Each face is split across Google Fonts subsets: "latin" lacks Latin
 * Extended letters such as "Ł" and "ő", and "latin-ext" lacks basic Latin.
 * Text is shaped per run with the first subset that has the glyph.
 */
const FONT_SUBSETS = ["latin", "latin-ext", "vietnamese"] as const;

const FACE_FILES: Readonly<Record<FaceId, Readonly<{ family: string; variant: string }>>> = {
  serif: { family: "source-serif-4", variant: "400-normal" },
  serifItalic: { family: "source-serif-4", variant: "400-italic" },
  serifSemibold: { family: "source-serif-4", variant: "600-normal" },
  sans: { family: "inter", variant: "400-normal" },
  sansMedium: { family: "inter", variant: "500-normal" },
  sansSemibold: { family: "inter", variant: "600-normal" },
};

type FontSubsetFile = Readonly<{ key: string; bytes: Buffer; font: FontkitFont }>;

type Face = Readonly<{
  subsets: readonly FontSubsetFile[];
  /** Cap height in em. */
  capHeight: number;
  /** Code point -> subset index, or -1 when no bundled subset has the glyph. */
  coverage: Map<number, number>;
  /** `${subset}\u0000${text}` -> advance width in em. */
  advances: Map<string, number>;
}>;

type FaceTable = Readonly<Record<FaceId, Face>>;

let loadedFaces: FaceTable | null = null;

/**
 * Unwraps WOFF 1.0 into the sfnt (TrueType) file it compresses, using native
 * zlib. fontkit otherwise inflates WOFF tables in JavaScript every time pdfkit
 * opens a font, which dominated render time. The table bytes are unchanged.
 */
function woffToSfnt(woff: Buffer): Buffer {
  if (woff.readUInt32BE(0) !== 0x774f4646) return woff;
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = Array.from({ length: numTables }, (_value, index) => {
    const entry = 44 + index * 20;
    const offset = woff.readUInt32BE(entry + 4);
    const compressedLength = woff.readUInt32BE(entry + 8);
    const length = woff.readUInt32BE(entry + 12);
    const raw = woff.subarray(offset, offset + compressedLength);
    const data = compressedLength < length ? inflateSync(raw) : raw;
    if (data.length !== length) throw new Error("APPLICATION_DOCUMENT_FONT_INVALID: WOFF table length mismatch");
    return { tag: woff.readUInt32BE(entry), checksum: woff.readUInt32BE(entry + 16), data };
  });
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);
  const chunks: Buffer[] = [header];
  let offset = header.length;
  tables.forEach((table, index) => {
    const record = 12 + index * 16;
    header.writeUInt32BE(table.tag, record);
    header.writeUInt32BE(table.checksum, record + 4);
    header.writeUInt32BE(offset, record + 8);
    header.writeUInt32BE(table.data.length, record + 12);
    const padded = Buffer.alloc(Math.ceil(table.data.length / 4) * 4);
    table.data.copy(padded);
    chunks.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(chunks);
}

function loadFace(id: FaceId, directory: string): Face {
  const { family, variant } = FACE_FILES[id];
  const subsets = FONT_SUBSETS.map((subset): FontSubsetFile => {
    const name = `${family}-${subset}-${variant}.woff`;
    let woff: Buffer;
    try {
      woff = readFileSync(resolve(directory, family, name));
    } catch {
      throw new Error(`APPLICATION_DOCUMENT_FONT_MISSING: assets/fonts/${family}/${name}`);
    }
    const bytes = woffToSfnt(woff);
    return { key: `${id}-${subset}`, bytes, font: createFontkitFont(bytes) as FontkitFont };
  });
  const primary = subsets[0].font;
  return { subsets, capHeight: primary.capHeight / primary.unitsPerEm, coverage: new Map(), advances: new Map() };
}

/** Fonts ship in `assets/fonts` and are resolved from the process root so Next and Netlify bundles include them. */
function faces(): FaceTable {
  if (loadedFaces) return loadedFaces;
  const directory = resolve(process.cwd(), "assets/fonts");
  loadedFaces = {
    serif: loadFace("serif", directory),
    serifItalic: loadFace("serifItalic", directory),
    serifSemibold: loadFace("serifSemibold", directory),
    sans: loadFace("sans", directory),
    sansMedium: loadFace("sansMedium", directory),
    sansSemibold: loadFace("sansSemibold", directory),
  };
  return loadedFaces;
}

/**
 * Ligatures and contextual alternates stay off so "staffing" is extracted as
 * typed rather than through an "ffi" glyph. Kerning stays on. A fresh object
 * each call: fontkit may write to the feature map it is given.
 */
function textFeatures(): Record<string, boolean> {
  return { liga: false, clig: false, dlig: false, calt: false };
}

function subsetFor(face: Face, codePoint: number, preferred: number): number {
  if (preferred >= 0 && face.subsets[preferred].font.hasGlyphForCodePoint(codePoint)) return preferred;
  let index = face.coverage.get(codePoint);
  if (index === undefined) {
    index = face.subsets.findIndex((subset) => subset.font.hasGlyphForCodePoint(codePoint));
    face.coverage.set(codePoint, index);
  }
  return index;
}

function advanceEm(face: Face, subset: number, text: string): number {
  const cacheKey = `${subset}\u0000${text}`;
  const cached = face.advances.get(cacheKey);
  if (cached !== undefined) return cached;
  const file = face.subsets[subset].font;
  const advance = file.layout(text, textFeatures()).advanceWidth / file.unitsPerEm;
  face.advances.set(cacheKey, advance);
  return advance;
}

/** Symbols with no glyph in any bundled subset get a plain equivalent. */
const GLYPH_FALLBACKS: Readonly<Record<string, string>> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "≤": "<=",
  "≥": ">=",
  "≈": "~",
};

/** Bullets are drawn by the template; a marker typed into the text would double it. */
function cleanBullet(value: string | null | undefined): string {
  return cleanText(value).replace(/^(?:[•·▪◦‣∙*–—-]\s+)+/u, "");
}

/** The name heads every page set; a placeholder must never reach an employer. */
function requiredName(value: string): string {
  const name = cleanText(value);
  if (!name) throw new Error("APPLICATION_DOCUMENT_NAME_REQUIRED");
  return name;
}

/** Normalizes whitespace and invisible characters; the result is what gets drawn. */
function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/gu, "")
    .replace(/[\u0000-\u001f\u007f\s]+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Inline layout
// ---------------------------------------------------------------------------

type TextStyle = Readonly<{ face: FaceId; size: number; color: string; link: string | null }>;

/** A run of text shaped with one font subset. */
type Piece = Readonly<{ text: string; style: TextStyle; subset: number; width: number }>;

type InlineSpan = Readonly<{
  text: string;
  style: TextStyle;
  /** Never break inside this span. */
  keepTogether?: boolean;
  /** A separator such as " · ": a break opportunity that disappears when a line breaks there. */
  separator?: boolean;
}>;

/** Unbreakable material plus the glue in front of it (dropped at a line start). */
type Segment = Readonly<{ lead: readonly Piece[]; leadWidth: number; body: readonly Piece[]; width: number }>;

type TextLine = Readonly<{ pieces: readonly Piece[]; width: number }>;

function style(face: FaceId, size: number, color: string, link: string | null = null): TextStyle {
  return { face, size, color, link };
}

function piece(text: string, textStyle: TextStyle, subset: number): Piece {
  const face = faces()[textStyle.face];
  return { text, style: textStyle, subset, width: advanceEm(face, subset, text) * textStyle.size };
}

function shape(text: string, textStyle: TextStyle): Piece[] {
  const face = faces()[textStyle.face];
  const pieces: Piece[] = [];
  let run = "";
  let runSubset = -1;
  const append = (value: string, subset: number) => {
    if (subset !== runSubset && run) {
      pieces.push(piece(run, textStyle, runSubset));
      run = "";
    }
    runSubset = subset;
    run += value;
  };
  for (const character of text) {
    const subset = subsetFor(face, character.codePointAt(0) ?? 0, runSubset);
    if (subset >= 0) {
      append(character, subset);
      continue;
    }
    const fallback = GLYPH_FALLBACKS[character];
    if (fallback !== undefined) {
      for (const replacement of fallback) append(replacement, subsetFor(face, replacement.codePointAt(0) ?? 0, runSubset));
    } else if (/[\p{L}\p{N}]/u.test(character)) {
      // A letter in an unbundled script stays in the text layer so extraction QA flags it.
      append(character, 0);
    }
    // Other symbols (emoji, dingbats) carry no résumé content and are omitted.
  }
  if (run) pieces.push(piece(run, textStyle, runSubset));
  return pieces;
}

function totalWidth(pieces: readonly Piece[]): number {
  return pieces.reduce((sum, item) => sum + item.width, 0);
}

function segmentize(spans: readonly InlineSpan[]): Segment[] {
  const segments: Segment[] = [];
  let lead: Piece[] = [];
  let body: Piece[] = [];
  const flush = () => {
    if (body.length === 0) return;
    segments.push({ lead, leadWidth: totalWidth(lead), body, width: totalWidth(body) });
    lead = [];
    body = [];
  };
  for (const span of spans) {
    const text = span.text.normalize("NFC").replace(/\s+/gu, " ");
    if (!text) continue;
    if (span.separator) {
      flush();
      lead.push(...shape(text, span.style));
      continue;
    }
    if (span.keepTogether) {
      body.push(...shape(text, span.style));
      continue;
    }
    for (const part of text.split(/( )/u)) {
      if (!part) continue;
      if (part === " ") {
        flush();
        // An omitted glyph (an emoji between spaces) must not leave a double space.
        if (!lead.at(-1)?.text.endsWith(" ")) lead.push(...shape(" ", span.style));
      } else {
        body.push(...shape(part, span.style));
      }
    }
  }
  flush();
  return segments;
}

/**
 * Splits unbreakable material wider than a line (a long URL, say), preferring
 * to break after URL punctuation so no word is cut in half.
 */
function splitOversized(segment: Segment, width: number): Segment[] {
  const glyphs = segment.body.flatMap((source) => [...source.text].map((character) => piece(character, source.style, source.subset)));
  const parts: Segment[] = [];
  let start = 0;
  while (start < glyphs.length) {
    let end = start;
    let used = 0;
    while (end < glyphs.length && (end === start || used + glyphs[end].width <= width)) {
      used += glyphs[end].width;
      end += 1;
    }
    if (end < glyphs.length) {
      for (let candidate = end - 1; candidate > start + (end - start) * 0.4; candidate -= 1) {
        if (/[/\-_.?&=#]/u.test(glyphs[candidate].text)) {
          end = candidate + 1;
          break;
        }
      }
    }
    const chunk = glyphs.slice(start, end);
    parts.push({ lead: [], leadWidth: 0, body: mergePieces(chunk), width: totalWidth(chunk) });
    start = end;
  }
  return parts;
}

function samePieceStyle(left: Piece, right: Piece): boolean {
  return left.subset === right.subset
    && left.style.face === right.style.face
    && left.style.size === right.style.size
    && left.style.color === right.style.color
    && left.style.link === right.style.link;
}

/**
 * Joins adjacent same-style pieces into one drawn run. Widths are summed, not
 * re-shaped: the only kerning lost is across word gaps, far below a
 * point, and re-shaping every line on every fitting pass is the slow path.
 */
function mergePieces(pieces: readonly Piece[]): Piece[] {
  const merged: Piece[] = [];
  for (const item of pieces) {
    const previous = merged.at(-1);
    if (previous && samePieceStyle(previous, item)) {
      merged[merged.length - 1] = { ...previous, text: previous.text + item.text, width: previous.width + item.width };
    } else {
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Greedy line breaking at glue, with one refinement: a paragraph never ends
 * on a lone short word when the line above can spare one.
 */
function breakLines(spans: readonly InlineSpan[], widthAt: (line: number) => number): TextLine[] {
  const lines: Segment[][] = [];
  let current: Segment[] = [];
  let currentWidth = 0;
  const place = (segment: Segment) => {
    const available = widthAt(lines.length);
    if (current.length === 0) {
      if (segment.width > available) {
        const parts = splitOversized(segment, available);
        for (const part of parts.slice(0, -1)) lines.push([part]);
        const last = parts.at(-1);
        current = last ? [last] : [];
        currentWidth = last?.width ?? 0;
      } else {
        current = [segment];
        currentWidth = segment.width;
      }
      return;
    }
    const next = currentWidth + segment.leadWidth + segment.width;
    if (next <= available + 0.01) {
      current.push(segment);
      currentWidth = next;
      return;
    }
    lines.push(current);
    current = [];
    currentWidth = 0;
    place(segment);
  };
  for (const segment of segmentize(spans)) place(segment);
  if (current.length > 0) lines.push(current);

  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const previous = lines[lines.length - 2];
    const available = widthAt(lines.length - 1);
    if (last.length === 1 && previous.length >= 3 && last[0].width < available * 0.16) {
      const moved = previous[previous.length - 1];
      if (moved.width + last[0].leadWidth + last[0].width <= available) {
        previous.pop();
        last.unshift(moved);
      }
    }
  }

  return lines.map((segments) => {
    const pieces = mergePieces(segments.flatMap((segment, index) => (index === 0 ? segment.body : [...segment.lead, ...segment.body])));
    return { pieces, width: totalWidth(pieces) };
  });
}

function measureSpan(text: string, textStyle: TextStyle): number {
  return totalWidth(mergePieces(shape(text, textStyle)));
}

// ---------------------------------------------------------------------------
// Display list and pagination
// ---------------------------------------------------------------------------

type TextOp = Readonly<{ kind: "text"; x: number; y: number; text: string; fontKey: string; size: number; color: string }>;
type RuleOp = Readonly<{ kind: "rule"; x1: number; x2: number; y: number; thickness: number; color: string }>;
type LinkOp = Readonly<{ kind: "link"; x: number; y: number; width: number; height: number; url: string }>;
type DrawOp = TextOp | RuleOp | LinkOp;

/** Ops are positioned relative to the block's top edge. */
type Block = Readonly<{
  spaceBefore: number;
  height: number;
  keepWithNext: boolean;
  ops: readonly DrawOp[];
}>;

type LaidOutPage = Readonly<{ ops: readonly DrawOp[] }>;

type Frame = Readonly<{ left: number; right: number; top: number; bottom: number }>;

function frameWidth(frame: Frame): number {
  return frame.right - frame.left;
}

/** Baseline offset that centres the cap-to-descender band inside a line box. */
function baselineIn(face: FaceId, size: number, lineHeight: number): number {
  const cap = faces()[face].capHeight * size;
  return (lineHeight - cap - DESCENDER_EM * size) / 2 + cap;
}

function fontKey(item: Piece): string {
  return faces()[item.style.face].subsets[item.subset].key;
}

/** Paints one line; consecutive pieces sharing a link (a subset switch inside an email) share one link rectangle. */
function drawLine(ops: DrawOp[], line: TextLine, x: number, baseline: number, linkTop: number, linkHeight: number): void {
  let cursor = x;
  let openLink = null as Readonly<{ index: number; url: string }> | null;
  for (const item of line.pieces) {
    ops.push({ kind: "text", x: cursor, y: baseline, text: item.text, fontKey: fontKey(item), size: item.style.size, color: item.style.color });
    const url = item.style.link;
    if (url && openLink?.url === url) {
      const link = ops[openLink.index] as LinkOp;
      ops[openLink.index] = { ...link, width: cursor + item.width - link.x };
    } else if (url) {
      ops.push({ kind: "link", x: cursor, y: linkTop, width: item.width, height: linkHeight, url });
      openLink = { index: ops.length - 1, url };
    } else {
      openLink = null;
    }
    cursor += item.width;
  }
}

type ParagraphLayout = Readonly<{ ops: DrawOp[]; height: number; lineCount: number }>;

/** Lays out wrapped text in line boxes of `lineHeight`, starting at y = 0. */
function layoutParagraph(input: Readonly<{
  spans: readonly InlineSpan[];
  x: number;
  width: number;
  firstLineWidth?: number;
  lineHeight: number;
  baseline: number;
}>): ParagraphLayout {
  const lines = breakLines(input.spans, (index) => (index === 0 ? input.firstLineWidth ?? input.width : input.width));
  const ops: DrawOp[] = [];
  lines.forEach((line, index) => {
    const top = index * input.lineHeight;
    drawLine(ops, line, input.x, top + input.baseline, top, input.lineHeight);
  });
  return { ops, height: lines.length * input.lineHeight, lineCount: lines.length };
}

function offsetOps(ops: readonly DrawOp[], dy: number): DrawOp[] {
  return ops.map((op) => ({ ...op, y: op.y + dy }));
}

/**
 * Places blocks top to bottom. A block that keeps with its successor moves to
 * a new page together with it, so headings and entry titles are never
 * stranded at a page bottom.
 */
function paginate(blocks: readonly Block[], frame: Frame): LaidOutPage[] {
  const pages: DrawOp[][] = [[]];
  let y = frame.top;
  let pageHasContent = false;
  const capacity = frame.bottom - frame.top;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    let spaceBefore = pageHasContent ? block.spaceBefore : 0;
    let chain = block.height;
    for (let next = index; blocks[next].keepWithNext && next + 1 < blocks.length; next += 1) {
      chain += blocks[next + 1].spaceBefore + blocks[next + 1].height;
    }
    const chainOverflows = y + spaceBefore + chain > frame.bottom && chain <= capacity;
    const blockOverflows = y + spaceBefore + block.height > frame.bottom;
    if (pageHasContent && (chainOverflows || blockOverflows)) {
      pages.push([]);
      y = frame.top;
      pageHasContent = false;
      spaceBefore = 0;
    }
    y += spaceBefore;
    pages[pages.length - 1].push(...offsetOps(block.ops, y));
    y += block.height;
    pageHasContent = true;
  }
  return pages.map((ops) => ({ ops }));
}

// ---------------------------------------------------------------------------
// Shared header
// ---------------------------------------------------------------------------

type ContactItem = Readonly<{ text: string; link: string | null }>;

function httpLink(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function mailtoLink(email: string): string | null {
  return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/u.test(email) ? `mailto:${email}` : null;
}

/** Same items and order as `contactLine` in the domain module. */
function contactItems(contact: DocumentContact): ContactItem[] {
  const items: ContactItem[] = [];
  const location = cleanText(contact.location);
  if (location) items.push({ text: location, link: null });
  const email = cleanText(contact.email);
  if (email) items.push({ text: email, link: mailtoLink(email) });
  const phone = cleanText(contact.phone);
  if (phone) items.push({ text: phone, link: null });
  const linkedin = cleanText(displayUrl(contact.linkedinUrl));
  if (linkedin) items.push({ text: linkedin, link: httpLink(contact.linkedinUrl) });
  const website = cleanText(displayUrl(contact.websiteUrl));
  if (website) items.push({ text: website, link: httpLink(contact.websiteUrl) });
  return items;
}

type HeaderSizes = Readonly<{ name: number; headline: number; contact: number }>;

/** One header for every document, so a résumé and its letter read as a set. */
const HEADER_SIZES: HeaderSizes = { name: 25, headline: 10, contact: 8.75 };

/** Name, optional headline, contact line, hairline. Identical on the résumé and the letter. */
function headerBlock(input: Readonly<{
  name: string;
  headline: string | null;
  contact: DocumentContact;
  frame: Frame;
  sizes: HeaderSizes;
}>): Block {
  const { frame, sizes } = input;
  const width = frameWidth(frame);
  const ops: DrawOp[] = [];
  /** Lays out one header line group so its first baseline lands at `firstBaseline`; returns the last baseline. */
  const place = (spans: readonly InlineSpan[], face: FaceId, size: number, lineHeight: number, firstBaseline: number): number => {
    const baseline = baselineIn(face, size, lineHeight);
    const layout = layoutParagraph({ spans, x: frame.left, width, lineHeight, baseline });
    ops.push(...offsetOps(layout.ops, firstBaseline - baseline));
    return firstBaseline + (layout.lineCount - 1) * lineHeight;
  };

  // The name's cap height sits on the top margin.
  let baseline = place(
    [{ text: requiredName(input.name), style: style("serifSemibold", sizes.name, INK) }],
    "serifSemibold",
    sizes.name,
    sizes.name * 1.1,
    faces().serifSemibold.capHeight * sizes.name,
  );

  const headline = cleanText(input.headline);
  if (headline) {
    // A headline that wraps breaks at its own " · " separators when the phrases fit.
    const headlineStyle = style("sansMedium", sizes.headline, ACCENT);
    const spans = headline.split(/(\s+[·|]\s+)/u).filter(Boolean).map((part, index): InlineSpan => (index % 2 === 1
      ? { text: ` ${part.trim()} `, style: headlineStyle, separator: true }
      : { text: part, style: headlineStyle, keepTogether: measureSpan(part, headlineStyle) <= width }));
    baseline = place(
      spans,
      "sansMedium",
      sizes.headline,
      sizes.headline * 1.35,
      baseline + sizes.name * 0.68,
    );
  }

  const items = contactItems(input.contact);
  if (items.length > 0) {
    const spans: InlineSpan[] = [];
    items.forEach((item, index) => {
      if (index > 0) spans.push({ text: " · ", style: style("sans", sizes.contact, MUTED), separator: true });
      spans.push({ text: item.text, style: style("sans", sizes.contact, MUTED, item.link), keepTogether: true });
    });
    baseline = place(spans, "sans", sizes.contact, sizes.contact * 1.5, baseline + (headline ? sizes.contact * 1.7 : sizes.name * 0.74));
  }

  const ruleY = baseline + Math.max(8, sizes.contact);
  ops.push({ kind: "rule", x1: frame.left, x2: frame.right, y: ruleY, thickness: 0.6, color: HEADER_RULE });
  return { spaceBefore: 0, height: ruleY + 0.6, keepWithNext: true, ops };
}

// ---------------------------------------------------------------------------
// Résumé layout
// ---------------------------------------------------------------------------

type ResumeDensity = Readonly<{
  body: number;
  leading: number;
  title: number;
  meta: number;
  context: number;
  heading: number;
  firstSectionGap: number;
  sectionGap: number;
  headingRuleGap: number;
  headingAfter: number;
  entryGap: number;
  headerAfter: number;
  bulletGap: number;
  groupGap: number;
  marginX: number;
  marginY: number;
}>;

/**
 * Loosest to tightest. Spacing tightens before type shrinks, and body type
 * never drops below 9.25pt.
 */
const RESUME_DENSITIES: readonly ResumeDensity[] = [
  { body: 10.5, leading: 1.34, title: 10.75, meta: 8.75, context: 9.75, heading: 9, firstSectionGap: 16, sectionGap: 15, headingRuleGap: 4, headingAfter: 6.5, entryGap: 10, headerAfter: 2, bulletGap: 2.8, groupGap: 2.5, marginX: 43.2, marginY: 39.6 },
  { body: 10.25, leading: 1.32, title: 10.5, meta: 8.5, context: 9.5, heading: 8.75, firstSectionGap: 14, sectionGap: 13.5, headingRuleGap: 3.75, headingAfter: 6, entryGap: 9, headerAfter: 1.75, bulletGap: 2.5, groupGap: 2.25, marginX: 43.2, marginY: 36 },
  { body: 10.25, leading: 1.29, title: 10.5, meta: 8.5, context: 9.5, heading: 8.75, firstSectionGap: 13, sectionGap: 12, headingRuleGap: 3.5, headingAfter: 5.5, entryGap: 7.5, headerAfter: 1.5, bulletGap: 2.2, groupGap: 2, marginX: 43.2, marginY: 36 },
  { body: 10.25, leading: 1.26, title: 10.5, meta: 8.5, context: 9.5, heading: 8.75, firstSectionGap: 11.5, sectionGap: 10.5, headingRuleGap: 3.5, headingAfter: 5, entryGap: 6.5, headerAfter: 1.25, bulletGap: 1.8, groupGap: 1.75, marginX: 43.2, marginY: 36 },
  { body: 10, leading: 1.24, title: 10.25, meta: 8.5, context: 9.25, heading: 8.5, firstSectionGap: 10, sectionGap: 9.5, headingRuleGap: 3.25, headingAfter: 4.5, entryGap: 5.5, headerAfter: 1, bulletGap: 1.5, groupGap: 1.5, marginX: 41.4, marginY: 34 },
  { body: 9.75, leading: 1.22, title: 10, meta: 8.25, context: 9, heading: 8.5, firstSectionGap: 9, sectionGap: 8.5, headingRuleGap: 3.25, headingAfter: 4, entryGap: 5, headerAfter: 1, bulletGap: 1.2, groupGap: 1.25, marginX: 39.6, marginY: 33 },
  { body: 9.5, leading: 1.2, title: 9.75, meta: 8, context: 8.75, heading: 8.25, firstSectionGap: 8, sectionGap: 8, headingRuleGap: 3, headingAfter: 3.75, entryGap: 4.5, headerAfter: 0.75, bulletGap: 1, groupGap: 1, marginX: 39.6, marginY: 32 },
  { body: 9.25, leading: 1.18, title: 9.5, meta: 8, context: 8.75, heading: 8.25, firstSectionGap: 7.5, sectionGap: 7.5, headingRuleGap: 3, headingAfter: 3.5, entryGap: 4, headerAfter: 0.75, bulletGap: 0.8, groupGap: 1, marginX: 39.6, marginY: 32 },
];

/** Index of the standard density: the loosest setting a two-page résumé uses. */
const STANDARD_DENSITY = 2;

function resumeFrame(density: ResumeDensity): Frame {
  return { left: density.marginX, right: PAGE_WIDTH - density.marginX, top: density.marginY, bottom: PAGE_HEIGHT - density.marginY };
}

function sectionHeadingBlock(text: string, frame: Frame, density: ResumeDensity, spaceBefore: number): Block {
  const size = density.heading;
  const baseline = faces().sansSemibold.capHeight * size;
  const layout = layoutParagraph({
    spans: [{ text: cleanText(text).toLocaleUpperCase("en-US"), style: style("sansSemibold", size, ACCENT) }],
    x: frame.left,
    width: frameWidth(frame),
    lineHeight: size * 1.3,
    baseline,
  });
  const ruleY = baseline + (layout.lineCount - 1) * size * 1.3 + density.headingRuleGap;
  return {
    spaceBefore,
    height: ruleY + density.headingAfter,
    keepWithNext: true,
    ops: [...layout.ops, { kind: "rule", x1: frame.left, x2: frame.right, y: ruleY, thickness: 0.5, color: SECTION_RULE }],
  };
}

function bodyLineHeight(density: ResumeDensity): number {
  return density.body * density.leading;
}

function bulletBlock(text: string, frame: Frame, density: ResumeDensity, spaceBefore: number, keepWithNext: boolean): Block {
  const lineHeight = bodyLineHeight(density);
  const hang = Math.round(density.body * 1.05 * 4) / 4;
  const baseline = baselineIn("serif", density.body, lineHeight);
  const layout = layoutParagraph({
    spans: [{ text: cleanText(text), style: style("serif", density.body, INK) }],
    x: frame.left + hang,
    width: frameWidth(frame) - hang,
    lineHeight,
    baseline,
  });
  const markSize = density.body * 0.92;
  const mark = shape("•", style("sans", markSize, BULLET_MARK))[0];
  const ops: DrawOp[] = [...layout.ops];
  if (mark) {
    ops.unshift({ kind: "text", x: frame.left + 0.5, y: baseline, text: mark.text, fontKey: fontKey(mark), size: markSize, color: BULLET_MARK });
  }
  return { spaceBefore, height: layout.height, keepWithNext, ops };
}

type EntryHeading = Readonly<{
  primary: string;
  secondary: string;
  location: string | null;
  dates: string | null;
  context: string | null;
}>;

function entryHeaderBlock(entry: EntryHeading, frame: Frame, density: ResumeDensity, spaceBefore: number, keepWithNext: boolean): Block {
  const width = frameWidth(frame);
  const lineHeight = Math.max(density.title * density.leading, density.title * 1.24);
  const baseline = baselineIn("serifSemibold", density.title, lineHeight);
  const dates = cleanText(entry.dates);
  const datesStyle = style("sans", density.meta, MUTED);
  const datesWidth = dates ? measureSpan(dates, datesStyle) : 0;

  const spans: InlineSpan[] = [];
  const primary = cleanText(entry.primary);
  const secondary = cleanText(entry.secondary);
  if (primary) spans.push({ text: primary, style: style("serifSemibold", density.title, INK) });
  if (secondary) {
    const secondaryStyle = style("serif", density.title, INK);
    const shortEnough = measureSpan(secondary, secondaryStyle) < width * 0.4;
    if (primary) spans.push({ text: ",", style: secondaryStyle, keepTogether: true }, { text: " ", style: secondaryStyle, separator: true });
    spans.push({ text: secondary, style: secondaryStyle, keepTogether: shortEnough });
  }
  const location = cleanText(entry.location);
  if (location) {
    spans.push(
      { text: " · ", style: style("sans", density.meta, MUTED), separator: true },
      { text: location, style: style("sans", density.meta, MUTED), keepTogether: true },
    );
  }

  // Dates share the title line unless they would squeeze the title below about half the width.
  const datesInline = Boolean(dates) && datesWidth <= width * 0.45;
  const title = layoutParagraph({
    spans,
    x: frame.left,
    width,
    firstLineWidth: datesInline ? width - datesWidth - 14 : width,
    lineHeight,
    baseline,
  });
  const ops: DrawOp[] = [...title.ops];
  let height = title.height;
  if (datesInline) {
    // Right-aligned on the first title baseline, drawn after the title so extraction reads title, then dates.
    drawLine(ops, { pieces: mergePieces(shape(dates, datesStyle)), width: datesWidth }, frame.right - datesWidth, baseline, 0, lineHeight);
  } else if (dates) {
    const datesLineHeight = density.meta * 1.5;
    const layout = layoutParagraph({
      spans: [{ text: dates, style: datesStyle }],
      x: frame.left,
      width,
      lineHeight: datesLineHeight,
      baseline: baselineIn("sans", density.meta, datesLineHeight),
    });
    ops.push(...offsetOps(layout.ops, height));
    height += layout.height;
  }

  const context = cleanText(entry.context);
  if (context) {
    const contextLineHeight = density.context * Math.max(density.leading, 1.22);
    const layout = layoutParagraph({
      spans: [{ text: context, style: style("serifItalic", density.context, MUTED) }],
      x: frame.left,
      width,
      lineHeight: contextLineHeight,
      baseline: baselineIn("serifItalic", density.context, contextLineHeight),
    });
    ops.push(...offsetOps(layout.ops, height));
    height += layout.height;
  }

  return { spaceBefore, height: height + (keepWithNext ? density.headerAfter : 0), keepWithNext, ops };
}

/**
 * Keeps an entry's title with its first bullet (and first two when there are
 * three or more), and never strands a single last bullet at a page top.
 */
function bulletKeeps(count: number): boolean[] {
  return Array.from({ length: count }, (_value, index) => count >= 3 && (index === 0 || index === count - 2));
}

function bulletKey(sectionIndex: number, entryIndex: number, bulletIndex: number): string {
  return `${sectionIndex}:${entryIndex}:${bulletIndex}`;
}

function experienceBlocks(
  entries: readonly ResumeExperienceEntry[],
  sectionIndex: number,
  frame: Frame,
  density: ResumeDensity,
  dropped: ReadonlySet<string>,
): Block[] {
  const blocks: Block[] = [];
  entries.forEach((entry, entryIndex) => {
    const bullets = entry.bullets
      .map((text, bulletIndex) => ({ text: cleanBullet(text), bulletIndex }))
      .filter((bullet) => bullet.text && !dropped.has(bulletKey(sectionIndex, entryIndex, bullet.bulletIndex)));
    blocks.push(entryHeaderBlock(
      { primary: entry.title, secondary: entry.organization, location: entry.location, dates: entry.dates, context: entry.context },
      frame,
      density,
      entryIndex === 0 ? 0 : density.entryGap,
      bullets.length > 0,
    ));
    const keeps = bulletKeeps(bullets.length);
    bullets.forEach((bullet, index) => {
      blocks.push(bulletBlock(bullet.text, frame, density, index === 0 ? 0 : density.bulletGap, keeps[index]));
    });
  });
  return blocks;
}

function educationBlocks(entries: readonly ResumeEducationEntry[], frame: Frame, density: ResumeDensity): Block[] {
  const blocks: Block[] = [];
  entries.forEach((entry, entryIndex) => {
    const details = entry.details.map(cleanBullet).filter(Boolean);
    blocks.push(entryHeaderBlock(
      { primary: entry.credential, secondary: entry.institution, location: entry.location, dates: entry.dates, context: null },
      frame,
      density,
      entryIndex === 0 ? 0 : density.entryGap * 0.7,
      details.length > 0,
    ));
    const keeps = bulletKeeps(details.length);
    details.forEach((detail, index) => {
      blocks.push(bulletBlock(detail, frame, density, index === 0 ? 0 : density.bulletGap, keeps[index]));
    });
  });
  return blocks;
}

function skillBlocks(groups: readonly Readonly<{ label: string | null; items: readonly string[] }>[], frame: Frame, density: ResumeDensity): Block[] {
  const lineHeight = bodyLineHeight(density);
  const baseline = baselineIn("serif", density.body, lineHeight);
  const blocks: Block[] = [];
  for (const group of groups) {
    const items = group.items.map(cleanText).filter(Boolean);
    const label = cleanText(group.label);
    // A label with no items carries no content; drawing "Label:" alone reads as a defect.
    if (items.length === 0) continue;
    const spans: InlineSpan[] = [];
    if (label) {
      spans.push({ text: `${label}:`, style: style("serifSemibold", density.body, INK), keepTogether: true });
    }
    items.forEach((item, index) => {
      const itemStyle = style("serif", density.body, INK);
      if (index > 0 || label) spans.push({ text: " ", style: itemStyle, separator: true });
      spans.push({ text: index < items.length - 1 ? `${item},` : item, style: itemStyle, keepTogether: true });
    });
    const layout = layoutParagraph({ spans, x: frame.left, width: frameWidth(frame), lineHeight, baseline });
    blocks.push({ spaceBefore: blocks.length === 0 ? 0 : density.groupGap, height: layout.height, keepWithNext: false, ops: layout.ops });
  }
  return blocks;
}

function summaryBlock(text: string, frame: Frame, density: ResumeDensity): Block {
  const lineHeight = density.body * (density.leading + 0.02);
  const layout = layoutParagraph({
    spans: [{ text: cleanText(text), style: style("serif", density.body, INK) }],
    x: frame.left,
    width: frameWidth(frame),
    lineHeight,
    baseline: baselineIn("serif", density.body, lineHeight),
  });
  return { spaceBefore: 0, height: layout.height, keepWithNext: false, ops: layout.ops };
}

function resumeBlocks(model: ResumeDocumentModel, density: ResumeDensity, dropped: ReadonlySet<string>): Block[] {
  const frame = resumeFrame(density);
  const blocks: Block[] = [
    headerBlock({
      name: model.name,
      headline: model.headline,
      contact: model.contact,
      frame,
      sizes: HEADER_SIZES,
    }),
  ];
  const sectionGap = () => (blocks.length === 1 ? density.firstSectionGap : density.sectionGap);

  const summary = cleanText(model.summary);
  if (summary) {
    blocks.push(sectionHeadingBlock("Summary", frame, density, sectionGap()), summaryBlock(summary, frame, density));
  }

  model.sections.forEach((section, sectionIndex) => {
    let content: Block[];
    switch (section.kind) {
      case "EXPERIENCE":
      case "PROJECTS":
        content = experienceBlocks(section.entries, sectionIndex, frame, density, dropped);
        break;
      case "EDUCATION":
        content = educationBlocks(section.entries, frame, density);
        break;
      case "SKILLS":
        content = skillBlocks(section.groups, frame, density);
        break;
      case "LIST": {
        const items = section.items.map(cleanBullet).filter(Boolean);
        const keeps = bulletKeeps(items.length);
        content = items.map((item, index) => bulletBlock(item, frame, density, index === 0 ? 0 : density.bulletGap, keeps[index]));
        break;
      }
    }
    if (content.length === 0) return;
    const heading = sectionHeading(section);
    blocks.push(...(heading ? [sectionHeadingBlock(heading, frame, density, sectionGap())] : []), ...content);
  });
  return blocks;
}

const STANDARD_HEADINGS: Readonly<Record<ResumeSection["kind"], string>> = {
  EXPERIENCE: "Experience",
  PROJECTS: "Projects",
  EDUCATION: "Education",
  SKILLS: "Skills",
  LIST: "",
};

/** A blank heading falls back to the standard name for its kind; a blank LIST heading draws none. */
function sectionHeading(section: ResumeSection): string {
  return cleanText(section.heading) || STANDARD_HEADINGS[section.kind];
}

type DroppableBullet = Readonly<{ key: string; text: string; order: number }>;

/**
 * Trailing bullets in trim order: the last entries of the last
 * EXPERIENCE/PROJECTS sections first, never the first bullet of an entry.
 */
function droppableBullets(model: ResumeDocumentModel, sectionLimit: number): DroppableBullet[] {
  const candidates: DroppableBullet[] = [];
  let order = 0;
  const documentOrder = new Map<string, number>();
  model.sections.forEach((section, sectionIndex) => {
    if (section.kind !== "EXPERIENCE" && section.kind !== "PROJECTS") return;
    section.entries.forEach((entry, entryIndex) => {
      entry.bullets.forEach((_bullet, bulletIndex) => documentOrder.set(bulletKey(sectionIndex, entryIndex, bulletIndex), order++));
    });
  });
  const sections = model.sections
    .map((section, sectionIndex) => ({ section, sectionIndex }))
    .filter(({ section }) => section.kind === "EXPERIENCE" || section.kind === "PROJECTS")
    .reverse()
    .slice(0, sectionLimit);
  for (const { section, sectionIndex } of sections) {
    if (section.kind !== "EXPERIENCE" && section.kind !== "PROJECTS") continue;
    for (let entryIndex = section.entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const bullets = section.entries[entryIndex].bullets;
      const kept = bullets.map((text, bulletIndex) => ({ text, bulletIndex })).filter((bullet) => cleanBullet(bullet.text));
      for (let index = kept.length - 1; index >= 1; index -= 1) {
        const key = bulletKey(sectionIndex, entryIndex, kept[index].bulletIndex);
        candidates.push({ key, text: kept[index].text, order: documentOrder.get(key) ?? 0 });
      }
    }
  }
  return candidates;
}

function bulletWordCount(model: ResumeDocumentModel): number {
  let words = 0;
  for (const section of model.sections) {
    if (section.kind !== "EXPERIENCE" && section.kind !== "PROJECTS") continue;
    for (const entry of section.entries) {
      for (const bullet of entry.bullets) words += cleanText(bullet).split(" ").filter(Boolean).length;
    }
  }
  return words;
}

type FittedDocument = Readonly<{ pages: readonly LaidOutPage[]; droppedBullets: readonly string[] }>;

function layoutResume(model: ResumeDocumentModel, density: ResumeDensity, dropped: ReadonlySet<string>): LaidOutPage[] {
  return paginate(resumeBlocks(model, density, dropped), resumeFrame(density));
}

function interpolateDensity(loose: ResumeDensity, tight: ResumeDensity, t: number): ResumeDensity {
  const mixed: Record<string, number> = {};
  for (const key of Object.keys(loose) as (keyof ResumeDensity)[]) mixed[key] = loose[key] + (tight[key] - loose[key]) * t;
  return mixed as ResumeDensity;
}

/**
 * Loosest density (from `start`) whose layout fits `maxPages`, if any. A
 * one-page fit is refined between the preset that overflowed and the one that
 * fit, so the page fills to its margin instead of stopping at a preset step.
 */
function loosestFit(model: ResumeDocumentModel, maxPages: number, dropped: ReadonlySet<string>, start = 0): LaidOutPage[] | null {
  for (let index = start; index < RESUME_DENSITIES.length; index += 1) {
    const pages = layoutResume(model, RESUME_DENSITIES[index], dropped);
    if (pages.length > maxPages) continue;
    if (maxPages > 1 || index === start) return pages;
    let best = pages;
    let overflowing = 0;
    let fitting = 1;
    for (let step = 0; step < 6; step += 1) {
      const t = (overflowing + fitting) / 2;
      const candidate = layoutResume(model, interpolateDensity(RESUME_DENSITIES[index - 1], RESUME_DENSITIES[index], t), dropped);
      if (candidate.length <= maxPages) {
        best = candidate;
        fitting = t;
      } else {
        overflowing = t;
      }
    }
    return best;
  }
  return null;
}

function droppedResult(pages: readonly LaidOutPage[], dropped: readonly DroppableBullet[]): FittedDocument {
  return { pages, droppedBullets: [...dropped].sort((left, right) => left.order - right.order).map((bullet) => bullet.text) };
}

/**
 * One page when the content allows it; spacing tightens first, then type
 * shrinks to the 9.25pt floor. A small remaining overflow trims the oldest
 * entries' last bullets; substantial careers get a second page, never a third.
 */
function fitResume(model: ResumeDocumentModel): FittedDocument {
  const onePage = loosestFit(model, 1, new Set());
  if (onePage) return { pages: onePage, droppedBullets: [] };

  const tightest = RESUME_DENSITIES[RESUME_DENSITIES.length - 1];
  if (bulletWordCount(model) < TWO_PAGE_BULLET_WORDS) {
    const candidates = droppableBullets(model, 1).slice(0, MAX_ONE_PAGE_DROPPED_BULLETS);
    for (let count = 1; count <= candidates.length; count += 1) {
      const dropped = candidates.slice(0, count);
      const keys = new Set(dropped.map((bullet) => bullet.key));
      if (layoutResume(model, tightest, keys).length > 1) continue;
      return droppedResult(loosestFit(model, 1, keys) ?? layoutResume(model, tightest, keys), dropped);
    }
  }

  const twoPages = loosestFit(model, 2, new Set(), STANDARD_DENSITY);
  if (twoPages) return { pages: twoPages, droppedBullets: [] };

  const candidates = droppableBullets(model, Number.POSITIVE_INFINITY);
  let low = 1;
  let high = candidates.length;
  let best: number | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const keys = new Set(candidates.slice(0, middle).map((bullet) => bullet.key));
    if (layoutResume(model, tightest, keys).length <= 2) {
      best = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  if (best === null) throw new Error("APPLICATION_DOCUMENT_PAGE_LIMIT: the résumé does not fit on two pages");
  const dropped = candidates.slice(0, best);
  const keys = new Set(dropped.map((bullet) => bullet.key));
  return droppedResult(loosestFit(model, 2, keys, STANDARD_DENSITY) ?? layoutResume(model, tightest, keys), dropped);
}

// ---------------------------------------------------------------------------
// Cover letter layout
// ---------------------------------------------------------------------------

type LetterDensity = Readonly<{ body: number; leading: number; paragraphGap: number }>;

const LETTER_DENSITIES: readonly LetterDensity[] = [
  { body: 11, leading: 1.42, paragraphGap: 9 },
  { body: 11, leading: 1.37, paragraphGap: 8 },
  { body: 10.75, leading: 1.33, paragraphGap: 7.5 },
  { body: 10.5, leading: 1.3, paragraphGap: 7 },
  { body: 10.25, leading: 1.28, paragraphGap: 6 },
];

const LETTER_FRAME: Frame = { left: 72, right: PAGE_WIDTH - 72, top: 50.4, bottom: PAGE_HEIGHT - 57.6 };

/** One block per line so long letters can break between lines, with two-line widow and orphan control. */
function letterParagraphBlocks(text: string, density: LetterDensity, spaceBefore: number, lastKeepsWithNext = false): Block[] {
  const lineHeight = density.body * density.leading;
  const baseline = baselineIn("serif", density.body, lineHeight);
  const width = frameWidth(LETTER_FRAME);
  const lines = breakLines([{ text: cleanText(text), style: style("serif", density.body, INK) }], () => width);
  return lines.map((line, index) => {
    const ops: DrawOp[] = [];
    drawLine(ops, line, LETTER_FRAME.left, baseline, 0, lineHeight);
    const count = lines.length;
    const keepWithNext = (index < count - 1 && (index === 0 || index === count - 2)) || (index === count - 1 && lastKeepsWithNext);
    return { spaceBefore: index === 0 ? spaceBefore : 0, height: lineHeight, keepWithNext, ops };
  });
}

function letterBlocks(model: CoverLetterDocumentModel, density: LetterDensity): Block[] {
  const blocks: Block[] = [headerBlock({ name: model.name, headline: null, contact: model.contact, frame: LETTER_FRAME, sizes: HEADER_SIZES })];
  // Date, recipient block, and salutation are separated by roughly one blank line each.
  const blankLine = density.body * density.leading;
  const afterHeader = 26;
  const dateLine = cleanText(model.dateLine);
  if (dateLine) blocks.push(...letterParagraphBlocks(dateLine, density, afterHeader));
  const recipients = model.recipientLines.map(cleanText).filter(Boolean);
  recipients.forEach((line, index) => {
    blocks.push(...letterParagraphBlocks(line, density, index === 0 ? (dateLine ? blankLine : afterHeader) : 0, index < recipients.length - 1));
  });
  const salutation = cleanText(model.salutation);
  if (salutation) blocks.push(...letterParagraphBlocks(salutation, density, dateLine || recipients.length > 0 ? blankLine : afterHeader, true));
  for (const paragraph of model.paragraphs.map(cleanText).filter(Boolean)) {
    blocks.push(...letterParagraphBlocks(paragraph, density, density.paragraphGap));
  }
  const closing = cleanText(model.closing);
  const signature = cleanText(model.signature);
  if (closing) blocks.push(...letterParagraphBlocks(closing, density, density.paragraphGap * 1.6, Boolean(signature)));
  if (signature) blocks.push(...letterParagraphBlocks(signature, density, closing ? density.body * 1.5 : density.paragraphGap * 1.6));
  return blocks;
}

function fitCoverLetter(model: CoverLetterDocumentModel): FittedDocument {
  for (const density of LETTER_DENSITIES) {
    const pages = paginate(letterBlocks(model, density), LETTER_FRAME);
    if (pages.length === 1) return { pages, droppedBullets: [] };
  }
  const pages = paginate(letterBlocks(model, LETTER_DENSITIES[0]), LETTER_FRAME);
  if (pages.length > 2) throw new Error("APPLICATION_DOCUMENT_PAGE_LIMIT: the cover letter does not fit on two pages");
  return { pages, droppedBullets: [] };
}

// ---------------------------------------------------------------------------
// PDF painting
// ---------------------------------------------------------------------------

type PdfInfo = Readonly<{ title: string; author: string }>;

function paintPdf(pages: readonly LaidOutPage[], info: PdfInfo): Promise<Uint8Array> {
  return new Promise((resolvePdf, reject) => {
    const document = new PDFDocument({
      autoFirstPage: false,
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      margin: 0,
      lang: "en-US",
      displayTitle: true,
      info: {
        Title: info.title,
        Author: info.author,
        Creator: "RoleDawn",
        Producer: `RoleDawn ${APPLICATION_DOCUMENT_RENDERER_RELEASE}`,
        CreationDate: PDF_FILE_ID_SEED_DATE,
      },
    });
    // The fixed date seeds a deterministic file ID. pdfkit still reads it while
    // finishing the file, but writes only enumerable keys into the Info
    // dictionary, so the PDF claims no creation time.
    Object.defineProperty(document.info, "CreationDate", { value: PDF_FILE_ID_SEED_DATE, enumerable: false, configurable: true, writable: true });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolvePdf(new Uint8Array(Buffer.concat(chunks))));
    try {
      for (const face of Object.values(faces())) {
        for (const subset of face.subsets) document.registerFont(subset.key, subset.bytes);
      }
      for (const page of pages) {
        document.addPage({ size: [PAGE_WIDTH, PAGE_HEIGHT], margin: 0 });
        for (const op of page.ops) {
          if (op.kind === "text") {
            document.font(op.fontKey).fontSize(op.size).fillColor(op.color).text(op.text, op.x, op.y, {
              lineBreak: false,
              baseline: "alphabetic",
              // pdfkit forwards this map to fontkit, which accepts `false` to disable a feature; the typings only model arrays.
              features: textFeatures() as unknown as PDFKit.Mixins.OpenTypeFeatures[],
            });
          } else if (op.kind === "rule") {
            document.save().lineWidth(op.thickness).lineCap("butt").strokeColor(op.color)
              .moveTo(op.x1, op.y).lineTo(op.x2, op.y).stroke().restore();
          } else {
            document.link(op.x, op.y, op.width, op.height, op.url);
          }
        }
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

function pdfDocument(bytes: Uint8Array, pageCount: number, droppedBullets: readonly string[]): RenderedDocument {
  return Object.freeze({ bytes, mimeType: PDF_MEDIA_TYPE, pageCount, droppedBullets: Object.freeze([...droppedBullets]) });
}

export async function renderResumePdf(model: ResumeDocumentModel): Promise<RenderedDocument> {
  const fitted = fitResume(model);
  const name = requiredName(model.name);
  const bytes = await paintPdf(fitted.pages, { title: `${name} – Résumé`, author: name });
  return pdfDocument(bytes, fitted.pages.length, fitted.droppedBullets);
}

export async function renderCoverLetterPdf(model: CoverLetterDocumentModel): Promise<RenderedDocument> {
  const fitted = fitCoverLetter(model);
  const name = requiredName(model.name);
  const bytes = await paintPdf(fitted.pages, { title: `${name} – Cover Letter`, author: name });
  return pdfDocument(bytes, fitted.pages.length, []);
}

/** Cover letter first; résumé starts on a new page; same fitting rules. */
export async function renderApplicationPdf(cover: CoverLetterDocumentModel, resume: ResumeDocumentModel): Promise<RenderedDocument> {
  const letter = fitCoverLetter(cover);
  const fitted = fitResume(resume);
  const pages = [...letter.pages, ...fitted.pages];
  const name = requiredName(resume.name);
  const bytes = await paintPdf(pages, { title: `${name} – Application`, author: name });
  return pdfDocument(bytes, pages.length, fitted.droppedBullets);
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const TWIPS_PER_POINT = 20;
const DOCX_PAGE = { width: PAGE_WIDTH * TWIPS_PER_POINT, height: PAGE_HEIGHT * TWIPS_PER_POINT };
const DOCX_RESUME_MARGIN = { top: 720, bottom: 720, left: 864, right: 864 };
const DOCX_LETTER_MARGIN = { top: 1008, bottom: 1152, left: 1440, right: 1440 };
const DOCX_BODY_FONT = "Cambria";
const DOCX_LABEL_FONT = "Calibri";
const DOCX_BULLETS = "roledawn-bullet";

function hex(color: string): string {
  return color.replace("#", "").toUpperCase();
}

function halfPoints(points: number): number {
  return Math.round(points * 2);
}

function docxStyles(): IStylesOptions {
  const paragraphStyle = (
    id: string,
    name: string,
    run: IRunStylePropertiesOptions,
    paragraph: IParagraphStylePropertiesOptions,
  ): IParagraphStyleOptions => ({ id, name, basedOn: "Normal", next: "Normal", quickFormat: true, run, paragraph });
  return {
    default: {
      document: {
        run: { font: DOCX_BODY_FONT, size: halfPoints(10), color: hex(INK) },
        paragraph: { spacing: { before: 0, after: 0 } },
      },
      heading1: {
        run: { font: DOCX_LABEL_FONT, size: halfPoints(9), bold: true, color: hex(ACCENT) },
        paragraph: {
          spacing: { before: 240, after: 100 },
          keepNext: true,
          keepLines: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(SECTION_RULE), space: 2 } },
        },
      },
    },
    paragraphStyles: [
      paragraphStyle("RoleDawnName", "RoleDawn Name", { font: DOCX_BODY_FONT, size: halfPoints(25), bold: true, color: hex(INK) }, { spacing: { after: 60 }, keepNext: true }),
      paragraphStyle("RoleDawnHeadline", "RoleDawn Headline", { font: DOCX_LABEL_FONT, size: halfPoints(10), color: hex(ACCENT) }, { spacing: { after: 40 }, keepNext: true }),
      paragraphStyle("RoleDawnContact", "RoleDawn Contact", { font: DOCX_LABEL_FONT, size: halfPoints(8.75), color: hex(MUTED) }, {
        spacing: { after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: hex(HEADER_RULE), space: 6 } },
      }),
      paragraphStyle("RoleDawnEntry", "RoleDawn Entry", { font: DOCX_BODY_FONT, size: halfPoints(10.5) }, { spacing: { before: 140, after: 20 }, keepNext: true, keepLines: true }),
      paragraphStyle("RoleDawnContext", "RoleDawn Context", { font: DOCX_BODY_FONT, size: halfPoints(9.5), italics: true, color: hex(MUTED) }, { spacing: { after: 20 }, keepNext: true }),
      paragraphStyle("RoleDawnBullet", "RoleDawn Bullet", { font: DOCX_BODY_FONT, size: halfPoints(10) }, { spacing: { after: 40, line: 264 }, keepLines: true }),
      paragraphStyle("RoleDawnBody", "RoleDawn Body", { font: DOCX_BODY_FONT, size: halfPoints(10) }, { spacing: { after: 40, line: 276 } }),
      paragraphStyle("RoleDawnLetter", "RoleDawn Letter", { font: DOCX_BODY_FONT, size: halfPoints(11) }, { spacing: { after: 180, line: 324 } }),
    ],
  };
}

function docxNumbering(): INumberingOptions {
  return {
    config: [{
      reference: DOCX_BULLETS,
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: "•",
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: { indent: { left: 216, hanging: 216 } },
          run: { font: DOCX_BODY_FONT, color: hex(BULLET_MARK) },
        },
      }],
    }],
  };
}

function docxHeader(name: string, headline: string | null, contact: DocumentContact): Paragraph[] {
  const paragraphs = [new Paragraph({ style: "RoleDawnName", children: [new TextRun(requiredName(name))] })];
  const cleanHeadline = cleanText(headline);
  if (cleanHeadline) paragraphs.push(new Paragraph({ style: "RoleDawnHeadline", children: [new TextRun(cleanHeadline)] }));
  const children: ParagraphChild[] = [];
  contactItems(contact).forEach((item, index) => {
    if (index > 0) children.push(new TextRun(" · "));
    children.push(item.link
      ? new ExternalHyperlink({ link: item.link, children: [new TextRun({ text: item.text, color: hex(MUTED) })] })
      : new TextRun(item.text));
  });
  paragraphs.push(new Paragraph({ style: "RoleDawnContact", children }));
  return paragraphs;
}

function docxEntry(entry: EntryHeading, textWidthTwips: number): Paragraph[] {
  const children: ParagraphChild[] = [];
  const primary = cleanText(entry.primary);
  const secondary = cleanText(entry.secondary);
  if (primary) children.push(new TextRun({ text: primary, bold: true }));
  if (secondary) children.push(new TextRun(primary ? `, ${secondary}` : secondary));
  const location = cleanText(entry.location);
  if (location) children.push(new TextRun({ text: ` · ${location}`, font: DOCX_LABEL_FONT, size: halfPoints(8.75), color: hex(MUTED) }));
  const dates = cleanText(entry.dates);
  if (dates) children.push(new TextRun({ children: [new Tab(), dates], font: DOCX_LABEL_FONT, size: halfPoints(8.75), color: hex(MUTED) }));
  const paragraphs = [new Paragraph({ style: "RoleDawnEntry", tabStops: [{ type: TabStopType.RIGHT, position: textWidthTwips - 10 }], children })];
  const context = cleanText(entry.context);
  if (context) paragraphs.push(new Paragraph({ style: "RoleDawnContext", children: [new TextRun(context)] }));
  return paragraphs;
}

function docxBullet(text: string, keepNext = false): Paragraph {
  return new Paragraph({ style: "RoleDawnBullet", numbering: { reference: DOCX_BULLETS, level: 0 }, keepNext, children: [new TextRun(cleanBullet(text))] });
}

function docxHeading(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(cleanText(text).toLocaleUpperCase("en-US"))] });
}

function docxFile(input: Readonly<{ title: string; author: string; margin: typeof DOCX_RESUME_MARGIN; children: Paragraph[] }>): Document {
  return new Document({
    creator: "RoleDawn",
    lastModifiedBy: "RoleDawn",
    title: input.title,
    description: `Rendered by ${APPLICATION_DOCUMENT_RENDERER_RELEASE} for ${input.author}`,
    styles: docxStyles(),
    numbering: docxNumbering(),
    sections: [{
      properties: { page: { size: DOCX_PAGE, margin: input.margin } },
      children: input.children,
    }],
  });
}

/**
 * Declares the two Office fonts with substitution hints: where Cambria or
 * Calibri is missing, Word and LibreOffice use the alternate name (Georgia,
 * Arial) and the family/PANOSE class to pick the closest installed face.
 */
const DOCX_FONT_TABLE = [
  "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
  "<w:fonts xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">",
  `<w:font w:name="${DOCX_BODY_FONT}"><w:altName w:val="Georgia"/><w:panose1 w:val="02040503050406030204"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>`,
  `<w:font w:name="${DOCX_LABEL_FONT}"><w:altName w:val="Arial"/><w:panose1 w:val="020F0502020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>`,
  "</w:fonts>",
].join("");

async function packDocx(document: Document): Promise<RenderedDocument> {
  const bytes = new Uint8Array(await Packer.toBuffer(document, false, [{ path: "word/fontTable.xml", data: DOCX_FONT_TABLE }]));
  return Object.freeze({ bytes, mimeType: DOCX_MEDIA_TYPE, pageCount: null, droppedBullets: Object.freeze([]) });
}

/**
 * The DOCX carries every bullet: Word owns pagination there, so page fitting
 * (and any trimming) applies to the PDF only.
 */
export async function renderResumeDocx(model: ResumeDocumentModel): Promise<RenderedDocument> {
  const textWidth = DOCX_PAGE.width - DOCX_RESUME_MARGIN.left - DOCX_RESUME_MARGIN.right;
  const children: Paragraph[] = docxHeader(model.name, model.headline, model.contact);
  const summary = cleanText(model.summary);
  if (summary) children.push(docxHeading("Summary"), new Paragraph({ style: "RoleDawnBody", children: [new TextRun(summary)] }));
  for (const section of model.sections) {
    const content: Paragraph[] = [];
    if (section.kind === "EXPERIENCE" || section.kind === "PROJECTS") {
      for (const entry of section.entries) {
        const bullets = entry.bullets.map(cleanBullet).filter(Boolean);
        const keeps = bulletKeeps(bullets.length);
        content.push(...docxEntry({ primary: entry.title, secondary: entry.organization, location: entry.location, dates: entry.dates, context: entry.context }, textWidth));
        bullets.forEach((bullet, index) => content.push(docxBullet(bullet, keeps[index])));
      }
    } else if (section.kind === "EDUCATION") {
      for (const entry of section.entries) {
        content.push(...docxEntry({ primary: entry.credential, secondary: entry.institution, location: entry.location, dates: entry.dates, context: null }, textWidth));
        for (const detail of entry.details.map(cleanBullet).filter(Boolean)) content.push(docxBullet(detail));
      }
    } else if (section.kind === "SKILLS") {
      for (const group of section.groups) {
        const items = group.items.map(cleanText).filter(Boolean);
        const label = cleanText(group.label);
        if (items.length === 0) continue;
        const runs = label ? [new TextRun({ text: `${label}: `, bold: true })] : [];
        content.push(new Paragraph({ style: "RoleDawnBody", children: [...runs, new TextRun(items.join(", "))] }));
      }
    } else {
      for (const item of section.items.map(cleanBullet).filter(Boolean)) content.push(docxBullet(item));
    }
    const heading = sectionHeading(section);
    if (content.length > 0) children.push(...(heading ? [docxHeading(heading)] : []), ...content);
  }
  const name = requiredName(model.name);
  return packDocx(docxFile({ title: `${name} – Résumé`, author: name, margin: DOCX_RESUME_MARGIN, children }));
}

export async function renderCoverLetterDocx(model: CoverLetterDocumentModel): Promise<RenderedDocument> {
  const children: Paragraph[] = docxHeader(model.name, null, model.contact);
  const letterParagraph = (text: string, spacing: Readonly<{ before?: number; after?: number }>, keepNext = false) =>
    new Paragraph({ style: "RoleDawnLetter", spacing, keepNext, children: [new TextRun(cleanText(text))] });
  const dateLine = cleanText(model.dateLine);
  if (dateLine) children.push(letterParagraph(dateLine, { before: 480, after: 200 }));
  const recipients = model.recipientLines.map(cleanText).filter(Boolean);
  for (const line of recipients) children.push(letterParagraph(line, { before: 0, after: 0 }, true));
  const salutation = cleanText(model.salutation);
  if (salutation) children.push(letterParagraph(salutation, { before: 360, after: 180 }, true));
  for (const paragraph of model.paragraphs.map(cleanText).filter(Boolean)) children.push(letterParagraph(paragraph, { after: 180 }));
  const closing = cleanText(model.closing);
  if (closing) children.push(letterParagraph(closing, { before: 120, after: 360 }, true));
  const signature = cleanText(model.signature);
  if (signature) children.push(letterParagraph(signature, { after: 0 }));
  const name = requiredName(model.name);
  return packDocx(docxFile({ title: `${name} – Cover Letter`, author: name, margin: DOCX_LETTER_MARGIN, children }));
}

// ---------------------------------------------------------------------------
// Text QA
// ---------------------------------------------------------------------------

const QA_TOKEN = /[\p{L}\p{N}][\p{L}\p{N}+.#-]{2,}/gu;

function qaTokens(text: string): Set<string> {
  return new Set(text.normalize("NFC").toLocaleLowerCase("en-US").match(QA_TOKEN) ?? []);
}

async function extractPdfPages(bytes: Uint8Array): Promise<Readonly<{ pages: string[]; pageCount: number }>> {
  // pdf.js transfers the buffer it is given; hand it a copy.
  const pdf = await getDocumentProxy(Uint8Array.from(bytes), {
    disableFontFace: true,
    useWorkerFetch: false,
    verbosity: 0,
  });
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        let text = "";
        for (const item of content.items) {
          if (!("str" in item)) continue;
          // pdf.js already emits spaces for visual gaps; adjacent runs (a font
          // subset switch inside "Łukasz") must join without one.
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
        pages.push(text.replace(/[ \t]+\n/gu, "\n").trim());
      } finally {
        page.cleanup();
      }
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Extracts text from rendered bytes (pages separated by "\f" for PDFs) and
 * reports the share of expected tokens found, in [0, 1].
 */
export async function verifyRenderedText(
  document: RenderedDocument,
  expectedText: string,
): Promise<Readonly<{ coverage: number; pageCount: number | null; text: string }>> {
  let text: string;
  let pageCount: number | null;
  if (document.mimeType === PDF_MEDIA_TYPE) {
    const extracted = await extractPdfPages(document.bytes);
    text = extracted.pages.join("\n\f\n");
    pageCount = extracted.pageCount;
  } else if (document.mimeType === DOCX_MEDIA_TYPE) {
    const extracted = await mammoth.extractRawText({ buffer: Buffer.from(document.bytes) });
    text = extracted.value.replace(/\n{3,}/gu, "\n\n").trim();
    pageCount = null;
  } else {
    throw new Error(`APPLICATION_DOCUMENT_UNSUPPORTED_MEDIA_TYPE: ${document.mimeType}`);
  }
  const expected = qaTokens(expectedText);
  const actual = qaTokens(text);
  const found = [...expected].filter((token) => actual.has(token)).length;
  return Object.freeze({ coverage: expected.size === 0 ? 1 : found / expected.size, pageCount, text });
}
