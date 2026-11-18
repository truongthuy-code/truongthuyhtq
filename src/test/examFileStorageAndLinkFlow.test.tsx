import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const {
  TEACHER_ID,
  CREATED_EXAM_ID,
  mockState,
  mockParseDocx,
  mockToastSuccess,
  mockToastError,
  mockToastInfo,
  mockToastWarning,
  mockStorageUpload,
  mockStorageCreateSignedUrl,
  mockRefreshSession,
  mockGenerateCode,
  mockSyncCodes,
  mockEnsureShortLink,
  mockExamsInsert,
  mockMoveExamToFolder,
  mockResolveAssignmentByCode,
} = vi.hoisted(() => {
  const teacherId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const createdExamId = "99999999-1111-4222-8333-444444444444";
  return {
    TEACHER_ID: teacherId,
    CREATED_EXAM_ID: createdExamId,
    mockState: {
      examsRows: [] as any[],
      foldersRows: [
        {
          id: "folder-root-1",
          name: "Khoa học tự nhiên",
          parent_id: null,
          teacher_id: teacherId,
          created_at: "2026-11-18T00:00:00Z",
          updated_at: "2026-11-18T00:00:00Z",
        },
        {
          id: "folder-child-1",
          name: "Tin học 12",
          parent_id: "folder-root-1",
          teacher_id: teacherId,
          created_at: "2026-11-18T00:01:00Z",
          updated_at: "2026-11-18T00:01:00Z",
        },
        {
          id: "folder-grandchild-1",
          name: "Chủ đề F - Giải quyết vấn đề",
          parent_id: "folder-child-1",
          teacher_id: teacherId,
          created_at: "2026-11-18T00:02:00Z",
          updated_at: "2026-11-18T00:02:00Z",
        },
      ],
      deletedExamIds: [] as string[],
      updatedExamPayloads: [] as any[],
      lastCreatedAnchorHref: "",
      lastCreatedAnchorDownload: "",
    },
    mockParseDocx: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastWarning: vi.fn(),
    mockStorageUpload: vi.fn(),
    mockStorageCreateSignedUrl: vi.fn(),
    mockRefreshSession: vi.fn(),
    mockGenerateCode: vi.fn(),
    mockSyncCodes: vi.fn(),
    mockEnsureShortLink: vi.fn(),
    mockExamsInsert: vi.fn(),
    mockMoveExamToFolder: vi.fn(),
    mockResolveAssignmentByCode: vi.fn(),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    info: mockToastInfo,
    warning: mockToastWarning,
  },
}));

const { stableAuthValue } = vi.hoisted(() => ({
  stableAuthValue: {
    user: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "giaovien@school.edu.vn",
      name: "Cô Thủy",
      school: "THPT Test",
      subject: "Tin học",
    },
    profile: {
      full_name: "Cô Thủy",
      role: "teacher",
      school_name: "THPT Test",
      subject_name: "Tin học",
    },
    isAdmin: false,
    isSuperAdmin: false,
    loading: false,
    signOut: () => {},
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => stableAuthValue,
}));

vi.mock("@/lib/docxParser", async () => {
  const actual = await vi.importActual<typeof import("@/lib/docxParser")>("@/lib/docxParser");
  return {
    ...actual,
    parseDocx: mockParseDocx,
  };
});

vi.mock("@/lib/pdfParser", () => ({
  parsePdfExam: vi.fn(),
}));

vi.mock("@/lib/supabaseAuthSync", () => ({
  ensureSupabaseSession: vi.fn().mockResolvedValue(TEACHER_ID),
  resetSupabaseAuthSyncCache: vi.fn(),
  withSupabaseAuthRetry: vi.fn(async (op: any) => op(TEACHER_ID)),
}));

