import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";
import { Camera, Image as ImageIcon, Loader2, RefreshCw, XCircle } from "lucide-react";

interface QRScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScanSuccess: (decodedText: string) => void;
}

export default function QRScannerModal({ open, onOpenChange, onScanSuccess }: QRScannerModalProps) {
  const [scannerActive, setScannerActive] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameras, setCameras] = useState<any[]>([]);
  const [currentCameraIdx, setCurrentCameraIdx] = useState(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerElementId = "qr-reader-viewfinder";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch (e) {
        console.error("Error stopping scanner:", e);
      }
      scannerRef.current = null;
    }
    setScannerActive(false);
  };

  const startScanner = async (cameraId?: string) => {
    setErrorMsg(null);
    setScannerActive(false);

    try {
      await stopScanner();

      // Ensure element is ready in DOM
      await new Promise((r) => setTimeout(r, 150));

      const html5QrCode = new Html5Qrcode(readerElementId);
      scannerRef.current = html5QrCode;

      // Get camera list if not loaded yet
      let devCameras = cameras;
      if (!devCameras || devCameras.length === 0) {
        devCameras = await Html5Qrcode.getCameras();
        setCameras(devCameras);
      }

      if (!devCameras || devCameras.length === 0) {
        setErrorMsg("Không tìm thấy camera trên thiết bị của bạn. Bạn có thể chọn tải ảnh mã QR bên dưới.");
        return;
      }

      const selectedId = cameraId || devCameras[currentCameraIdx]?.id || { facingMode: "environment" };

      await html5QrCode.start(
        selectedId,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          // Detected QR
          stopScanner();
          onOpenChange(false);
          toast.success("Đã quét mã QR thành công!");
          onScanSuccess(decodedText);
        },
        () => {
          // frame scan failure (ignore continuous frame scans)
        }
      );

      setScannerActive(true);
    } catch (err: any) {
      console.error("Failed to start camera scanner:", err);
      let msg = "Không thể mở camera. Vui lòng cấp quyền truy cập camera trong trình duyệt hoặc tải ảnh QR lên.";
      if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
        msg = "Quyền truy cập camera bị từ chối. Vui lòng cho phép trình duyệt truy cập camera để quét mã.";
      }
      setErrorMsg(msg);
      setScannerActive(false);
    }
  };

  const switchCamera = () => {
    if (cameras.length <= 1) return;
    const nextIdx = (currentCameraIdx + 1) % cameras.length;
    setCurrentCameraIdx(nextIdx);
    startScanner(cameras[nextIdx].id);
  };

  // Upload QR Image file fallback
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const html5QrCode = scannerRef.current || new Html5Qrcode(readerElementId);
      scannerRef.current = html5QrCode;

      const result = await html5QrCode.scanFile(file, true);
      if (result) {
        stopScanner();
        onOpenChange(false);
        toast.success("Đã nhận diện mã QR từ tệp ảnh!");
        onScanSuccess(result);
      } else {
        toast.error("Không tìm thấy mã QR trong hình ảnh đã chọn. Vui lòng chọn ảnh rõ nét hơn.");
      }
    } catch (err: any) {
      toast.error("Không tìm thấy mã QR trong hình ảnh này. Vui lòng thử lại với ảnh rõ nét hơn.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6 border-2 shadow-2xl">
        <DialogHeader className="text-center">
          <div className="size-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
            <Camera className="size-6" />
          </div>
          <DialogTitle className="text-xl font-black text-foreground">
            Quét mã QR bài thi
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Hướng camera về phía mã QR do giáo viên cung cấp để tự động vào bài.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center mt-2 space-y-4">
          {/* Viewfinder Screen */}
          <div className="relative w-full aspect-square max-w-[280px] rounded-3xl overflow-hidden border-4 border-primary/80 bg-slate-900 shadow-inner flex items-center justify-center">
            <div id={readerElementId} className="w-full h-full" />

            {!scannerActive && !errorMsg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 p-4 text-center">
                <Loader2 className="size-8 animate-spin mb-2 text-primary" />
                <span className="text-xs font-semibold">Đang kích hoạt camera...</span>
              </div>
            )}

            {errorMsg && (
              <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center text-rose-300 p-4 text-center text-xs space-y-2">
                <XCircle className="size-8 text-rose-400" />
                <p className="font-semibold text-rose-200">{errorMsg}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => startScanner()}
                  className="rounded-xl text-xs mt-2 border-white/20 text-white hover:bg-white/10"
                >
                  Thử lại
                </Button>
              </div>
            )}
          </div>

          {/* Controls: Switch Camera & Upload Photo */}
          <div className="w-full flex items-center justify-center gap-2 pt-1">
            {cameras.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={switchCamera}
                className="rounded-xl font-bold text-xs gap-1.5"
              >
                <RefreshCw className="size-3.5" /> Đổi camera
              </Button>
            )}

            {/* Upload image button as reliable fallback */}
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl font-bold text-xs gap-1.5"
            >
              <ImageIcon className="size-3.5" /> Chọn ảnh QR từ máy
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground text-center">
            Bạn cũng có thể nhập trực tiếp mã bài thi bằng tay tại màn hình trang chủ.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
