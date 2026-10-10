import { columnWidths, parseMarkdown, parseSpans } from "../markdown";

describe("parseMarkdown", () => {
  it("reads paragraphs, headings and both kinds of list", () => {
    const blocks = parseMarkdown("# Plan\n\nFirst line\nsecond line\n\n- one\n  - nested\n1. first\n2) second");

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "item",
      "item",
      "item",
      "item",
    ]);
    expect(blocks[1]).toEqual({
      kind: "paragraph",
      spans: [{ kind: "text", text: "First line\nsecond line" }],
    });
    expect(blocks[3]).toMatchObject({ kind: "item", marker: "•", depth: 1 });
    expect(blocks[4]).toMatchObject({ kind: "item", marker: "1." });
    expect(blocks[5]).toMatchObject({ kind: "item", marker: "2." });
  });

  it("keeps a fenced block as written, marks and all", () => {
    const blocks = parseMarkdown("```ts\nconst a = **b**;\n# not a heading\n```\nafter");

    expect(blocks[0]).toEqual({ kind: "code", language: "ts", text: "const a = **b**;\n# not a heading" });
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("reads a fence that has not closed yet as code, which is a streaming answer", () => {
    const blocks = parseMarkdown("Here:\n```\nline one\nline");

    expect(blocks[1]).toEqual({ kind: "code", language: null, text: "line one\nline" });
  });

  it("reads a quote and a rule", () => {
    expect(parseMarkdown("> said\n\n---").map((block) => block.kind)).toEqual(["quote", "rule"]);
  });

  it("returns nothing for nothing", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});

describe("parseSpans", () => {
  it("reads the four inline marks", () => {
    expect(parseSpans("a **b** *c* `d` [e](https://example.com) f")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "em", text: "c" },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", text: "e", url: "https://example.com" },
      { kind: "text", text: " f" },
    ]);
  });

  it("leaves an unclosed mark as the text it is", () => {
    expect(parseSpans("half **bold and `code")).toEqual([{ kind: "text", text: "half **bold and `code" }]);
  });

  it("does not read a mark inside code", () => {
    expect(parseSpans("`a **b** c`")).toEqual([{ kind: "code", text: "a **b** c" }]);
  });

  it("does not turn a multiplication or a snake_case name into emphasis", () => {
    expect(parseSpans("2 * 3 * 4 and user_id_value")).toEqual([
      { kind: "text", text: "2 * 3 * 4 and user_id_value" },
    ]);
  });

  it("refuses a link that is not a web address", () => {
    expect(parseSpans("[x](javascript:alert(1))")[0]).toMatchObject({ kind: "text" });
  });
});

describe("tables", () => {
  const source = "Before\n\n| Name | Count | Note |\n|:-----|------:|:----:|\n| `a|b` | 12 | **ok** |\n| short |\n\nAfter";

  it("reads the header, the alignment and the rows", () => {
    const blocks = parseMarkdown(source);

    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "table", "paragraph"]);
    expect(blocks[1]).toMatchObject({
      kind: "table",
      align: ["left", "right", "center"],
      header: [[{ kind: "text", text: "Name" }], [{ kind: "text", text: "Count" }], [{ kind: "text", text: "Note" }]],
    });

    const table = blocks[1] as Extract<(typeof blocks)[number], { kind: "table" }>;

    expect(table.rows[0]).toEqual([[{ kind: "code", text: "a|b" }], [{ kind: "text", text: "12" }], [{ kind: "strong", text: "ok" }]]);
    // A short row is filled, so every row has one cell per column.
    expect(table.rows[1]).toEqual([[{ kind: "text", text: "short" }], [], []]);
  });

  it("reads a header with no dashes line yet as text", () => {
    expect(parseMarkdown("| Name | Count |").map((block) => block.kind)).toEqual(["paragraph"]);
    expect(parseMarkdown("a | b\n---").map((block) => block.kind)).toEqual(["paragraph", "rule"]);
  });

  it("sizes a column by its longest cell, inside limits", () => {
    const table = parseMarkdown("| A | B |\n|---|---|\n| x | " + "long ".repeat(30) + "|")[0];

    expect(table.kind === "table" && columnWidths(table)).toEqual([64, 240]);
  });
});
