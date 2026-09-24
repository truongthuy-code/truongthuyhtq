// Minimal OMML (Office Math Markup Language) → LaTeX converter.
// Handles common constructs: r, t, f (fraction), sSup, sSub, sSubSup, rad (sqrt),
// nary (sum/int/prod), d (delimiter), m (matrix), func, acc, bar, box, eqArr, lim.
// Falls back to plain text when an element is unknown.

const M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";

function localName(n: Element) {
  return n.localName || n.nodeName.replace(/^.*:/, "");
}

function children(n: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = n.childNodes[i];
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

function findChild(n: Element, name: string): Element | null {
  for (const c of children(n)) if (localName(c) === name) return c;
  return null;
}

function textOf(n: Element): string {
  let s = "";
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = n.childNodes[i];
    if (c.nodeType === 3) s += c.nodeValue || "";
    else if (c.nodeType === 1) s += textOf(c as Element);
  }
  return s;
}

function escSym(s: string): string {
  return s
    .replace(/\\/g, "\\backslash ")
    .replace(/([{}_^#%&$])/g, "\\$1");
}

function naryOp(op: string): string {
  switch (op) {
    case "∑": return "\\sum";
    case "∏": return "\\prod";
    case "∫": return "\\int";
    case "∮": return "\\oint";
    case "⋃": return "\\bigcup";
    case "⋂": return "\\bigcap";
    case "∐": return "\\coprod";
    default: return op || "\\sum";
  }
}

function convert(n: Element): string {
  const tag = localName(n);
  switch (tag) {
    case "oMathPara":
    case "oMath": {
      return children(n).map(convert).join("");
    }
    case "r": {
      // Run: collect <m:t> text
      let s = "";
      for (const c of children(n)) {
        if (localName(c) === "t") s += textOf(c);
      }
      return s;
    }
    case "t": return textOf(n);
    case "f": {
      const num = findChild(n, "num");
      const den = findChild(n, "den");
      return `\\frac{${num ? children(num).map(convert).join("") : ""}}{${den ? children(den).map(convert).join("") : ""}}`;
    }
    case "sSup": {
      const e = findChild(n, "e");
      const sup = findChild(n, "sup");
      return `{${e ? children(e).map(convert).join("") : ""}}^{${sup ? children(sup).map(convert).join("") : ""}}`;
    }
    case "sSub": {
      const e = findChild(n, "e");
      const sub = findChild(n, "sub");
      return `{${e ? children(e).map(convert).join("") : ""}}_{${sub ? children(sub).map(convert).join("") : ""}}`;
    }
    case "sSubSup": {
      const e = findChild(n, "e");
      const sub = findChild(n, "sub");
      const sup = findChild(n, "sup");
      return `{${e ? children(e).map(convert).join("") : ""}}_{${sub ? children(sub).map(convert).join("") : ""}}^{${sup ? children(sup).map(convert).join("") : ""}}`;
    }
    case "rad": {
      const deg = findChild(n, "deg");
      const e = findChild(n, "e");
      const ebody = e ? children(e).map(convert).join("") : "";
      const dbody = deg ? children(deg).map(convert).join("") : "";
      return dbody ? `\\sqrt[${dbody}]{${ebody}}` : `\\sqrt{${ebody}}`;
    }
    case "nary": {
      const naryPr = findChild(n, "naryPr");
      let op = "∑";
      if (naryPr) {
        const chr = findChild(naryPr, "chr");
        if (chr) {
          const v = chr.getAttributeNS(M_NS, "val") || chr.getAttribute("m:val") || "";
          if (v) op = v;
        }
      }
      const sub = findChild(n, "sub");
      const sup = findChild(n, "sup");
      const e = findChild(n, "e");
      let s = naryOp(op);
      if (sub) s += `_{${children(sub).map(convert).join("")}}`;
      if (sup) s += `^{${children(sup).map(convert).join("")}}`;
      if (e) s += `{${children(e).map(convert).join("")}}`;
      return s;
    }
    case "d": {
      const dPr = findChild(n, "dPr");
      let beg = "(", end = ")";
      if (dPr) {
        const begChr = findChild(dPr, "begChr");
        const endChr = findChild(dPr, "endChr");
        if (begChr) beg = begChr.getAttributeNS(M_NS, "val") || begChr.getAttribute("m:val") || "(";
        if (endChr) end = endChr.getAttributeNS(M_NS, "val") || endChr.getAttribute("m:val") || ")";
      }
      const inner = children(n).filter((c) => localName(c) === "e").map((e) => children(e).map(convert).join("")).join(", ");
      return `\\left${beg === "{" ? "\\{" : beg}${inner}\\right${end === "}" ? "\\}" : end}`;
    }
    case "m": {
      // matrix
      const rows = children(n).filter((c) => localName(c) === "mr");
      const body = rows.map((r) =>
        children(r).filter((c) => localName(c) === "e").map((e) => children(e).map(convert).join("")).join(" & ")
      ).join(" \\\\ ");
      return `\\begin{matrix}${body}\\end{matrix}`;
    }
    case "func": {
      const fName = findChild(n, "fName");
      const e = findChild(n, "e");
      return `${fName ? children(fName).map(convert).join("") : ""}\\left(${e ? children(e).map(convert).join("") : ""}\\right)`;
    }
    case "acc": {
      const e = findChild(n, "e");
      return `\\hat{${e ? children(e).map(convert).join("") : ""}}`;
    }
    case "bar": {
      const e = findChild(n, "e");
      return `\\overline{${e ? children(e).map(convert).join("") : ""}}`;
    }
    case "limLow": {
      const e = findChild(n, "e");
      const lim = findChild(n, "lim");
      return `${e ? children(e).map(convert).join("") : ""}_{${lim ? children(lim).map(convert).join("") : ""}}`;
    }
    case "limUpp": {
      const e = findChild(n, "e");
      const lim = findChild(n, "lim");
      return `${e ? children(e).map(convert).join("") : ""}^{${lim ? children(lim).map(convert).join("") : ""}}`;
    }
    default: {
      // Walk children, ignoring unknown wrappers
      return children(n).map(convert).join("");
    }
  }
}

export function ommlElementToLatex(el: Element): string {
  try {
    return convert(el).trim();
  } catch {
    return textOf(el);
  }
}
