export interface KnowledgeBase {
  summary: string;
  mainTopics: string[];
  concepts: { name: string; definition: string }[];
  rules: string[];
  procedures: string[];
  examples: string[];
  keyTakeaways: string[];
}

export interface LearningMaterial {
  id: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  grade: string; // "10" | "11" | "12" | string
  topic: string; // e.g. "Bài 9. Tạo danh sách, bảng"
  title: string; // e.g. "Tài liệu Bài 9 - Tạo danh sách và bảng trong soạn thảo"
  fileName: string;
  fileType: "docx" | "pdf" | "pptx" | "txt" | "image";
  scope: "all" | "class" | "group";
  scopeTarget?: string; // e.g. "12A1" or "Nhóm nâng cao"
  rawContent: string;
  knowledgeBase?: KnowledgeBase;
  isActiveForAI: boolean;
  createdAt: string;
  updatedAt: string;
}

export const STORAGE_KEYS = {
  LEARNING_MATERIALS: "app_learning_materials_v1",
  STUDENT_PROGRESS: "app_student_learning_progress_v1",
};

export const DEFAULT_MATERIALS: LearningMaterial[] = [
  {
    id: "mat-tin12-b9-default",
    teacherId: "00000000-0000-4000-8000-000000000001",
    teacherName: "Trương Thị Bích Thủy",
    subject: "Tin học",
    grade: "12",
    topic: "Bài 9. Tạo danh sách, bảng",
    title: "Bài 9. Tạo danh sách và bảng trong trang web (HTML/CSS)",
    fileName: "Tin12_Bai9_Tao_Danh_Sach_Bang.docx",
    fileType: "docx",
    scope: "all",
    isActiveForAI: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rawContent: `BÀI 9: TẠO DANH SÁCH, BẢNG TRONG TRANG WEB
1. Khái niệm và phân loại danh sách trong HTML:
- Danh sách không có thứ tự (Unordered List): Dùng thẻ <ul> để bắt đầu và kết thúc. Mỗi mục trong danh sách được định nghĩa bởi thẻ <li> (List Item). Mặc định các mục được đánh dấu bằng dấu chấm tròn đen (disc).
- Danh sách có thứ tự (Ordered List): Dùng thẻ <ol> để bắt đầu và kết thúc. Mỗi mục bên trong dùng thẻ <li>. Mặc định các mục được đánh số thứ tự từ 1, 2, 3... Thuộc tính type có thể nhận các giá trị: '1' (số thập phân), 'a' hoặc 'A' (chữ cái), 'i' hoặc 'I' (chữ số La Mã). Thuộc tính start xác định số thứ tự bắt đầu.
- Danh sách lồng nhau: Một danh sách <ul> hoặc <ol> có thể đặt bên trong một thẻ <li> của danh sách khác.

2. Cấu trúc và quy tắc tạo bảng (Table):
- Thẻ <table>: Định nghĩa toàn bộ bảng dữ liệu.
- Thẻ <tr> (Table Row): Định nghĩa một hàng trong bảng. Mọi ô dữ liệu phải nằm bên trong thẻ <tr>.
- Thẻ <th> (Table Header): Định nghĩa ô tiêu đề của cột hoặc hàng. Chữ trong <th> mặc định in đậm và căn giữa.
- Thẻ <td> (Table Data): Định nghĩa ô chứa dữ liệu thông thường. Chữ mặc định không in đậm và căn lề trái.
- Thẻ <caption>: Đặt tiêu đề chú thích cho bảng, thường đặt ngay sau thẻ mở <table>.
- Gộp ô trong bảng:
  + Thuộc tính colspan="n": Gộp n ô liên tiếp trên cùng một hàng (chiều ngang).
  + Thuộc tính rowspan="m": Gộp m ô liên tiếp trên cùng một cột (chiều dọc).
  + Quy tắc: Khi gộp ô, cần giảm số lượng thẻ <td> hoặc <th> tương ứng ở hàng hoặc cột bị gộp để bảng không bị vỡ bố cục.

3. Ví dụ áp dụng:
- Ví dụ 1: Tạo danh sách các môn học yêu thích dạng không thứ tự:
  <ul>
    <li>Tin học</li>
    <li>Toán học</li>
  </ul>
- Ví dụ 2: Tạo bảng thời khóa biểu 2 hàng 3 cột, ô đầu tiên hàng 1 gộp 2 cột:
  <table border="1">
    <tr>
      <th colspan="2">Thời khóa biểu buổi sáng</th>
      <th>Ghi chú</th>
    </tr>
    <tr>
      <td>Tiết 1: Tin học</td>
      <td>Tiết 2: Toán</td>
      <td>Phòng máy 1</td>
    </tr>
  </table>

4. Kiến thức cần ghi nhớ:
- <ul> dùng cho danh sách không quan trọng thứ tự; <ol> dùng khi thứ tự các bước hoặc thứ hạng là quan trọng.
- <th> dùng cho ô tiêu đề, <td> dùng cho ô dữ liệu.
- colspan mở rộng ô theo cột (ngang), rowspan mở rộng ô theo hàng (dọc).`,
    knowledgeBase: {
      summary: "Bài học hướng dẫn cú pháp và phương pháp tạo danh sách không thứ tự (ul), có thứ tự (ol), danh sách lồng nhau và cấu trúc bảng dữ liệu (table, tr, th, td, caption) cùng kĩ thuật gộp ô bằng thuộc tính colspan và rowspan trong HTML.",
      mainTopics: [
        "Danh sách không thứ tự (ul)",
        "Danh sách có thứ tự (ol) và thuộc tính type, start",
        "Cấu trúc bảng HTML: table, tr, th, td, caption",
        "Gộp ô trong bảng với colspan và rowspan",
      ],
      concepts: [
        { name: "Danh sách không thứ tự (ul)", definition: "Tập hợp các mục không phụ thuộc thứ tự, được bao quanh bởi thẻ <ul> và mỗi phần tử là <li>." },
        { name: "Danh sách có thứ tự (ol)", definition: "Tập hợp các mục có đánh số thứ tự (số hoặc chữ), bao quanh bởi <ol> và mỗi phần tử là <li>." },
        { name: "Thẻ th (Table Header)", definition: "Ô tiêu đề của bảng, mặc định được trình duyệt in đậm và căn giữa." },
        { name: "Thẻ td (Table Data)", definition: "Ô chứa dữ liệu thông thường trong bảng, mặc định căn lề trái và không in đậm." },
        { name: "Thuộc tính colspan", definition: "Thuộc tính xác định số cột mà một ô sẽ trải rộng/gộp theo chiều ngang." },
        { name: "Thuộc tính rowspan", definition: "Thuộc tính xác định số hàng mà một ô sẽ trải rộng/gộp theo chiều dọc." },
      ],
      rules: [
        "Mọi thẻ <td> và <th> phải nằm bên trong thẻ <tr>.",
        "Mọi mục trong danh sách <ul> hoặc <ol> phải nằm trong thẻ <li>.",
        "Khi dùng colspan='n', phải giảm n-1 thẻ ô ở hàng đó để không vỡ bảng.",
        "Khi dùng rowspan='m', các hàng bên dưới ở vị trí tương ứng không khai báo thêm ô bị gộp.",
      ],
      procedures: [
        "Bước 1: Mở thẻ <table>.",
        "Bước 2: Sử dụng <tr> để tạo từng hàng dữ liệu.",
        "Bước 3: Bên trong <tr>, dùng <th> cho hàng tiêu đề và <td> cho các hàng nội dung.",
        "Bước 4: Sử dụng colspan hoặc rowspan nếu cần gộp ô.",
        "Bước 5: Đóng thẻ </table>.",
      ],
      examples: [
        "<ul><li>Tin học</li><li>Toán học</li></ul>",
        "<ol type='A'><li>Bước 1</li><li>Bước 2</li></ol>",
        "<tr><th colspan='2'>Tiêu đề gộp 2 cột</th></tr>",
      ],
      keyTakeaways: [
        "Thẻ ul/ol luôn chứa li.",
        "Table row là tr, table data là td, table header là th.",
        "Gộp ngang dùng colspan, gộp dọc dùng rowspan.",
      ],
    },
  },
  {
    id: "mat-tin12-b10-default",
    teacherId: "00000000-0000-4000-8000-000000000001",
    teacherName: "Trương Thị Bích Thủy",
    subject: "Tin học",
    grade: "12",
    topic: "Bài 10. Tạo liên kết và đa phương tiện",
    title: "Bài 10. Chèn liên kết, hình ảnh và âm thanh trong HTML",
    fileName: "Tin12_Bai10_Lien_Ket_Da_Phuong_Tien.docx",
    fileType: "docx",
    scope: "all",
    isActiveForAI: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rawContent: `BÀI 10: TẠO LIÊN KẾT VÀ ĐA PHƯƠNG TIỆN TRONG TRANG WEB
1. Tạo siêu liên kết với thẻ <a> (Anchor):
- Cú pháp: <a href="duong_dan" target="gia_tri">Nội dung liên kết</a>.
- Thuộc tính href: Chỉ định địa chỉ URL hoặc đường dẫn file mà liên kết trỏ tới.
- Thuộc tính target="_blank": Mở liên kết trong một tab/cửa sổ trình duyệt mới.
- Liên kết nội bộ (Neo trang): Dùng id của phần tử mục tiêu kết hợp dấu # (Ví dụ: <a href="#muc1">Đến mục 1</a>).

2. Chèn hình ảnh với thẻ <img>:
- Cú pháp: <img src="duong_dan_anh" alt="mo_ta" width="chieu_rong" height="chieu_cao" />
- Thẻ <img> là thẻ đơn (không có thẻ đóng).
- Thuộc tính src: Đường dẫn tới file ảnh (tương đối hoặc tuyệt đối).
- Thuộc tính alt: Văn bản thay thế hiển thị khi ảnh không tải được hoặc hỗ trợ người khiếm thị đọc màn hình. Bắt buộc nên có để tối ưu trang web.

3. Chèn âm thanh và video:
- Thẻ <audio controls src="audio.mp3"></audio>: Chèn âm thanh, thuộc tính controls hiển thị thanh điều khiển (play, pause, âm lượng).
- Thẻ <video controls width="640" height="360" src="video.mp4"></video>: Chèn video.

4. Kiến thức cần ghi nhớ:
- Thẻ <a> tạo liên kết, href là thuộc tính quan trọng nhất.
- Thẻ <img> không có thẻ đóng, src chỉ định nguồn ảnh, alt là mô tả thay thế.
- Muốn mở trang trong tab mới, dùng target="_blank".`,
    knowledgeBase: {
      summary: "Bài học cung cấp kiến thức về siêu liên kết thẻ <a>, thuộc tính href, target, neo trang và thẻ chèn ảnh <img> cùng thẻ âm thanh <audio>, video <video>.",
      mainTopics: [
        "Thẻ tạo liên kết <a> và thuộc tính href, target",
        "Thẻ chèn hình ảnh <img> và thuộc tính src, alt",
        "Chèn âm thanh và video đa phương tiện",
      ],
      concepts: [
        { name: "Siêu liên kết (Hyperlink)", definition: "Đoạn văn bản hoặc hình ảnh cho phép người dùng nhấp vào để chuyển đến trang web hoặc tài nguyên khác." },
        { name: "Thuộc tính target='_blank'", definition: "Thuộc tính giúp mở liên kết trong một tab mới thay vì tải đè lên tab hiện tại." },
        { name: "Thuộc tính alt", definition: "Văn bản mô tả ảnh hiển thị khi ảnh bị lỗi tải hoặc hỗ trợ trình đọc màn hình." },
      ],
      rules: [
        "Thẻ <img> là thẻ tự đóng, không được viết <img></img>.",
        "Phải có thuộc tính src trong thẻ <img> để trình duyệt tìm thấy ảnh.",
        "Nên luôn cung cấp thuộc tính alt cho ảnh vì khả năng tiếp cận và SEO.",
      ],
      procedures: [
        "Tạo liên kết: <a href='URL' target='_blank'>Tên liên kết</a>",
        "Chèn ảnh: <img src='path/to/img.jpg' alt='Mô tả' />",
      ],
      examples: [
        "<a href='https://moet.gov.vn' target='_blank'>Bộ Giáo dục và Đào tạo</a>",
        "<img src='logo.png' alt='Logo trường' width='120' />",
      ],
      keyTakeaways: [
        "a href cho liên kết, img src alt cho hình ảnh.",
        "target='_blank' mở tab mới.",
      ],
    },
  },
];

