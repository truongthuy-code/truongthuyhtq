import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Bạn là trợ lý OCR đề thi trắc nghiệm tiếng Việt. Người dùng gửi ảnh hoặc trang tài liệu chứa đề thi. Nhiệm vụ:

1. Trích xuất NGUYÊN VĂN nội dung đề, giữ thứ tự, kể cả công thức toán.
2. MỌI công thức toán phải được bao bằng \\$...\\$ theo cú pháp LaTeX (phân số \\frac, căn \\sqrt, mũ ^{}, chỉ số _{}, tích phân \\int, ma trận \\begin{matrix}..., ký hiệu Hy Lạp \\alpha,\\beta,...). Không chuyển công thức thành chữ thường.
3. Định dạng đầu ra phải đúng convention sau (KHÔNG markdown, KHÔNG chú thích thêm):

PHẦN I
Câu 1: <nội dung>
A. <phương án>
B. <phương án>
*C. <phương án đúng — đánh dấu bằng dấu * trước chữ cái>
D. <phương án>

PHẦN II
Câu 1: <nội dung>
*a) <ý đúng>
b) <ý sai>
c) <ý sai>
*d) <ý đúng>

PHẦN III
Câu 1: <nội dung câu hỏi>
Đáp án: <giá trị>

Nếu không xác định được đáp án đúng thì vẫn xuất phương án nhưng không đặt dấu *. Trả về duy nhất phần văn bản đề thi.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { images } = await req.json();
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "images[] required (data URLs)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!KEY) throw new Error("LOVABLE_API_KEY not configured");

    const userContent: any[] = [
      { type: "text", text: "Hãy OCR đề thi trong (các) hình bên dưới và trả về theo đúng định dạng." },
      ...images.map((url: string) => ({ type: "image_url", image_url: { url } })),
    ];

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Đã vượt quá giới hạn AI, thử lại sau." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Hết credits Lovable AI. Vui lòng nạp thêm." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ocr-exam error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
