import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import RichText from "@/components/RichText";

describe("RichText Code Rendering & High Contrast Styling", () => {
  it("renders Python code with code-content class and light mode background classes", () => {
    const raw = "⟦CODE:python:" + encodeURIComponent("for i in range(5):\n    print(i)") + "⟧";
    const { container } = render(<RichText text={raw} />);

    const pre = container.querySelector("pre.code-content");
    expect(pre).not.toBeNull();
    // Verify light background class is applied
    expect(pre?.className).toContain("code-content");
    expect(pre?.className).toContain("bg-slate-50");
    expect(pre?.className).toContain("text-slate-900");
    expect(pre?.className).toContain("border-slate-200");
    // Verify it doesn't have hardcoded solo dark background without dark: prefix
    expect(pre?.className).not.toMatch(/(?<!dark:)bg-slate-900/);

    // Verify indentation in rendered text
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("    print(i)");
    expect(code?.textContent).toContain("for i in range(5):");
  });

  it("renders HTML code without executing tags, keeping them readable inside code-content", () => {
    const htmlSnippet = "<html>\n    <body>\n        <h1>Hello</h1>\n    </body>\n</html>";
    const raw = "⟦CODE:html:" + encodeURIComponent(htmlSnippet) + "⟧";
    const { container } = render(<RichText text={raw} />);

    const pre = container.querySelector("pre.code-content");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("<html>");
    expect(code?.textContent).toContain("    <body>");
    expect(code?.textContent).toContain("        <h1>Hello</h1>");
  });

  it("renders multi-line SQL code with indentation and clear syntax structure", () => {
    const sqlSnippet = "SELECT *\nFROM Students\nWHERE Score >= 8\n    AND Class = '12A1'\nORDER BY Score DESC;";
    const raw = "⟦CODE:sql:" + encodeURIComponent(sqlSnippet) + "⟧";
    const { container } = render(<RichText text={raw} />);

    const pre = container.querySelector("pre.code-content");
    expect(pre).not.toBeNull();
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("SELECT *");
    expect(code?.textContent).toContain("FROM Students");
    expect(code?.textContent).toContain("    AND Class = '12A1'");
  });

  it("renders code in a table cell with light background and monospace formatting", () => {
    const cellContent = "⟦CODE:python:" + encodeURIComponent("def add(a, b):\n    return a + b") + "⟧";
    const tblData = JSON.stringify([[cellContent]]);
    const raw = "⟦TBL:" + encodeURIComponent(tblData) + "⟧";
    const { container } = render(<RichText text={raw} />);

    const pre = container.querySelector("td pre.code-content");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("def add(a, b):");
    expect(pre?.textContent).toContain("    return a + b");
  });
});
