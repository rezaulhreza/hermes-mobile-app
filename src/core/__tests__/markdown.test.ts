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

    expect(table.kind === "table" && columnWidths(table)).toEqual([64, 200]);
  });
});

describe("marks around links and line break tags", () => {
  it("keeps a link inside bold marks as a link", () => {
    expect(parseSpans("**[Rug](https://shop.test/rug)** grey")).toEqual([
      { kind: "link", text: "Rug", url: "https://shop.test/rug", bold: true },
      { kind: "text", text: " grey" }
    ]);
  });

  it("turns a br tag into a line break", () => {
    expect(parseSpans("one<br>two<br/>three")).toEqual([{ kind: "text", text: "one\ntwo\nthree" }]);
  });

  it("keeps a br tag inside code", () => {
    expect(parseSpans("`<br>`")).toEqual([{ kind: "code", text: "<br>" }]);
  });

  it("sizes a column by the longest line of its cells, links by their words", () => {
    const table = parseMarkdown("| Item |\n|---|\n| **[Rug](https://shop.test/a/very/long/address/for/a/rug)**<br>Grey |")[0];

    expect(table.kind === "table" && columnWidths(table)).toEqual([64]);
  });
});

describe("a picture after its words", () => {
  const kinds = (text: string) => parseMarkdown(text).map((block) => block.kind);

  it("pairs each picture with the words above it when that is the pattern", () => {
    const blocks = parseMarkdown("One line.\n\n![a](https://p.test/a.jpg)\n\nTwo line.\n\n![b](https://p.test/b.jpg)\n\n**Total**");

    expect(blocks.map((block) => block.kind)).toEqual(["card", "card", "paragraph"]);
    expect(blocks[0]?.kind === "card" && blocks[0].picture.url).toBe("https://p.test/a.jpg");
    expect(blocks[1]?.kind === "card" && blocks[1].lines[0]?.[0]).toEqual({ kind: "text", text: "Two line." });
  });

  it("keeps a picture before its words as it was", () => {
    expect(kinds("![a](https://p.test/a.jpg)\n\nOne line.\n\n![b](https://p.test/b.jpg)\n\nTwo line.")).toEqual(["card", "card"]);
  });

  it("keeps a picture after an introduction that ends with a colon", () => {
    expect(kinds("Here they are:\n\n![a](https://p.test/a.jpg)\n\nOne line.\n\n![b](https://p.test/b.jpg)\n\nTwo line.")).toEqual(["paragraph", "card", "card"]);
  });
});
