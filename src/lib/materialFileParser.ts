import mammoth from "mammoth";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";

// Initialize pdfjs worker if available
try {
  if (typeof window !== "undefined" && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  }
} catch {}

export interface ExtractedFileResult {
  fileName: string;
  fileType: "docx" | "pdf" | "pptx" | "txt" | "image";
  text: string;
  imageBase64?: string;
}

export async function parseUploadedMaterial(file: File): Promise<ExtractedFileResult> {
  const fileName = file.name;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // 1. Plain Text (.txt)
  if (ext === "txt" || file.type.startsWith("text/")) {
    const text = await file.text();
    return { fileName, fileType: "txt", text: text.trim() };
  }

  // 2. Word (.docx)
  if (ext === "docx" || file.type.includes("wordprocessingml")) {
    const arrayBuffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer });
    return { fileName, fileType: "docx", text: res.value.trim() };
  }

  // 3. PowerPoint (.pptx)
  if (ext === "pptx" || file.type.includes("presentationml")) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const slideTexts: string[] = [];

    // Find all slide xml files
    const slideFiles = Object.keys(zip.files)
      .filter((k) => k.startsWith("ppt/slides/slide") && k.endsWith(".xml"))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/[^\d]/g, "") || "0", 10);
        const numB = parseInt(b.replace(/[^\d]/g, "") || "0", 10);
        return numA - numB;
      });

    for (let i = 0; i < slideFiles.length; i++) {
      const xmlStr = await zip.files[slideFiles[i]].async("text");
      // Extract all <a:t>...</a:t> text nodes
      const matches = xmlStr.match(/<a:t[^>]*>(.*?)<\/a:t>/gs);
      if (matches && matches.length > 0) {
        const texts = matches.map((m) => m.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
        if (texts.length > 0) {
          slideTexts.push(`--- Slide ${i + 1} ---\n` + texts.join(" "));
        }
      }
    }

    const fullText = slideTexts.join("\n\n");
    return { fileName, fileType: "pptx", text: fullText.trim() || `(Tài liệu PowerPoint ${fileName})` };
  }

  // 4. PDF (.pdf)
  if (ext === "pdf" || file.type.includes("pdf")) {
    const arrayBuffer = await file.arrayBuffer();
    try {
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
      const pdf = await loadingTask.promise;
      let fullText = "";

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(" ");
        fullText += `[Trang ${pageNum}]\n${pageText}\n\n`;
      }

      return { fileName, fileType: "pdf", text: fullText.trim() };
    } catch (err: any) {
      console.warn("PDF parse error, fallback to basic reader:", err);
      return {
        fileName,
        fileType: "pdf",
        text: `Tài liệu PDF: ${fileName}. Vui lòng xem tài liệu đính kèm.`,
      };
    }
  }

  // 5. Image (.png, .jpg, .jpeg, .webp)
  if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string) || "";
        resolve({
          fileName,
          fileType: "image",
          text: `[Hình ảnh tài liệu học tập: ${fileName}]`,
          imageBase64: base64,
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Fallback
  const fallbackText = await file.text().catch(() => `Tài liệu: ${fileName}`);
  return { fileName, fileType: "txt", text: fallbackText };
}