vi.mock("@/lib/examAssignments", async () => {
  const actual = await vi.importActual<typeof import("@/lib/examAssignments")>("@/lib/examAssignments");
  return {
    ...actual,
    generateUniqueNumericExamCode: mockGenerateCode,
    syncExamAssignmentCodes: mockSyncCodes,
    findAssignmentOrExamByCode: mockResolveAssignmentByCode,
    getAssignmentsForExam: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/lib/shortLinks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shortLinks")>("@/lib/shortLinks");
  return {
    ...actual,
    ensureExamShortLink: mockEnsureShortLink,
  };
});

vi.mock("@/lib/folderStorage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/folderStorage")>("@/lib/folderStorage");
  return {
    ...actual,
    getFolders: vi.fn(async () => mockState.foldersRows),
    getAllExamFolderMappings: vi.fn(async () => ({})),
    moveExamToFolder: mockMoveExamToFolder,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const buildChain = (table: string) => {
    const filters: Record<string, any> = {};
    let isInsert = false;
    let isDelete = false;
    let isUpdate = false;
    let isSingle = false;

    const execute = async () => {
      if (table === "exams") {
        if (isDelete) {
          if (filters.id) mockState.deletedExamIds.push(filters.id);
          return { data: null, error: null };
        }
        if (isUpdate) {
          return { data: { id: filters.id || CREATED_EXAM_ID }, error: null };
        }
        if (isInsert) {
          return { data: { id: CREATED_EXAM_ID }, error: null };
        }
        if (filters.id) {
          const found = mockState.examsRows.find((r) => r.id === filters.id) || null;
          return { data: isSingle ? found : found ? [found] : [], error: null };
        }
        return { data: isSingle ? mockState.examsRows[0] || null : mockState.examsRows, error: null };
      }

      if (table === "exam_folders") {
        return { data: mockState.foldersRows, error: null };
      }

      if (table === "submissions" || table === "schools" || table === "exam_assignments" || table === "exam_short_links") {
        return { data: isSingle ? null : [], count: 0, error: null };
      }

      return { data: isSingle ? null : [], error: null };
    };

    const chain: any = {
      select: vi.fn(() => chain),
      insert: vi.fn((payload: any) => {
        isInsert = true;
        if (table === "exams") {
          mockExamsInsert(payload);
        }
        return chain;
      }),
      update: vi.fn((payload: any) => {
        isUpdate = true;
        if (table === "exams") {
          mockState.updatedExamPayloads.push(payload);
        }
        return chain;
      }),
      delete: vi.fn(() => {
        isDelete = true;
        return chain;
      }),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      eq: vi.fn((col: string, val: any) => {
        filters[col] = val;
        return chain;
      }),
      in: vi.fn(() => chain),
      like: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      single: vi.fn(() => {
        isSingle = true;
        return execute();
      }),
      maybeSingle: vi.fn(() => {
        isSingle = true;
        return execute();
      }),
      then: (resolve: any, reject: any) => execute().then(resolve, reject),
    };
    return chain;
  };

  return {
    resolveClientSupabaseConfig: () => ({
      supabaseUrl: "https://zhixpglctyfffpwamixv.supabase.co",
      supabaseAnonKey: "test-anon-key",
    }),
    supabase: {
      from: vi.fn((table: string) => buildChain(table)),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: TEACHER_ID }, access_token: "valid-jwt" } },
          error: null,
        }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: TEACHER_ID } },
          error: null,
        }),
        refreshSession: mockRefreshSession,
      },
      storage: {
        from: vi.fn(() => ({
          upload: mockStorageUpload,
          createSignedUrl: mockStorageCreateSignedUrl,
        })),
      },
    },
  };
});

import {
  classifyStorageError,
  extractStoragePathFromExam,
  inferExamFileMimeType,
  resolveOriginalFileAccess,
  sanitizeVietnameseStorageFileName,
  uploadOriginalExamFile,
} from "@/lib/examFileStorage";
import Teacher from "@/pages/Teacher";
import Index from "@/pages/Index";
import Exams from "@/pages/Exams";
import Library from "@/pages/Library";
import ShortLinkRedirect from "@/pages/ShortLinkRedirect";
import QuickExamShareModal from "@/components/QuickExamShareModal";
import { RequestTimeoutError } from "@/lib/requestTimeout";

const VALID_PARSED_EXAM = {
  partI: [
    {
      id: "q1",
      text: "Giao thức nào dùng để truyền siêu văn bản?",
      options: [
        { key: "A" as const, text: "HTTP" },
        { key: "B" as const, text: "FTP" },
        { key: "C" as const, text: "SMTP" },
        { key: "D" as const, text: "DNS" },
      ],
      answer: "A" as const,
    },
  ],
  partII: [],
  partIII: [],
};

