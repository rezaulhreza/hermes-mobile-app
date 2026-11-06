/**
 * The markdown an answer is written in, as blocks and spans.
 *
 * An answer arrives as markdown. This is the small subset a chat answer uses: headings, paragraphs, lists,
 * quotes, fenced code, tables, and four inline marks. Anything else stays as the text
 * it was written as, so nothing a model wrote is ever dropped.
 *
 * The parse is pure and runs on every delta of a streaming answer, so an
 * unclosed fence or mark must read as text and never throw.
 */

import { type Draft, draftFrom } from "./drafts";
import { type InfoCard, infoCardFrom } from "./info-cards";
import { texToText } from "./tex";

export type Span =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  // `bold` is set when the link stands inside bold marks.
  | { readonly kind: "link"; readonly text: string; readonly url: string; readonly bold?: boolean }
  // A mark for the page a sentence comes from: a link with no words of its
  // own, a bare address, or links alone in brackets. `text` is the name shown.
  | { readonly kind: "source"; readonly text: string; readonly links: readonly SourceLink[] }
  | { readonly kind: "image"; readonly text: string; readonly url: string }
  // Inline math: `text` is the TeX as plain characters ("x² + α"), `tex` the source.
  | { readonly kind: "math"; readonly text: string; readonly tex: string };

export interface SourceLink {
  readonly text: string;
  readonly url: string;
}

export interface Picture {
  readonly alt: string;
  readonly url: string;
}

export type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly spans: readonly Span[] }
  | { readonly kind: "paragraph"; readonly spans: readonly Span[] }
  | { readonly kind: "quote"; readonly spans: readonly Span[] }
  | {
      readonly kind: "item";
      /** "•" for a bullet, or the number as written. */
      readonly marker: string;
      readonly depth: number;
      readonly spans: readonly Span[];
    }
  | { readonly kind: "code"; readonly language: string | null; readonly text: string }
  // A block of math ($$ ... $$, or a math fence), typeset by the web view of the answer.
  // `done` is false while a streaming answer has not closed it yet.
  | { readonly kind: "math"; readonly tex: string; readonly done: boolean }
  // A Mermaid diagram (a mermaid fence), drawn as a picture once its fence is closed.
  | { readonly kind: "diagram"; readonly code: string; readonly done: boolean }
  | {
      readonly kind: "table";
      readonly header: readonly (readonly Span[])[];
      readonly align: readonly Align[];
      /** Every row has as many cells as the header. */
      readonly rows: readonly (readonly (readonly Span[])[])[];
    }
  | { readonly kind: "rule" }
  | { readonly kind: "image"; readonly picture: Picture }
  // A message Hermes wrote for the user to send.
  | { readonly kind: "draft"; readonly draft: Draft }
  // A call, an event, a place, a reminder, a payment or a contact to act on.
  | { readonly kind: "info"; readonly card: InfoCard }
  // A result with a picture: the picture, then the lines that came with it.
  | { readonly kind: "card"; readonly picture: Picture; readonly lines: readonly (readonly Span[])[] };

export type Align = "left" | "center" | "right";

const FENCE = /^\s*```(.*)$/;
const MATH_FENCES = new Set(["math", "latex", "tex", "katex"]);
// Inline math: $...$ that does not start or end with a space and is not a sum of money
// ("$5 and $10"), or \( ... \). A code span is cut out first: its dollars are code.
const INLINE_MATH = /(?<![\\$\w])\$(?![\s\d$])([^$\n]+?)(?<![\s\\])\$(?![\w$])|\\\((.+?)\\\)/g;
const CODE_SPAN = /`[^`\n]*`/g;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
// The line under a table header: dashes per column, colons for the alignment.
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of one table line. A pipe inside backticks or after a backslash is text. */
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inCode = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "`") {
      inCode = !inCode;
      cell += char;
    } else if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());

  // The pipes at the two ends are optional and make an empty first and last cell.
  if (cells[0] === "") {
    cells.shift();
  }
  if (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }

  return cells;
}

