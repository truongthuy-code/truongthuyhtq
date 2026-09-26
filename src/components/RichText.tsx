import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";

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

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const pushText = (txt: string) => {
    if (!txt) return;
    out.push(...tokenizePlain(txt));
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
      out.push({ kind: "text", value: s.slice(open) });
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
      out.push({ kind: "text", value: s.slice(open, close + 1) });
    }
    i = close + 1;
  }
  return out;
}

export default function RichText({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text || ""), [text]);
  return (
    <span className={className ? `rich-text-root ${className}` : "rich-text-root"}>
      {tokens.map((t, idx) => {
        if (t.kind === "text") {
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
            <img
              key={idx}
              src={t.src}
              alt=""
              className="inline-block max-w-full h-auto my-2 rounded border"
            />
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
        try {
          if (t.lang && t.lang !== "plaintext" && hljs.getLanguage(t.lang)) {
            html = hljs.highlight(t.content, { language: t.lang }).value;
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
            className="my-2 rounded-md bg-muted p-3 overflow-x-auto text-sm"
          >
            <code
              className={`language-${t.lang} hljs`}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        );
      })}
    </span>
  );
}
