import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  FolderPlus,
  Home,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import {
  ExamFolder,
  FolderSortOption,
  getFolderColorMeta,
  getFolderPath,
  getRecursiveExamCount,
  sortFolderList,
} from "@/lib/folderStorage";
import { renderFolderIcon } from "@/components/FolderModals";

interface FolderTreePanelProps {
  folders: ExamFolder[];
  exams: any[];
  folderMappings: Record<string, string | null>;
  activeFolderId: string | null;
  sortOrder?: FolderSortOption;
  onSelectFolder: (folderId: string | null) => void;
  onCreateSubfolder?: (parentFolder: ExamFolder | null) => void;
}

export default function FolderTreePanel({
  folders,
  exams,
  folderMappings,
  activeFolderId,
  sortOrder = "name-asc",
  onSelectFolder,
  onCreateSubfolder,
}: FolderTreePanelProps) {
  const [panelOpen, setPanelOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  // Tự động mở rộng các thư mục cha và chính thư mục đang chọn để thấy ngay thư mục con mới tạo
  useEffect(() => {
    if (!activeFolderId || folders.length === 0) return;
    const path = getFolderPath(folders, activeFolderId);
    if (path.length === 0) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      path.forEach((p) => {
        next.add(p.id);
      });
      return next;
    });
  }, [activeFolderId, folders]);

  const { childrenMap, rootList } = useMemo(() => {
    const idSet = new Set(folders.map((f) => f.id));
    const map = new Map<string, ExamFolder[]>();
    const roots: ExamFolder[] = [];

    folders.forEach((f) => {
      const pid = f.parent_id && idSet.has(f.parent_id) ? f.parent_id : null;
      if (!pid) {
        roots.push(f);
      } else {
        const arr = map.get(pid) || [];
        arr.push(f);
        map.set(pid, arr);
      }
    });

    map.forEach((list, key) => {
      map.set(key, sortFolderList(list, sortOrder));
    });

    return {
      childrenMap: map,
      rootList: sortFolderList(roots, sortOrder),
    };
  }, [folders, sortOrder]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const parents = folders.filter((f) => (childrenMap.get(f.id)?.length || 0) > 0).map((f) => f.id);
    setExpandedIds(new Set(parents));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  if (folders.length === 0) return null;

  const renderNode = (node: ExamFolder, depth: number, visited: Set<string>): React.ReactNode => {
    if (visited.has(node.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(node.id);

    const children = childrenMap.get(node.id) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(node.id);
    const isActive = activeFolderId === node.id;
    const colorMeta = getFolderColorMeta(node.color);
    const totalExams = getRecursiveExamCount(folders, node.id, exams, folderMappings);

    return (
      <div key={node.id} className="select-none">
        <div
          className={`group flex items-center gap-1.5 py-1.5 pr-2 rounded-xl transition-colors cursor-pointer ${
            isActive
              ? `${colorMeta.bg} ${colorMeta.border} border font-bold text-foreground shadow-xs`
              : "hover:bg-muted/60 text-foreground/90"
          }`}
          style={{ paddingLeft: `${Math.min(depth, 6) * 16 + 6}px` }}
          onClick={() => onSelectFolder(node.id)}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? `Thu gọn ${node.name}` : `Mở rộng ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="size-5 rounded-md hover:bg-background/80 grid place-items-center text-muted-foreground shrink-0"
            >
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}

          <div
            className={`size-6 rounded-lg bg-gradient-to-br ${colorMeta.iconGradient} text-white grid place-items-center shrink-0`}
          >
            {renderFolderIcon(node.icon, "size-3.5")}
          </div>

          <span className="text-xs font-semibold truncate flex-1" title={node.name}>
            {node.name}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            {hasChildren && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                {children.length} mục
              </span>
            )}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                isActive
                  ? `${colorMeta.badgeBg} ${colorMeta.text}`
                  : "bg-primary/10 text-primary"
              }`}
              title="Tổng số đề thi (bao gồm thư mục con)"
            >
              {totalExams} đề
            </span>
            {onCreateSubfolder && (
              <button
                type="button"
                title={`Tạo thư mục con trong "${node.name}"`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateSubfolder(node);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 size-6 rounded-lg hover:bg-primary/15 text-primary grid place-items-center transition-opacity"
              >
                <FolderPlus className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {children.map((child) => renderNode(child, depth + 1, nextVisited))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="rounded-2xl border border-border/70 bg-card/90 overflow-hidden shadow-xs">
      <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-2 bg-muted/25 flex-wrap">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-foreground hover:text-primary transition-colors"
        >
          <FolderTree className="size-4 text-teal-600 dark:text-teal-400" />
          <span>Cây thư mục ({folders.length})</span>
          {panelOpen ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        </button>

        {panelOpen && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] rounded-lg gap-1"
              onClick={expandAll}
            >
              <ChevronsUpDown className="size-3" /> Mở rộng tất cả
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] rounded-lg gap-1"
              onClick={collapseAll}
            >
              <ChevronsDownUp className="size-3" /> Thu gọn
            </Button>
          </div>
        )}
      </div>

      {panelOpen && (
        <div className="p-2.5 max-h-72 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => onSelectFolder(null)}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              !activeFolderId
                ? "bg-primary/10 text-primary font-bold"
                : "hover:bg-muted/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Home className="size-3.5 shrink-0" />
            <span>Trang chủ — Tất cả thư mục gốc ({rootList.length})</span>
          </button>

          {rootList.map((root) => renderNode(root, 0, new Set()))}
        </div>
      )}
    </Card>
  );
}