function alignOf(rule: string): Align {
  return rule.startsWith(":") && rule.endsWith(":") ? "center" : rule.endsWith(":") ? "right" : "left";
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseSpans(paragraph.join("\n")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      // A fence that never closes is a streaming answer mid-block: everything
      // after it is code until the rest arrives.
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      const language = (fence[1] ?? "").trim();
      const done = index < lines.length;
      const lower = language.toLowerCase();
      if (lower === "mermaid") {
        blocks.push({ kind: "diagram", code: body.join("\n"), done });
      } else if (MATH_FENCES.has(lower)) {
        blocks.push({ kind: "math", tex: body.join("\n").trim(), done });
      } else {
        blocks.push({ kind: "code", language: language.length > 0 ? language : null, text: body.join("\n") });
      }
      continue;
    }

    // A block of math: "$$" on a line of its own, or "$$ ... $$" on one line.
    if (line.trim().startsWith("$$")) {
      const opening = line.trim().slice(2);
      const closes = opening.trimEnd().endsWith("$$") && opening.trim().length > 2;
      if (closes) {
        flush();
        blocks.push({ kind: "math", tex: opening.trimEnd().slice(0, -2).trim(), done: true });
        continue;
      }
      flush();
      const body: string[] = opening.trim() ? [opening] : [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimEnd().endsWith("$$")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      const done = index < lines.length;
      if (done) {
        body.push((lines[index] ?? "").trimEnd().slice(0, -2));
      }
      blocks.push({ kind: "math", tex: body.join("\n").trim(), done });
      continue;
    }

    if (line.trim().length === 0) {
      flush();
      continue;
    }

    // A table is a line with a pipe and the dashes line under it. Until the
    // dashes line arrives (a streaming answer), the header reads as text.
    const under = lines[index + 1] ?? "";
    if (line.includes("|") && under.includes("-") && TABLE_RULE.test(under)) {
      const header = tableCells(line);
      const rules = tableCells(under);

      if (header.length > 0 && header.length === rules.length) {
        flush();
        const rows: Span[][][] = [];
        index += 2;
        while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim().length > 0) {
          const cells = tableCells(lines[index] ?? "");
          // A short row gets empty cells; cells past the header are dropped.
          rows.push(header.map((_, column) => parseSpans(cells[column] ?? "")));
          index += 1;
        }
        index -= 1;
        blocks.push({ kind: "table", header: header.map((cell) => parseSpans(cell)), align: rules.map(alignOf), rows });
        continue;
      }
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min((heading[1] ?? "#").length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, spans: parseSpans(heading[2] ?? "") });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      blocks.push({
        kind: "item",
        marker: "•",
        depth: depthOf(bullet[1] ?? ""),
        spans: parseSpans(bullet[2] ?? ""),
      });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flush();
      blocks.push({
        kind: "item",
        marker: `${numbered[2]}.`,
        depth: depthOf(numbered[1] ?? ""),
        spans: parseSpans(numbered[3] ?? ""),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", spans: parseSpans(quote[1] ?? "") });
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return withPictures(withDrafts(blocks));
}

/**
 * A quote that is a draft becomes one block. Each line of a quote is a block
 * of its own, so the lines that follow each other are read as one quote.
 */
function withDrafts(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) {
      continue;
    }
    if (block.kind !== "quote") {
      out.push(block);
      continue;
    }

    let end = index;
    while (blocks[end + 1]?.kind === "quote") {
      end += 1;
    }

    const run = blocks.slice(index, end + 1);
    const before = out[out.length - 1];
    const lead = before?.kind === "paragraph" ? spansText(before.spans) : "";
    const lines = run.map((quote) => (quote.kind === "quote" ? quote.spans : []));
    const card = infoCardFrom(lines);
    const draft = card ? null : draftFrom(lead, lines);

    if (card) {
      out.push({ kind: "info", card });
    } else if (draft) {
      out.push({ kind: "draft", draft });
    } else {
      out.push(...run);
    }
    index = end;
  }

  return out;
}