describe("Khắc phục triệt để lỗi tải file gốc & tương thích thư mục nhiều cấp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockState.examsRows = [];
    mockState.deletedExamIds = [];
    mockState.updatedExamPayloads = [];
    mockState.lastCreatedAnchorHref = "";
    mockState.lastCreatedAnchorDownload = "";

    mockParseDocx.mockResolvedValue(VALID_PARSED_EXAM);
    mockGenerateCode.mockResolvedValue("482910");
    mockSyncCodes.mockResolvedValue({
      success: true,
      primaryCode: "482910",
      source: "exam_assignments",
    });
    mockEnsureShortLink.mockResolvedValue({
      shortCode: "482910",
      targetUrl: "/exam/" + CREATED_EXAM_ID + "?code=482910",
      source: "server",
    });
    mockMoveExamToFolder.mockResolvedValue({ success: true });
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: "fresh-jwt", user: { id: TEACHER_ID } } },
      error: null,
    });
  });

  it("1. Chuẩn hóa tên file tiếng Việt có dấu/khoảng trắng & suy luận MIME type chính xác", () => {
    const safeName = sanitizeVietnameseStorageFileName("Đề kiểm tra Tin học 12 (lần 1) - HKII.docx");
    expect(safeName).toBe("De_kiem_tra_Tin_hoc_12_lan_1_-_HKII.docx");
    expect(safeName).not.toMatch(/[^\w.\-]/);

    expect(inferExamFileMimeType("Đề thi giữa kỳ.docx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(inferExamFileMimeType("Đề thi.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(inferExamFileMimeType("Đề cũ.doc", "")).toBe("application/msword");
  });

  it("2. Phân tích chính xác path từ cả original_file_path và legacy original_file_url (/object/public/exam-files/...)", () => {
    // Legacy exam stored public URL on private bucket -> must extract storage object path
    const legacy = extractStoragePathFromExam({
      original_file_path: null,
      original_file_url:
        "https://zhixpglctyfffpwamixv.supabase.co/storage/v1/object/public/exam-files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1700000000-De_tin_12.docx",
    });
    expect(legacy.storagePath).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/1700000000-De_tin_12.docx");
    expect(legacy.externalUrl).toBeNull();

    // Direct path with leading slash & bucket prefix
    const normalized = extractStoragePathFromExam({
      original_file_path: "/exam-files/teacher-1/17000-De%20thi.docx?download=1",
    });
    expect(normalized.storagePath).toBe("teacher-1/17000-De thi.docx");

    // Genuine external URL preserved
    const ext = extractStoragePathFromExam({
      original_file_url: "https://drive.google.com/file/d/abc123/view",
    });
    expect(ext.storagePath).toBeNull();
    expect(ext.externalUrl).toBe("https://drive.google.com/file/d/abc123/view");
  });

  it("3. Phân loại chính xác các lỗi Supabase Storage thực tế (401, 403, 404, 413, 415, timeout, network)", () => {
    expect(
      classifyStorageError({ statusCode: "404", message: "Object not found", code: "NoSuchKey" }, "sign", "u1/f.docx")
        .code
    ).toBe("not_found");
    expect(classifyStorageError({ message: "Bucket not found", statusCode: "404" }, "upload").code).toBe(
      "bucket_not_found"
    );
    expect(
      classifyStorageError(
        { statusCode: "403", error: "Unauthorized", message: "signature verification failed", code: "AccessDenied" },
        "upload"
      ).code
    ).toBe("unauthorized");
    expect(
      classifyStorageError({ statusCode: "403", message: "new row violates row-level security policy" }, "upload").code
    ).toBe("forbidden");
    expect(
      classifyStorageError({ statusCode: "413", message: "The object exceeded the maximum allowed size" }, "upload").code
    ).toBe("payload_too_large");
    expect(classifyStorageError({ statusCode: "415", message: "mime type is not supported" }, "upload").code).toBe(
      "unsupported_mime"
    );
    expect(classifyStorageError(new RequestTimeoutError("upload", 20000), "upload").code).toBe("timeout");
    expect(classifyStorageError(new TypeError("Failed to fetch"), "upload").code).toBe("network");
  });

  it("4. Tự động refreshSession 1 lần khi gặp lỗi 401/403 JWT rồi upload thành công với đường dẫn an toàn", async () => {
    mockStorageUpload
      .mockResolvedValueOnce({
        data: null,
        error: { statusCode: "403", message: "signature verification failed", code: "AccessDenied" },
      })
      .mockResolvedValueOnce({
        data: { path: `${TEACHER_ID}/17000-De_Tin_12_HKI.docx` },
        error: null,
      });

    const file = new File(["docx-binary"], "Đề Tin 12 HKI.docx", { type: "" });
    const res = await uploadOriginalExamFile(file, { id: TEACHER_ID, name: "Cô Thủy" } as any);

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockStorageUpload.mock.calls[0][2]).toEqual({
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.originalName).toBe("Đề Tin 12 HKI.docx");
      expect(res.path).toContain("De_Tin_12_HKI.docx");
    }
  });

  it("5. resolveOriginalFileAccess tạo Signed URL đầy đủ cho đề thi cũ chỉ có original_file_url (/object/public/exam-files/...) và giữ nguyên dữ liệu khi file mất (404)", async () => {
    mockStorageCreateSignedUrl.mockResolvedValueOnce({
      data: {
        signedUrl: "/object/sign/exam-files/t1/old.docx?token=signed-token-123",
      },
      error: null,
    });

    const okRes = await resolveOriginalFileAccess(
      {
        id: "legacy-exam-1",
        original_file_path: null,
        original_file_url:
          "https://zhixpglctyfffpwamixv.supabase.co/storage/v1/object/public/exam-files/t1/old.docx",
        original_file_name: "Đề thi cũ.docx",
      },
      { id: TEACHER_ID } as any
    );

    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.source).toBe("signed_url");
      expect(okRes.url).toBe(
        "https://zhixpglctyfffpwamixv.supabase.co/storage/v1/object/sign/exam-files/t1/old.docx?token=signed-token-123"
      );
      expect(okRes.fileName).toBe("Đề thi cũ.docx");
    }

    mockStorageCreateSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { statusCode: "404", error: "not_found", message: "Object not found", code: "NoSuchKey" },
    });

    const missingRes = await resolveOriginalFileAccess(
      {
        id: "missing-file-exam",
        original_file_path: "t1/deleted-by-mistake.docx",
      },
      { id: TEACHER_ID } as any
    );

    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.code).toBe("not_found");
      expect(missingRes.httpStatus).toBe(404);
      expect(missingRes.message).toContain("File gốc không còn tồn tại");
    }
    expect(mockState.deletedExamIds).toHaveLength(0);
    expect(mockState.updatedExamPayloads).toHaveLength(0);
  });

  it("6. Teacher.onCreate: Khi upload file gốc thất bại (403 RLS), báo đúng nguyên nhân, KHÔNG tạo mã đề rác, KHÔNG insert exams, và mở khóa nút", async () => {
    mockStorageUpload.mockResolvedValue({
      data: null,
      error: { statusCode: "403", message: "new row violates row-level security policy" },
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/teacher?folder=folder-grandchild-1"]}>
        <Routes>
          <Route path="/teacher" element={<Teacher />} />
          <Route path="/share/:id" element={<div data-testid="share-page">SHARE_PAGE</div>} />
        </Routes>
      </MemoryRouter>
    );

    const fileInput = container.querySelector('input[type="file"][accept=".docx"]') as HTMLInputElement;
    const docxFile = new File(["dummy"], "Đề kiểm tra Tin 12 (chính thức).docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    fireEvent.change(fileInput, { target: { files: [docxFile] } });

    const createBtn = await screen.findByRole("button", { name: /Tạo link bài thi/i });
    await waitFor(() => expect(createBtn).not.toBeDisabled());

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("403 - RLS"));
    });

    // Quan trọng: Tuyệt đối không sinh mã đề hay ghi bản ghi dở dang vào bảng exams khi upload lỗi
    expect(mockGenerateCode).not.toHaveBeenCalled();
    expect(mockExamsInsert).not.toHaveBeenCalled();
    expect(mockSyncCodes).not.toHaveBeenCalled();
    expect(screen.queryByTestId("share-page")).not.toBeInTheDocument();

    // Nút bấm được giải phóng trạng thái loading
    await waitFor(() => expect(createBtn).not.toBeDisabled());
  });

  it("7. Teacher.onCreate: Tạo đề trong thư mục cháu (cấp 3) với file tiếng Việt upload thành công -> lưu đủ original_file_path, original_file_name, folder_id, sinh mã 6 chữ số & chuyển trang Chia sẻ", async () => {
    mockStorageUpload.mockResolvedValueOnce({
      data: { path: `${TEACHER_ID}/1700000000-De_kiem_tra_Tin_hoc_12.docx` },
      error: null,
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/teacher?folder=folder-grandchild-1"]}>
        <Routes>
          <Route path="/teacher" element={<Teacher />} />
          <Route path="/exam/:id/share" element={<div data-testid="share-page">SHARE_PAGE</div>} />
        </Routes>
      </MemoryRouter>
    );

    const fileInput = container.querySelector('input[type="file"][accept=".docx"]') as HTMLInputElement;
    const docxFile = new File(["dummy"], "Đề kiểm tra Tin học 12.docx", {
      type: "",
    });

    fireEvent.change(fileInput, { target: { files: [docxFile] } });

    const createBtn = await screen.findByRole("button", { name: /Tạo link bài thi/i });
    await waitFor(() => expect(createBtn).not.toBeDisabled());

    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByTestId("share-page")).toBeInTheDocument();
    });

    expect(mockExamsInsert).toHaveBeenCalledTimes(1);
    const inserted = mockExamsInsert.mock.calls[0][0];
    expect(inserted.original_file_path).toBe(`${TEACHER_ID}/1700000000-De_kiem_tra_Tin_hoc_12.docx`);
    expect(inserted.original_file_name).toBe("Đề kiểm tra Tin học 12.docx");
    expect(inserted.folder_id).toBe("folder-grandchild-1");
    expect(inserted.team_config?.primary_code).toBe("482910");
    expect(mockSyncCodes).toHaveBeenCalledTimes(1);
    expect(mockEnsureShortLink).toHaveBeenCalledTimes(1);
  });

  it("8. Kiểm tra tải file gốc từ danh sách (Index / Exams / Library) với đề thi cũ & khi Storage trả về 404 Object not found", async () => {
    const legacyExam = {
      id: "exam-legacy-url",
      title: "Đề cũ chỉ có original_file_url",
      created_at: "2026-05-10T08:00:00Z",
      duration_minutes: 45,
      max_attempts: 1,
      allow_review: true,
      manual_closed: false,
      questions: VALID_PARSED_EXAM,
      created_by: TEACHER_ID,
      subject_name: "Tin học",
      school_name: "THPT Test",
      teacher_name: "Cô Thủy",
      original_file_path: null,
      original_file_name: null,
      original_file_url:
        "https://zhixpglctyfffpwamixv.supabase.co/storage/v1/object/public/exam-files/t1/de_cu.docx",
      team_config: { primary_code: "112233" },
      folder_id: "folder-child-1",
    };

    const missingFileExam = {
      ...legacyExam,
      id: "exam-missing-storage",
      title: "Đề bị thiếu file trên Storage",
      original_file_path: "t1/khong_ton_tai.docx",
      original_file_name: "File đã mất.docx",
      original_file_url: null,
      team_config: { primary_code: "445566" },
      folder_id: null,
    };

    mockState.examsRows = [legacyExam, missingFileExam];

    const origCreateElement = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName.toLowerCase() === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          mockState.lastCreatedAnchorHref = (el as HTMLAnchorElement).href;
          mockState.lastCreatedAnchorDownload = (el as HTMLAnchorElement).download;
        });
      }
      return el;
    });

    try {
      // Index.tsx -> signed URL for legacyExam
      mockStorageCreateSignedUrl.mockResolvedValueOnce({
        data: { signedUrl: "/object/sign/exam-files/t1/de_cu.docx?token=sig-index" },
        error: null,
      });

      const indexRender = render(
        <MemoryRouter initialEntries={["/?folder=folder-child-1"]}>
          <Index />
        </MemoryRouter>
      );

      const downloadBtnsIndex = await screen.findAllByRole("button", { name: /Tải đề gốc/i });
      fireEvent.click(downloadBtnsIndex[0]);

      await waitFor(() => {
        expect(mockState.lastCreatedAnchorHref).toContain("/object/sign/exam-files/t1/de_cu.docx?token=sig-index");
      });
      indexRender.unmount();

      // Exams.tsx -> 404 error keeps exam untouched
      mockStorageCreateSignedUrl.mockResolvedValueOnce({
        data: null,
        error: { statusCode: "404", message: "Object not found", code: "NoSuchKey" },
      });

      const examsRender = render(
        <MemoryRouter initialEntries={["/exams"]}>
          <Exams />
        </MemoryRouter>
      );

      const downloadBtnsExams = await screen.findAllByRole("button", { name: /^Đề gốc$/i });
      fireEvent.click(downloadBtnsExams[1]);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("File gốc không còn tồn tại"));
      });
      expect(mockState.deletedExamIds).toHaveLength(0);
      examsRender.unmount();

      // Library.tsx -> downloads original via signed URL when available
      mockStorageCreateSignedUrl.mockResolvedValueOnce({
        data: { signedUrl: "/object/sign/exam-files/t1/de_cu.docx?token=sig-library" },
        error: null,
      });

      const libRender = render(
        <MemoryRouter initialEntries={["/library"]}>
          <Library />
        </MemoryRouter>
      );

      fireEvent.click(await screen.findByText("Tin học"));
      fireEvent.click(await screen.findByText("THPT Test"));
      fireEvent.click(await screen.findByText("Cô Thủy"));
      const libDownloadBtns = await screen.findAllByTitle("Tải đề");
      fireEvent.click(libDownloadBtns[0]);

      await waitFor(() => {
        expect(mockState.lastCreatedAnchorHref).toContain("/object/sign/exam-files/t1/de_cu.docx?token=sig-library");
      });
      libRender.unmount();
    } finally {
      createElSpy.mockRestore();
    }
  });

  it("9. Tương thích đầy đủ quy trình tạo link ngắn /:code và mở link học sinh ở mọi cấp thư mục (gốc, con, cháu, đề cũ)", async () => {
    const scenarios = [
      { label: "thư mục gốc", folderId: "folder-root-1", examId: "exam-root-1", code: "100001" },
      { label: "thư mục con", folderId: "folder-child-1", examId: "exam-child-1", code: "200002" },
      { label: "thư mục cháu", folderId: "folder-grandchild-1", examId: "exam-grand-1", code: "300003" },
      { label: "đề cũ chưa có folder", folderId: null, examId: "exam-legacy-0", code: "400004" },
    ];

    for (const sc of scenarios) {
      const targetExam = {
        id: sc.examId,
        title: `Đề thi trong ${sc.label}`,
        duration_minutes: 30,
        display_mode: "standard",
        folder_id: sc.folderId,
        questions: VALID_PARSED_EXAM,
        team_config: { primary_code: sc.code },
      };

      mockSyncCodes.mockResolvedValueOnce({
        success: true,
        primaryCode: sc.code,
        source: "exam_assignments",
      });
      mockEnsureShortLink.mockResolvedValueOnce({
        shortCode: sc.code,
        targetUrl: `/exam/${sc.examId}?code=${sc.code}`,
        source: "server",
      });

      const modalRender = render(
        <MemoryRouter>
          <QuickExamShareModal open={true} onOpenChange={() => {}} exam={targetExam} />
        </MemoryRouter>
      );

      await waitFor(() => {
        const input = screen.getByLabelText("Link làm bài ngắn") as HTMLInputElement;
        expect(input.value).toMatch(new RegExp(`/${sc.code}$`));
      });
      modalRender.unmount();

      // Verify student short-link redirect /:code resolves and preserves full questions
      mockResolveAssignmentByCode.mockResolvedValueOnce({
        success: true,
        exam: targetExam,
        assignment: { code: sc.code, examId: sc.examId },
      });

      const redirectRender = render(
        <MemoryRouter initialEntries={[`/${sc.code}`]}>
          <Routes>
            <Route path="/:code" element={<ShortLinkRedirect />} />
            <Route path="/take/:id" element={<div data-testid={`resolved-${sc.examId}`}>OK-{sc.code}</div>} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId(`resolved-${sc.examId}`)).toHaveTextContent(`OK-${sc.code}`);
      });
      redirectRender.unmount();
    }
  });
});
