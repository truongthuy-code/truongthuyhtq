import { useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import { ZoomIn, X } from "lucide-react";

const SENT_OPEN = "\u27E6";
const SENT_CLOSE = "\u27E7";

type Token =
  | { kind: "text"; value: string }
  | { kind: "math"; latex: string }
  | { kind: "code"; lang: string; content: string }
  | { kind: "img"; src: string }
  | { kind: "tbl"; rows: string[][] };

/** Detect $..$, $$..$$, \(..\), \[..\] inside plain text and split into math tokens. */
function tokenizePlain(s: string): Token[] {
  const out: Token[] = [];
  // Order matters: $$..$$ before $..$, \[..\] before \(..\)
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\\w])\$([^\$\n]+?)\$(?![\w])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ kind: "text", value: s.slice(last, m.index) });
    const latex = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (latex) out.push({ kind: "math", latex });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", value: s.slice(last) });
  return out;
}

function detectLangSimple(code: string): string {
  const t = code.toLowerCase();
  if (
    /(?:<!doctype\s+html|<\/?(?:html|head|body|div|span|p|a|table|thead|tbody|tr|th|td|script|style|ul|ol|li|h[1-6]|form|input|button|label|select|option|textarea|header|footer|nav|section|article|main|aside|img|link|meta|title)[>\s/])/i.test(
      t
    )
  ) {
    return "html";
  }
  if (
    /\b(?:select\b[\s\S]*?\bfrom|insert\s+into|update\b[\s\S]*?\bset|create\s+table|delete\s+from|alter\s+table|drop\s+table|where\b[\s\S]*?\b(?:and|or|order\s+by|group\s+by)|order\s+by\b|group\s+by\b)\b/i.test(
      t
    ) ||
    /(?:^|\n)\s*(?:select\b|from\b|where\b|order\s+by\b|group\s+by\b|insert\s+into|update\b|delete\s+from|create\s+table)/i.test(
      t
    )
  ) {
    return "sql";
  }
  if (/#include\s*<|\b(?:int\s+main|std::|cout\s*<<|cin\s*>>|printf\s*\(|scanf\s*\()/i.test(code)) {
    return "cpp";
  }
  if (/\b(?:program\s+\w+|begin\b[\s\S]*?\bend[.;]|writeln\s*\(|readln\s*\()\b/i.test(t)) {
    return "pascal";
  }
  if (
    /\b(?:def\s+\w+|class\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(|elif\b|self\b|lambda\b|range\s*\(|len\s*\(|__init__|input\s*\(|int\s*\(|float\s*\(|str\s*\(|append\s*\(|pop\s*\(|keys\s*\(|values\s*\(|items\s*\()\b/i.test(
      code
    ) ||
    /(?:^|\n)\s*(?:if|for|while|elif|else|def|class|try|except|finally|with)\b.*:\s*(?:\n|$)/i.test(
      code
    ) ||
    /(?:^|\n)[ \t]{2,}(?:print|return|pass|break|continue|yield)\b/i.test(code)
  ) {
    return "python";
  }
  if (/\b(?:console\.log|function\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|=>|document\.getElementById)\b/i.test(code)) {
    return "javascript";
  }
  return "plaintext";
}

function sanitizeSafeHtml(html: string): string {
  return html.replace(/<(\/?[a-zA-Z0-9]+)([^>]*)>/g, (_match, tag, attrs) => {
    const t = tag.toLowerCase().replace(/^\//, "");
    if (["b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "mark", "br"].includes(t)) {
      return `<${tag}>`;
    }
    if (t === "span") {
      const colorMatch = attrs.match(/style=["']color:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)["']/i);
      if (colorMatch) {
        return `<span ${colorMatch[0]}>`;
      }
      return tag.startsWith("/") ? "</span>" : "<span>";
    }
    // Không nuốt mất thẻ lạ (như <div>, <p>, <h1>, <html> trong code HTML).
    // Escape để hiển thị đúng dưới dạng text mà không bị render thành DOM!
    return `&lt;${tag}${attrs}&gt;`;
  });
}

function isCodeLine(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  if (/^[ \t]{2,}/.test(s)) {
    if (/[:;=+\-*/><()[\]{}#&|!~,"'%\\]/.test(s)) return true;
    if (/^[ \t]{2,}(?:else:|finally:|try:|except\b|return\b|break\b|continue\b|pass\b|yield\b|AND\b|OR\b)/i.test(s)) return true;
  }
  if (
    /^\s*(?:def\s+\w+|class\s+\w+|import\s+\w+|from\s+\w+|return\b|if\s+.*:|elif\s+.*:|else:|while\s+.*:|for\s+.*:|try:|except\b|finally:|with\s+.*:|#include\s*<|SELECT\b|FROM\b|WHERE\b|ORDER\s+BY\b|GROUP\s+BY\b|INSERT\s+INTO|UPDATE\b|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|<!DOCTYPE|<\/?(?:html|head|body|div|span|p|a|table|tr|td|h[1-6]|ul|ol|li)[>\s/]|program\s+\w+|begin\s*$|end[.;]\s*$)/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  const pushPlainChunk = (txt: string) => {
    if (!txt) return;
    if (!txt.includes("\n")) {
      if (isCodeLine(txt)) {
        const lang = detectLangSimple(txt);
        if (
          lang !== "plaintext" &&
          /^(?:<!DOCTYPE|<\/?(?:html|head|body|div|p|h[1-6]|table|form)|SELECT\b|CREATE\s+TABLE)/i.test(
            txt.trim()
          )
        ) {
          out.push({ kind: "code", lang, content: txt });
          return;
        }
      }
      out.push(...tokenizePlain(txt));
      return;
    }

    const lines = txt.split("\n");
    const isCode = lines.map((l) => isCodeLine(l));
    let codeGroup: string[] = [];
    let textGroup: string[] = [];

    const flushCodeGroup = () => {
      if (codeGroup.length === 0) return;
      while (codeGroup.length > 0 && codeGroup[codeGroup.length - 1].trim() === "") {
        codeGroup.pop();
      }
      const fullCode = codeGroup.join("\n");
      const lang = detectLangSimple(fullCode);
      if (codeGroup.length >= 2 || (lang !== "plaintext" && isCodeLine(fullCode))) {
        out.push({ kind: "code", lang: lang || "plaintext", content: fullCode });
      } else {
        out.push(...tokenizePlain(fullCode));
      }
      codeGroup = [];
    };

    const flushTextGroup = () => {
      if (textGroup.length === 0) return;
      out.push(...tokenizePlain(textGroup.join("\n")));
      textGroup = [];
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const isBlank = line.trim() === "";
      const nextCodeOffset = lines.slice(idx + 1).findIndex((_l, off) => isCode[idx + 1 + off]);
      const nextNonBlankOffset = lines.slice(idx + 1).findIndex((l) => l.trim() !== "");
      const isBlankInsideCode =
        isBlank && codeGroup.length > 0 && nextCodeOffset !== -1 && nextCodeOffset === nextNonBlankOffset;

      if (isCode[idx] || isBlankInsideCode) {
        flushTextGroup();
        codeGroup.push(line);
      } else {
        flushCodeGroup();
        textGroup.push(line);
      }
    }
    flushCodeGroup();
    flushTextGroup();
  };

  const pushText = (txt: string) => {
    if (!txt) return;
    // Hỗ trợ cả markdown code fences ```lang?\n(content)```
    const codeFenceRe = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = codeFenceRe.exec(txt)) !== null) {
      if (m.index > last) {
        pushPlainChunk(txt.slice(last, m.index));
      }
      const rawLang = m[1]?.trim().toLowerCase() || "";
      const content = m[2];
      const lang = rawLang || detectLangSimple(content);
      out.push({ kind: "code", lang: lang || "plaintext", content });
      last = m.index + m[0].length;
    }
    if (last < txt.length) {
      pushPlainChunk(txt.slice(last));
    }
  };

  while (i < s.length) {
    const open = s.indexOf(SENT_OPEN, i);
    if (open === -1) {
      if (i < s.length) pushText(s.slice(i));
      break;
    }
    if (open > i) pushText(s.slice(i, open));
    const close = s.indexOf(SENT_CLOSE, open);
    if (close === -1) {
      pushText(s.slice(open));
      break;
    }
    const payload = s.slice(open + 1, close);
    if (payload.startsWith("MATH:")) {
      out.push({ kind: "math", latex: payload.slice(5) });
    } else if (payload.startsWith("CODE:")) {
      const rest = payload.slice(5);
      const sep = rest.indexOf(":");
      const lang = sep === -1 ? "plaintext" : rest.slice(0, sep);
      const content = sep === -1 ? "" : decodeURIComponent(rest.slice(sep + 1));
      out.push({ kind: "code", lang, content });
    } else if (payload.startsWith("IMG:")) {
      out.push({ kind: "img", src: decodeURIComponent(payload.slice(4)) });
    } else if (payload.startsWith("TBL:")) {
      try {
        const rows = JSON.parse(decodeURIComponent(payload.slice(4))) as string[][];
        out.push({ kind: "tbl", rows });
      } catch {/* skip */}
    } else {
      pushText(s.slice(open, close + 1));
    }
    i = close + 1;
  }

  // Merge consecutive or newline-separated code blocks into a single block
  const merged: Token[] = [];
  for (let j = 0; j < out.length; j++) {
    const cur = out[j];
    const prev = merged[merged.length - 1];

    if (cur.kind === "code") {
      if (prev && prev.kind === "code") {
        const lang = prev.lang && prev.lang !== "plaintext" ? prev.lang : cur.lang;
        prev.lang = lang;
        prev.content = prev.content + "\n" + cur.content;
        continue;
      }
    } else if (cur.kind === "text" && /^\s*$/.test(cur.value) && cur.value.includes("\n")) {
      const next = out[j + 1];
      if (prev && prev.kind === "code" && next && next.kind === "code") {
        const lang = prev.lang && prev.lang !== "plaintext" ? prev.lang : next.lang;
        prev.lang = lang;
        prev.content = prev.content + cur.value + next.content;
        j++; // skip next
        continue;
      }
    }
    merged.push(cur);
  }

  return merged;
}

export default function RichText({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text || ""), [text]);
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  return (
    <>
      <span className={className ? `rich-text-root ${className}` : "rich-text-root"}>
        {tokens.map((t, idx) => {
          if (t.kind === "text") {
            if (/<(?:b|strong|i|em|u|s|strike|del|sub|sup|mark|span)[\s>]/i.test(t.value)) {
              return (
                <span
                  key={idx}
                  className="whitespace-pre-wrap inline text-[inherit]"
                  dangerouslySetInnerHTML={{ __html: sanitizeSafeHtml(t.value) }}
                />
              );
            }
            return <span key={idx} className="whitespace-pre-wrap">{t.value}</span>;
          }
          if (t.kind === "math") {
            let html = "";
            try {
              html = katex.renderToString(t.latex, { throwOnError: false, output: "html" });
            } catch {
              html = `<code>${t.latex}</code>`;
            }
            return <span key={idx} className="inline-block align-middle" dangerouslySetInnerHTML={{ __html: html }} />;
          }
          if (t.kind === "img") {
            return (
              <span
                key={idx}
                className="relative inline-block my-2 group cursor-zoom-in"
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomImg(t.src);
                }}
                title="Nhấn để phóng to hình ảnh"
              >
                <img
                  src={t.src}
                  alt="Minh họa câu hỏi"
                  className="inline-block max-w-full max-h-[380px] object-contain rounded-xl border border-border shadow-sm group-hover:border-primary/60 transition-all"
                  loading="lazy"
                />
                <span className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/70 text-white text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shadow pointer-events-none">
                  <ZoomIn className="size-3.5" /> Phóng to
                </span>
              </span>
            );
          }
          if (t.kind === "tbl") {
            return (
              <span key={idx} className="block my-3 max-w-full overflow-x-auto text-[inherit] font-[inherit]">
                <table className="rich-table border-collapse border border-border text-[inherit] font-[inherit] leading-[inherit] w-auto max-w-full my-1">
                  <tbody className="text-[inherit] font-[inherit]">
                    {t.rows.map((row, ri) => (
                      <tr key={ri} className="text-[inherit] font-[inherit]">
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="border border-border px-3 py-2 align-top text-[inherit] font-[inherit] leading-[inherit]"
                          >
                            <RichText text={cell} className="text-[inherit] font-[inherit]" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            );
          }
          // code
          let html = "";
          const effectiveLang = t.lang && t.lang !== "plaintext" ? t.lang : detectLangSimple(t.content);
          try {
            if (effectiveLang && effectiveLang !== "plaintext" && hljs.getLanguage(effectiveLang)) {
              html = hljs.highlight(t.content, { language: effectiveLang }).value;
            } else {
              html = hljs.highlightAuto(t.content).value;
            }
          } catch {
            html = t.content
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
          }
          return (
            <pre
              key={idx}
              className="code-content my-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-3.5 sm:p-4 overflow-x-auto text-xs sm:text-sm border border-slate-200 dark:border-slate-800 shadow-xs"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                tabSize: 4,
                MozTabSize: 4,
                fontFamily: 'Consolas, "Courier New", monospace',
              }}
            >
              <code
                className={`language-${effectiveLang || t.lang || "plaintext"} hljs`}
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  tabSize: 4,
                  MozTabSize: 4,
                  fontFamily: 'Consolas, "Courier New", monospace',
                  backgroundColor: "transparent",
                }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </pre>
          );
        })}
      </span>

      {/* Lightbox Modal for Image Zoom */}
      {zoomImg && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setZoomImg(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-card/95 rounded-2xl p-3 shadow-2xl border flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setZoomImg(null)}
              className="absolute -top-3 -right-3 size-9 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center shadow-lg font-bold transition-transform hover:scale-110"
              title="Đóng"
            >
              <X className="size-5" />
            </button>
            <img
              src={zoomImg}
              alt="Hình ảnh phóng to"
              className="max-h-[82vh] max-w-full object-contain rounded-xl"
            />
            <div className="mt-2 text-xs text-muted-foreground text-center">
              Nhấn ra ngoài hoặc nút X để đóng hình ảnh
            </div>
          </div>
        </div>
      )}
    </>
  );
}