function splitLines(spans: readonly Span[]): Span[][] {
  const lines: Span[][] = [[]];

  for (const span of spans) {
    if (span.kind !== "text") {
      lines[lines.length - 1]?.push(span);
      continue;
    }

    span.text.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part.length > 0) {
        lines[lines.length - 1]?.push({ kind: "text", text: part });
      }
    });
  }

  return lines.filter((line) => line.some((span) => span.text.trim().length > 0));
}

/**
 * A picture with words is one result: the picture goes to the side of its
 * words. The words are in the same paragraph, or in the paragraph right
 * under a picture that stands alone.
 */
function withPictures(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  const alone = (block: Block | undefined) => pictureOf(block)?.lines.length === 0;
  const first = blocks.findIndex((block) => alone(block));
  const before = blocks[first - 1];
  // Words that come first and the picture after them, again and again: each picture is for the words above it.
  const trailing =
    first > 0 &&
    before?.kind === "paragraph" &&
    !spansText(before.spans).trim().endsWith(":") &&
    blocks[first + 1]?.kind === "paragraph" &&
    alone(blocks[first + 2]);

  for (const block of blocks) {
    const found = pictureOf(block);
    const last = out[out.length - 1];

    if (found) {
      const { picture, lines } = found;

      if (lines.length === 0 && trailing && last?.kind === "paragraph") {
        out[out.length - 1] = { kind: "card", picture, lines: splitLines(last.spans) };
      } else {
        out.push(lines.length > 0 ? { kind: "card", picture, lines } : { kind: "image", picture });
      }
    } else if (block.kind === "paragraph" && last?.kind === "image") {
      out[out.length - 1] = { kind: "card", picture: last.picture, lines: splitLines(block.spans) };
    } else {
      out.push(block);
    }
  }

  return out;
}

/** The picture a paragraph or an item starts with, and the lines of words after it. */
function pictureOf(block: Block | undefined): { picture: { alt: string; url: string }; lines: Span[][] } | null {
  if (block?.kind !== "paragraph" && block?.kind !== "item") {
    return null;
  }

  const image = block.spans.find((span) => span.text.trim().length > 0);

  return image?.kind === "image" ? { picture: { alt: image.text, url: image.url }, lines: splitLines(block.spans.filter((span) => span !== image)) } : null;
}

function depthOf(indent: string): number {
  return Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), 3);
}

