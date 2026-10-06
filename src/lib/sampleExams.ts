/**
 * Built-in Sample Exams Registry
 * Provides rich, verified exams with complete questions across Part I, II, and III
 * for example codes (TIN12-7A3K9, A1K8P2, TOAN12-9B1K2) and offline/demo testing.
 */

export interface SampleExamData {
  id: string;
  code: string;
  className: string;
  title: string;
  subject_name: string;
  teacher_name: string;
  school_name: string;
  duration_minutes: number;
  display_mode: "standard" | "quizizz" | "team";
  instant_feedback?: boolean;
  status: "open" | "closed" | "not_open";
  manual_closed: boolean;
  open_at: string | null;
  close_at: string | null;
  auto_submit_on_close: boolean;
  allow_review: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  shuffle_q_p1?: boolean;
  shuffle_q_p2?: boolean;
  shuffle_q_p3?: boolean;
  shuffle_o_p1?: boolean;
  shuffle_o_p2?: boolean;
  shuffle_o_p3?: boolean;
  scoring: {
    p1: number;
    p2: { "1": number; "2": number; "3": number; "4": number };
    p3: number;
  };
  questions: {
    partI: Array<{
      id: string;
      text: string;
      options: Array<{ key: string; text: string }>;
      answer: string;
      explanation?: string;
      level?: number;
    }>;
    partII: Array<{
      id: string;
      text: string;
      items: Array<{ key: string; text: string; correct: boolean }>;
      explanation?: string;
      level?: number;
    }>;
    partIII: Array<{
      id: string;
      text: string;
      answer: string;
      explanation?: string;
      level?: number;
    }>;
  };
}

