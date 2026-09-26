import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import RichText from "../components/RichText";

describe("Table font-size inheritance in RichText", () => {
  it("renders table with text-[inherit] and without text-sm", () => {
    const tableData = [
      ["Tiêu đề 1", "Tiêu đề 2"],
      ["Dòng 1 ô 1\nNội dung nhiều dòng", "Dòng 1 ô 2 số liệu 123"],
    ];
    // Encode like docxParser encTbl
    const SENT_OPEN = "\u27E6";
    const SENT_CLOSE = "\u27E7";
    const richString = `Cho bảng số liệu sau:${SENT_OPEN}TBL:${encodeURIComponent(JSON.stringify(tableData))}${SENT_CLOSE}Hỏi giá trị là bao nhiêu?`;

    const { container } = render(<RichText text={richString} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // Must NOT have text-sm which reduces font size
    expect(table?.className).not.toContain("text-sm");
    // Must contain text-[inherit]
    expect(table?.className).toContain("text-[inherit]");

    const cells = container.querySelectorAll("td");
    expect(cells.length).toBe(4);
    cells.forEach((cell) => {
      expect(cell.className).toContain("text-[inherit]");
      expect(cell.className).not.toContain("text-sm");
    });

    // Check content inside cells
    expect(cells[0].textContent).toContain("Tiêu đề 1");
    expect(cells[1].textContent).toContain("Tiêu đề 2");
    expect(cells[2].textContent).toContain("Nội dung nhiều dòng");
    expect(cells[3].textContent).toContain("số liệu 123");
  });
});