export function getAllMaterials(): LearningMaterial[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LEARNING_MATERIALS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  // Seed default materials
  localStorage.setItem(STORAGE_KEYS.LEARNING_MATERIALS, JSON.stringify(DEFAULT_MATERIALS));
  return DEFAULT_MATERIALS;
}

export function saveMaterials(list: LearningMaterial[]): void {
  localStorage.setItem(STORAGE_KEYS.LEARNING_MATERIALS, JSON.stringify(list));
}

export function upsertMaterial(mat: LearningMaterial): void {
  const list = getAllMaterials();
  const idx = list.findIndex((m) => m.id === mat.id);
  if (idx >= 0) {
    list[idx] = { ...mat, updatedAt: new Date().toISOString() };
  } else {
    list.unshift({ ...mat, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  saveMaterials(list);
}

export function deleteMaterial(id: string): void {
  const list = getAllMaterials().filter((m) => m.id !== id);
  saveMaterials(list);
}

export function toggleMaterialActive(id: string, active: boolean): void {
  const list = getAllMaterials().map((m) => (m.id === id ? { ...m, isActiveForAI: active, updatedAt: new Date().toISOString() } : m));
  saveMaterials(list);
}

/** Get active materials for AI knowledge retrieval (filtered by subject, grade, topic) */
export function getActiveMaterialsForAI(subject?: string, grade?: string, topic?: string): LearningMaterial[] {
  const list = getAllMaterials().filter((m) => m.isActiveForAI);
  return list.filter((m) => {
    if (subject && m.subject.toLowerCase() !== subject.toLowerCase()) return false;
    if (grade && m.grade !== grade) return false;
    if (topic && m.topic.toLowerCase() !== topic.toLowerCase()) return false;
    return true;
  });
}

/** Get unique subjects that have active materials */
export function getAvailableSubjects(grade?: string): string[] {
  const list = getAllMaterials().filter((m) => m.isActiveForAI);
  const filtered = grade ? list.filter((m) => m.grade === grade) : list;
  const subjects = new Set<string>();
  filtered.forEach((m) => subjects.add(m.subject));
  return Array.from(subjects);
}

/** Get unique topics for a given subject & grade */
export function getAvailableTopics(subject: string, grade?: string): { topic: string; materialId: string; title: string }[] {
  const list = getAllMaterials().filter((m) => m.isActiveForAI);
  const matched = list.filter((m) => {
    if (m.subject.toLowerCase() !== subject.toLowerCase()) return false;
    if (grade && m.grade !== grade) return false;
    return true;
  });
  const map = new Map<string, { topic: string; materialId: string; title: string }>();
  matched.forEach((m) => {
    if (!map.has(m.topic)) {
      map.set(m.topic, { topic: m.topic, materialId: m.id, title: m.title });
    }
  });
  return Array.from(map.values());
}