export const SAMPLE_EXAMS: SampleExamData[] = [
  {
    id: "76b7c02b-a8e1-4c4c-83b6-97e3f89d3119",
    code: "TIN12-7A3K9",
    className: "12A1",
    title: "Kiểm tra 15 phút Tin học 12 – Hệ cơ sở dữ liệu quan hệ",
    subject_name: "Tin học",
    teacher_name: "Trương Thị Bích Thủy",
    school_name: "THPT Phan Bội Châu - TP Đà Nẵng",
    duration_minutes: 15,
    display_mode: "standard",
    instant_feedback: true,
    status: "open",
    manual_closed: false,
    open_at: null,
    close_at: null,
    auto_submit_on_close: true,
    allow_review: true,
    shuffle_questions: false,
    shuffle_options: false,
    scoring: {
      p1: 0.25,
      p2: { "1": 0.1, "2": 0.25, "3": 0.5, "4": 1 },
      p3: 0.25,
    },
    questions: {
      partI: [
        {
          id: "tin12_q1",
          text: "Trong một hệ cơ sở dữ liệu quan hệ (RDBMS), thuật ngữ nào sau đây tương đương với một **bảng dữ liệu**?",
          options: [
            { key: "A", text: "Thuộc tính (Attribute)" },
            { key: "B", text: "Quan hệ (Relation)" },
            { key: "C", text: "Bộ (Tuple)" },
            { key: "D", text: "Miền giá trị (Domain)" },
          ],
          answer: "B",
          explanation: "Trong mô hình dữ liệu quan hệ của Codd, một bảng hai chiều tương ứng với một Quan hệ (Relation).",
          level: 1,
        },
        {
          id: "tin12_q2",
          text: "Mỗi hàng trong bảng của mô hình dữ liệu quan hệ được gọi là gì?",
          options: [
            { key: "A", text: "Bản ghi hay Bộ (Tuple / Record)" },
            { key: "B", text: "Trường hay Thuộc tính (Field)" },
            { key: "C", text: "Khóa chính (Primary Key)" },
            { key: "D", text: "Chỉ mục (Index)" },
          ],
          answer: "A",
          explanation: "Mỗi hàng trong bảng đại diện cho một đối tượng cụ thể, được gọi là một bộ (tuple) hay một bản ghi (record).",
          level: 1,
        },
        {
          id: "tin12_q3",
          text: "Khóa chính (Primary Key) trong một bảng dữ liệu quan hệ có đặc điểm nào sau đây?",
          options: [
            { key: "A", text: "Có thể chứa giá trị NULL (rỗng)" },
            { key: "B", text: "Có thể trùng lặp giữa các dòng khác nhau" },
            { key: "C", text: "Phải duy nhất và không được chứa giá trị rỗng (NOT NULL)" },
            { key: "D", text: "Luôn phải có kiểu dữ liệu là số nguyên" },
          ],
          answer: "C",
          explanation: "Khóa chính xác định tính duy nhất của từng bản ghi trong bảng và không bao giờ được phép nhận giá trị rỗng (NULL).",
          level: 2,
        },
        {
          id: "tin12_q4",
          text: "Để liên kết hai bảng dữ liệu trong hệ CSDL quan hệ, người ta sử dụng khái niệm nào?",
          options: [
            { key: "A", text: "Khóa ngoài (Foreign Key)" },
            { key: "B", text: "Miền giá trị mở rộng" },
            { key: "C", text: "Bộ chọn lọc (Filter)" },
            { key: "D", text: "Biểu mẫu (Form)" },
          ],
          answer: "A",
          explanation: "Khóa ngoài là thuộc tính tham chiếu đến khóa chính của bảng khác để thiết lập mối quan hệ liên kết dữ liệu.",
          level: 2,
        },
      ],
      partII: [
        {
          id: "tin12_q5",
          text: "Cho bảng **HỌC_SINH** gồm các cột: `MaHS` (Khóa chính), `HoTen`, `NgaySinh`, `DiemTB`. Xét tính Đúng / Sai của các khẳng định sau:",
          items: [
            { key: "a", text: "Cột `MaHS` có thể để trống (NULL) khi thêm một học sinh mới vào bảng.", correct: false },
            { key: "b", text: "Hai học sinh khác nhau có thể có cùng giá trị `HoTen` và `NgaySinh`.", correct: true },
            { key: "c", text: "Nếu một học sinh có `MaHS = 'HS001'`, hệ thống không cho phép nhập thêm học sinh thứ hai cùng có `MaHS = 'HS001'`.", correct: true },
            { key: "d", text: "Cột `DiemTB` có thể đặt làm khóa chính nếu tất cả học sinh trong lớp đều có điểm số khác nhau.", correct: false },
          ],
          explanation: "a) Sai vì khóa chính không được NULL. b) Đúng vì tên và ngày sinh có thể trùng. c) Đúng vì khóa chính đảm bảo tính duy nhất. d) Sai vì điểm TB không ổn định và không phù hợp làm khóa chính.",
          level: 3,
        },
      ],
      partIII: [
        {
          id: "tin12_q6",
          text: "Một bảng quan hệ có 5 thuộc tính (cột) và hiện tại đang lưu trữ 30 bộ (dòng). Số phần tử (ô dữ liệu) tối đa trong bảng này là bao nhiêu?",
          answer: "150",
          explanation: "Số ô dữ liệu = số cột × số dòng = 5 × 30 = 150.",
          level: 2,
        },
      ],
    },
  },
  {
    id: "81286e88-a211-4cae-80ad-91fa214ed64b",
    code: "A1K8P2",
    className: "12A1",
    title: "Đề ôn tập trắc nghiệm Tin học 12 – Học kỳ II",
    subject_name: "Tin học",
    teacher_name: "Trương Thị Bích Thủy",
    school_name: "THPT Phan Bội Châu - TP Đà Nẵng",
    duration_minutes: 45,
    display_mode: "standard",
    instant_feedback: true,
    status: "open",
    manual_closed: false,
    open_at: null,
    close_at: null,
    auto_submit_on_close: true,
    allow_review: true,
    shuffle_questions: false,
    shuffle_options: false,
    scoring: {
      p1: 0.25,
      p2: { "1": 0.1, "2": 0.25, "3": 0.5, "4": 1 },
      p3: 0.25,
    },
    questions: {
      partI: [
        {
          id: "a1_q1",
          text: "Thiết bị mạng nào sau đây có chức năng định tuyến các gói tin giữa các mạng máy tính khác nhau?",
          options: [
            { key: "A", text: "Bộ định tuyến (Router)" },
            { key: "B", text: "Bộ chuyển mạch (Switch)" },
            { key: "C", text: "Bộ lặp tín hiệu (Repeater)" },
            { key: "D", text: "Bộ tập trung (Hub)" },
          ],
          answer: "A",
          explanation: "Router là thiết bị định tuyến các gói dữ liệu giữa các mạng IP khác nhau trên Internet.",
          level: 1,
        },
        {
          id: "a1_q2",
          text: "Giao thức truyền tải siêu văn bản an toàn có mã hóa SSL/TLS trên World Wide Web là gì?",
          options: [
            { key: "A", text: "HTTP" },
            { key: "B", text: "FTP" },
            { key: "C", text: "HTTPS" },
            { key: "D", text: "SMTP" },
          ],
          answer: "C",
          explanation: "HTTPS (Hypertext Transfer Protocol Secure) sử dụng chứng chỉ SSL/TLS để mã hóa dữ liệu truyền tải.",
          level: 1,
        },
        {
          id: "a1_q3",
          text: "Địa chỉ IP phiên bản 4 (IPv4) gồm bao nhiêu bit nhị phân?",
          options: [
            { key: "A", text: "16 bit" },
            { key: "B", text: "32 bit" },
            { key: "C", text: "64 bit" },
            { key: "D", text: "128 bit" },
          ],
          answer: "B",
          explanation: "IPv4 gồm 32 bit, chia thành 4 octet (mỗi octet 8 bit).",
          level: 1,
        },
        {
          id: "a1_q4",
          text: "Hệ quản trị cơ sở dữ liệu (DBMS) nào sau đây là hệ thống mã nguồn mở phổ biến nhất?",
          options: [
            { key: "A", text: "Oracle Database Enterprise" },
            { key: "B", text: "Microsoft SQL Server" },
            { key: "C", text: "PostgreSQL / MySQL" },
            { key: "D", text: "IBM DB2" },
          ],
          answer: "C",
          explanation: "PostgreSQL và MySQL là các hệ quản trị CSDL quan hệ mã nguồn mở hàng đầu thế giới.",
          level: 2,
        },
      ],
      partII: [
        {
          id: "a1_q5",
          text: "Về an toàn thông tin và bảo mật mạng máy tính, xét tính Đúng / Sai của các phát biểu sau:",
          items: [
            { key: "a", text: "Tường lửa (Firewall) chỉ có thể được cài đặt dưới dạng phần mềm, không có thiết bị phần cứng.", correct: false },
            { key: "b", text: "Mật khẩu mạnh nên chứa ít nhất 8 ký tự gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.", correct: true },
            { key: "c", text: "Xác thực hai yếu tố (2FA) giúp tăng cường bảo mật tài khoản ngay cả khi lộ mật khẩu.", correct: true },
            { key: "d", text: "Sử dụng mạng Wi-Fi công cộng không có mật khẩu luôn an toàn tuyệt đối khi giao dịch ngân hàng.", correct: false },
          ],
          explanation: "a) Sai vì có tường lửa phần cứng. b) Đúng. c) Đúng. d) Sai vì Wi-Fi công cộng dễ bị nghe lén (Man-in-the-middle).",
          level: 2,
        },
      ],
      partIII: [
        {
          id: "a1_q6",
          text: "Địa chỉ IPv6 có độ dài bao nhiêu bit nhị phân?",
          answer: "128",
          explanation: "Địa chỉ IPv6 gồm 128 bit, giải quyết triệt để tình trạng cạn kiệt địa chỉ IPv4.",
          level: 1,
        },
      ],
    },
  },
  {
    id: "9b1k2a00-1122-3344-5566-778899aabbcc",
    code: "TOAN12-9B1K2",
    className: "12A2",
    title: "Đề kiểm tra trắc nghiệm Toán học 12 – Khảo sát hàm số",
    subject_name: "Toán",
    teacher_name: "Tổ Toán - Tin",
    school_name: "THPT Phan Bội Châu",
    duration_minutes: 45,
    display_mode: "standard",
    instant_feedback: true,
    status: "open",
    manual_closed: false,
    open_at: null,
    close_at: null,
    auto_submit_on_close: true,
    allow_review: true,
    shuffle_questions: false,
    shuffle_options: false,
    scoring: {
      p1: 0.25,
      p2: { "1": 0.1, "2": 0.25, "3": 0.5, "4": 1 },
      p3: 0.25,
    },
    questions: {
      partI: [
        {
          id: "toan12_q1",
          text: "Cho hàm số $y = f(x)$ có bảng biến thiên trên đoạn $[-2; 2]$. Điểm cực đại của hàm số là điểm nào sau đây?",
          options: [
            { key: "A", text: "$x = 1$" },
            { key: "B", text: "$x = -1$" },
            { key: "C", text: "$x = 0$" },
            { key: "D", text: "$x = 2$" },
          ],
          answer: "C",
          explanation: "Điểm cực đại là điểm mà tại đó đạo hàm đổi dấu từ dương sang âm, tương ứng $x = 0$.",
          level: 1,
        },
      ],
      partII: [
        {
          id: "toan12_q2",
          text: "Cho hàm số $y = x^3 - 3x + 2$. Xét tính Đúng / Sai của các mệnh đề sau:",
          items: [
            { key: "a", text: "Hàm số đồng biến trên khoảng $(1; +\\infty)$.", correct: true },
            { key: "b", text: "Hàm số nghịch biến trên khoảng $(-1; 1)$.", correct: true },
            { key: "c", text: "Điểm cực tiểu của đồ thị hàm số là $A(1; 0)$.", correct: true },
            { key: "d", text: "Giá trị lớn nhất của hàm số trên đoạn $[0; 2]$ bằng 2.", correct: false },
          ],
          explanation: "y' = 3x^2 - 3 = 0 <=> x = +-1. Trên [0; 2], f(0)=2, f(1)=0, f(2)=4 => GTLN là 4.",
          level: 2,
        },
      ],
      partIII: [
        {
          id: "toan12_q3",
          text: "Tính đạo hàm của hàm số $y = x^2 - 4x + 3$ tại điểm $x = 3$.",
          answer: "2",
          explanation: "y' = 2x - 4. Tại x = 3, y'(3) = 2(3) - 4 = 2.",
          level: 1,
        },
      ],
    },
  },
];

/**
 * Search sample exams by code or examId
 */
export function findSampleExam(query: string): SampleExamData | null {
  const norm = (query || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!norm) return null;

  for (const ex of SAMPLE_EXAMS) {
    const codeNorm = ex.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const idNorm = ex.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (codeNorm === norm || idNorm === norm) {
      return ex;
    }
  }
  return null;
}

/**
 * Get sample exam by ID
 */
export function getSampleExamById(id: string): SampleExamData | null {
  if (!id) return null;
  const target = id.trim().toLowerCase();
  return SAMPLE_EXAMS.find((e) => e.id.toLowerCase() === target) || null;
}

/**
 * Get sample exam by code
 */
export function getSampleExamByCode(code: string): SampleExamData | null {
  if (!code) return null;
  const target = code.trim().toUpperCase();
  return (
    SAMPLE_EXAMS.find(
      (e) =>
        e.code.toUpperCase() === target ||
        e.code.toUpperCase().replace(/[^A-Z0-9]/g, "") === target.replace(/[^A-Z0-9]/g, "")
    ) || null
  );
}
