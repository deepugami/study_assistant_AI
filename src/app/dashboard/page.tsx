"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton, GlassFilter } from "@/components/Glass";
import { BackgroundCircles } from "@/components/BackgroundCircles";
import GradientMenu from "@/components/GradientMenu";
import { IoChatbubbleEllipsesOutline, IoHelpCircleOutline, IoCreateOutline, IoDocumentTextOutline, IoLogoYoutube } from "react-icons/io5";

export default function DashboardPage() {
  const router = useRouter();
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastUploaded, setLastUploaded] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function openFileDialog() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  async function uploadSelected(files: FileList) {
    if (!files || files.length === 0) return;
    setSelectedFiles(files);
    const form = new FormData();
    Array.from(files).slice(0, 3).forEach(f => form.append("files", f));
    setUploading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      if (res.ok) {
        const names = Array.from(files).map(f => f.name);
        setLastUploaded(names);
        setSelectedFiles(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        let message = "Upload failed";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {}
        alert(message);
      }
    } catch {
      alert("Network error while uploading");
    } finally {
      setUploading(false);
    }
  }

  async function guardNavigate(path: string) {
    try {
      const st = await fetch("/api/state/active-docs", { cache: "no-store" }).then(r => r.json()).catch(() => ({ hasActiveDocs: false }));
      if (st?.hasActiveDocs) {
        router.push(path);
      } else {
        setToast("Please upload a file on the dashboard first.");
        setTimeout(() => setToast(null), 2500);
      }
    } catch {
      setToast("Please upload a file on the dashboard first.");
      setTimeout(() => setToast(null), 2500);
    }
  }

  const menuItems = [
    { title: "Chat mode", icon: <IoChatbubbleEllipsesOutline />, gradientFrom: "#a955ff", gradientTo: "#ea51ff", onClick: () => guardNavigate("/chat") },
    { title: "MCQ mode", icon: <IoHelpCircleOutline />, gradientFrom: "#56CCF2", gradientTo: "#2F80ED", onClick: () => guardNavigate("/test?mode=mcq") },
    { title: "SA mode", icon: <IoCreateOutline />, gradientFrom: "#FF9966", gradientTo: "#FF5E62", onClick: () => guardNavigate("/test?mode=short") },
    { title: "LA mode", icon: <IoDocumentTextOutline />, gradientFrom: "#80FF72", gradientTo: "#7EE8FA", onClick: () => guardNavigate("/test?mode=long") },
    { title: "YouTube", icon: <IoLogoYoutube />, gradientFrom: "#ffa9c6", gradientTo: "#f434e2", disabled: true },
  ];

  return (
    <div className="relative min-h-screen bg-black text-white">
      <BackgroundCircles title="" variant="senary" />
      <div className="absolute inset-0 flex flex-col gap-6 items-center justify-center w-full">
        <GlassFilter />
        <GradientMenu items={menuItems} />
        <div className="bg-white/80 rounded-3xl p-4 text-black">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                uploadSelected(e.target.files);
              }
            }}
          />
          <div className="h-4" />
          <div className="flex items-center gap-3">
            <GlassButton onClick={openFileDialog} disabled={uploading}>
              <span>
                {uploading
                  ? "Uploading..."
                  : lastUploaded.length > 0
                    ? lastUploaded.join(", ")
                    : "Upload documents"}
              </span>
            </GlassButton>
            {lastUploaded.length > 0 && (
              <button
                type="button"
                className="px-3 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-black disabled:opacity-50"
                onClick={() => {
                  setLastUploaded([]);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={uploading}
                title="Clear uploaded selection"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-white/90 text-black shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}