// One pass, leftmost match first. Code is first in the alternation so a mark
// inside backticks stays code.
// After the old marks: a picture, links alone in brackets, and a bare address.
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^*\s][^*\n]*?)\*|\b_([^_\n]+?)_\b|\[([^\]\n]+)\]\(([^)\s]+)\)|!\[([^\]\n]*)\]\(([^)\s]+)\)|\(((?:\s*\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)\s*[,;]?)+)\)|(https?:\/\/[^\s<>()[\]]+)/g;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function siteOf(url: string): string {
  return (/^https?:\/\/([^/?#:@\s]+)/i.exec(url)?.[1] ?? "").toLowerCase().replace(/^www\./, "");
}

/** The words of a link say nothing of their own: a number, the address, or the name of the site. */
function isMark(text: string, url: string): boolean {
  const words = text.trim().toLowerCase();
  const site = siteOf(url);

  return /^\[?\d{1,3}\]?$/.test(words) || /^https?:\/\//.test(words) || words.replace(/^www\./, "") === site || words === site.split(".")[0];
}

function sourceOf(links: readonly SourceLink[]): Span {
  // A number or an address is no name: the site is. "Reuters" for reuters.com stays as it was written.
  const named = links.map((link) => (/^\s*(\[?\d|https?:\/\/)/i.test(link.text) ? { text: siteOf(link.url), url: link.url } : link));

  return { kind: "source", text: named[0]?.text ?? "", links: named };
}

export function parseSpans(source: string): Span[] {
  if (!source.includes("$") && !source.includes("\\(")) {
    return parseMarks(source);
  }

  // The parts outside code spans can hold math. A code span goes to the marks whole.
  const spans: Span[] = [];
  let last = 0;
  const outside = (text: string) => {
    let at = 0;
    for (const match of text.matchAll(INLINE_MATH)) {
      const start = match.index ?? 0;
      if (start > at) {
        spans.push(...parseMarks(text.slice(at, start)));
      }
      const tex = (match[1] ?? match[2] ?? "").trim();
      spans.push({ kind: "math", text: texToText(tex), tex });
      at = start + match[0].length;
    }
    if (at < text.length) {
      spans.push(...parseMarks(text.slice(at)));
    }
  };

  for (const code of source.matchAll(CODE_SPAN)) {
    const start = code.index ?? 0;
    outside(source.slice(last, start));
    spans.push(...parseMarks(code[0]));
    last = start + code[0].length;
  }
  outside(source.slice(last));

  return spans;
}

// A line break written as a tag is a line break. The tag is not said.
function breaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n");
}

// Bold or italic words can hold a link: `**[name](url)**`. The link stays a link and takes the mark.
function marked(inner: string, kind: "strong" | "em"): Span[] {
  if (!/\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/i.test(inner)) {
    return [{ kind, text: breaks(inner) }];
  }

  return parseMarks(inner).map((span): Span => {
    if (span.kind === "text") {
      return { kind, text: span.text };
    }

    return span.kind === "link" ? { ...span, bold: kind === "strong" } : span;
  });
}

function parseMarks(source: string): Span[] {
  const spans: Span[] = [];
  let last = 0;

  for (const match of source.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) {
      spans.push({ kind: "text", text: breaks(source.slice(last, at)) });
    }

    if (match[1] !== undefined) {
      spans.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined || match[3] !== undefined) {
      spans.push(...marked(match[2] ?? match[3] ?? "", "strong"));
    } else if (match[4] !== undefined || match[5] !== undefined) {
      spans.push(...marked(match[4] ?? match[5] ?? "", "em"));
    } else if (match[6] !== undefined && match[7] !== undefined) {
      // Only a web address opens. Any other scheme reads as the text it was.
      if (/^https?:\/\//i.test(match[7])) {
        spans.push(isMark(match[6], match[7]) ? sourceOf([{ text: match[6], url: match[7] }]) : { kind: "link", text: match[6], url: match[7] });
      } else {
        spans.push({ kind: "text", text: match[0] });
      }
    }

    let end = at + match[0].length;

    if (match[8] !== undefined && match[9] !== undefined) {
      spans.push(/^https?:\/\//i.test(match[9]) ? { kind: "image", text: match[8], url: match[9] } : { kind: "text", text: match[0] });
    } else if (match[10] !== undefined) {
      spans.push(sourceOf([...match[10].matchAll(LINK)].map((link) => ({ text: link[1] ?? "", url: link[2] ?? "" }))));
    } else if (match[11] !== undefined) {
      // The full stop or the comma after an address is of the sentence.
      const url = match[11].replace(/[.,;:!?'"]+$/, "");
      spans.push(sourceOf([{ text: url, url }]));
      end = at + url.length;
    }

    last = end;
  }

  if (last < source.length) {
    spans.push({ kind: "text", text: breaks(source.slice(last)) });
  }

  return spans;
}

export function spansText(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

const CELL_CHAR_WIDTH = 8;
const CELL_PADDING = 24;
const COLUMN_MIN = 64;
const COLUMN_MAX = 200;
// A column of pictures is as wide as a picture and its padding.
const PICTURE_COLUMN = 56 + 24;

/**
 * The width of each column of a table, in points. A phone cannot fit every
 * table, so the table scrolls sideways and each column is as wide as its
 * longest cell, inside limits: a long cell wraps and never takes the screen.
 */
export function columnWidths(table: Extract<Block, { kind: "table" }>): number[] {
  return table.header.map((cell, column) => {
    // A cell with line breaks is as wide as its longest line.
    const widest = (spans: readonly Span[]) => Math.max(0, ...spansText(spans).split("\n").map((line) => line.length));
    const longest = Math.max(widest(cell), ...table.rows.map((row) => widest(row[column] ?? [])));

    const pictures = [cell, ...table.rows.map((row) => row[column] ?? [])].some((spans) => spans.some((span) => span.kind === "image"));

    return pictures ? PICTURE_COLUMN : Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, longest * CELL_CHAR_WIDTH + CELL_PADDING));
  });
}
