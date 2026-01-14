"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ShaderHoverButton from "@/components/ShaderHoverButton";
// no icons required per new UX

export default function DashboardPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [proceeded, setProceeded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // If the user clears cookies/session, require re-upload before using features
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await fetch("/api/state/active-docs", { cache: "no-store" }).then(r => r.json());
        if (cancelled) return;
        if (!st?.hasActiveDocs) {
          setUploaded(null);
          setProceeded(false);
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function openFileDialog() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  async function uploadSelected(files: FileList) {
    if (!files || files.length === 0) return;
    const form = new FormData();
    Array.from(files).slice(0, 3).forEach(f => form.append("files", f));
    setUploading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form, credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const name = (data?.uploaded?.[0]?.name as string | undefined) || files[0].name;
        setUploaded(name);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        let message = "Upload failed";
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
          if (data?.details) message += `\n\nDetails: ${String(data.details)}`;
          if (data?.hint) message += `\n\nHint: ${String(data.hint)}`;
        } catch {}
        alert(message);
      }
    } catch {
      alert("Network error while uploading");
    } finally {
      setUploading(false);
    }
  }

  function guardNavigate(path: string) {
    if (!uploaded) return;
    router.push(path);
  }
  const examSections = [
    { title: "CHAT WITH AI", onClick: () => guardNavigate("/chat") },
    { title: "MCQ", onClick: () => guardNavigate("/test?mode=mcq") },
    { title: "COMPREHENSIVE", onClick: () => guardNavigate("/test?mode=comprehensive") },
  ];

  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col">
      <div className="flex-1 px-4 py-6">
        {!proceeded && (
          <div className="flex flex-col items-center gap-6 mt-24">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) uploadSelected(e.target.files);
              }}
            />
            <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-white/90 text-black backdrop-blur-md shadow-xl p-8 flex flex-col items-center gap-6">
              <div className="w-full flex flex-row gap-3">
                <button
                  onClick={openFileDialog}
                  disabled={uploading}
                  className={`flex-1 h-14 border border-black transition-colors ${
                    uploading ? "bg-gray-200" : uploaded ? "bg-purple-100 hover:bg-purple-200" : "hover:bg-gray-100"
                  }`}
                  title={uploaded ? `Uploaded: ${uploaded}` : uploading ? "Uploading..." : "Upload"}
                >
                  {uploading ? "UPLOADING" : uploaded ? "UPLOADED" : "Upload file"}
                </button>
                <button
                  disabled
                  className="flex-1 h-14 border border-black bg-white text-black/60 cursor-not-allowed"
                  title="Paste link (coming soon)"
                >
                  Paste Youtube link
                </button>
              </div>
              <button
                onClick={() => setProceeded(true)}
                disabled={!uploaded}
                className={`w-full h-14 border border-black transition-colors ${
                  uploaded ? "bg-yellow-100 hover:bg-yellow-200" : "bg-white cursor-not-allowed"
                }`}
              >
                PROCEED
              </button>
              {uploaded && (
                <p className="text-xs text-black/70">Uploaded: {uploaded}</p>
              )}
            </div>
          </div>
        )}

        {proceeded && (
          <div className="fixed inset-0 bg-neutral-950">
            <div className="grid h-full grid-rows-[3fr_1fr] grid-cols-3 border border-white/15">
              {examSections.map((s, idx) => (
                <ShaderHoverButton
                  key={s.title}
                  onClick={s.onClick}
                  className={`w-full h-full bg-white transition-colors text-base tracking-wide text-black ${
                    idx === 0 ? "" : "border-l border-black"
                  }`}
                >
                  {s.title}
                </ShaderHoverButton>
              ))}
              <ShaderHoverButton
                onClick={() => router.push("/")}
                className="col-span-3 w-full h-full bg-white transition-colors text-base tracking-wide text-black border-t border-black"
              >
                HOME
              </ShaderHoverButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


