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

export type Span =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly url: string };

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
  | {
      readonly kind: "table";
      readonly header: readonly (readonly Span[])[];
      readonly align: readonly Align[];
      /** Every row has as many cells as the header. */
      readonly rows: readonly (readonly (readonly Span[])[])[];
    }
  | { readonly kind: "rule" };

export type Align = "left" | "center" | "right";

const FENCE = /^\s*```(.*)$/;
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
      blocks.push({ kind: "code", language: language.length > 0 ? language : null, text: body.join("\n") });
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
  return blocks;
}

function depthOf(indent: string): number {
  return Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), 3);
}

// One pass, leftmost match first. Code is first in the alternation so a mark
// inside backticks stays code.
const INLINE =
  /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\*([^*\s][^*\n]*?)\*|\b_([^_\n]+?)_\b|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function parseSpans(source: string): Span[] {
  return parseMarks(source);
}

function parseMarks(source: string): Span[] {
  const spans: Span[] = [];
  let last = 0;

  for (const match of source.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) {
      spans.push({ kind: "text", text: source.slice(last, at) });
    }

    if (match[1] !== undefined) {
      spans.push({ kind: "code", text: match[1] });
    } else if (match[2] !== undefined || match[3] !== undefined) {
      spans.push({ kind: "strong", text: match[2] ?? match[3] ?? "" });
    } else if (match[4] !== undefined || match[5] !== undefined) {
      spans.push({ kind: "em", text: match[4] ?? match[5] ?? "" });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      // Only a web address opens. Any other scheme reads as the text it was.
      if (/^https?:\/\//i.test(match[7])) {
        spans.push({ kind: "link", text: match[6], url: match[7] });
      } else {
        spans.push({ kind: "text", text: match[0] });
      }
    }

    last = at + match[0].length;
  }

  if (last < source.length) {
    spans.push({ kind: "text", text: source.slice(last) });
  }

  return spans;
}

export function spansText(spans: readonly Span[]): string {
  return spans.map((span) => span.text).join("");
}

const CELL_CHAR_WIDTH = 8;
const CELL_PADDING = 24;
const COLUMN_MIN = 64;
const COLUMN_MAX = 240;

/**
 * The width of each column of a table, in points. A phone cannot fit every
 * table, so the table scrolls sideways and each column is as wide as its
 * longest cell, inside limits: a long cell wraps and never takes the screen.
 */
export function columnWidths(table: Extract<Block, { kind: "table" }>): number[] {
  return table.header.map((cell, column) => {
    const longest = Math.max(spansText(cell).length, ...table.rows.map((row) => spansText(row[column] ?? []).length));

    return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, longest * CELL_CHAR_WIDTH + CELL_PADDING));
  });
}
