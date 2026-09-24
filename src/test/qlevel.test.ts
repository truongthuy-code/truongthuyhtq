import { describe, it, expect } from "vitest";
import { parseTextExam } from "@/lib/textExamParser";
const raw = `PHẦN I
Câu 1. ND1
*A. a
B. b
C. c
D. d
Câu 2. ND2
*A. a
B. b
C. c
D. d
Câu 10. ND10
*A. a
B. b
C. c
D. d
Câu 1 (NB). ND-NB
*A. a
B. b
C. c
D. d
Câu 2 (TH). ND-TH
*A. a
B. b
C. c
D. d
Câu 3 (vd). ND-VD
*A. a
B. b
C. c
D. d
Câu 4 (VDC). ND-VDC
*A. a
B. b
C. c
D. d`;
describe("levels", () => {
  it("parses 7 questions", () => {
    const e = parseTextExam(raw);
    expect(e.partI.length).toBe(7);
    expect(e.partI.map(q => q.text)).toEqual(["ND1","ND2","ND10","ND-NB","ND-TH","ND-VD","ND-VDC"]);
    expect(e.partI.map(q => q.level)).toEqual([null,null,null,"NB","TH","VD","VDC"]);
    expect(e.partI.every(q => q.answer === "A")).toBe(true);
  });
});
