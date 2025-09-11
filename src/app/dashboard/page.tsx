"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GlassButton, GlassFilter } from "@/components/Glass";
import { BackgroundCircles } from "@/components/BackgroundCircles";
import GradientMenu from "@/components/GradientMenu";
import { IoChatbubbleEllipsesOutline, IoHelpCircleOutline, IoCreateOutline, IoDocumentTextOutline, IoLogoYoutube } from "react-icons/io5";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      if (!d.user) router.replace("/login"); else setUser(d.user);
    });
  }, [router]);

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
        alert("Uploaded and indexed.");
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

  const menuItems = [
    { title: "Chat mode", icon: <IoChatbubbleEllipsesOutline />, gradientFrom: "#a955ff", gradientTo: "#ea51ff", onClick: () => router.push("/chat") },
    { title: "MCQ mode", icon: <IoHelpCircleOutline />, gradientFrom: "#56CCF2", gradientTo: "#2F80ED", onClick: () => router.push("/test?mode=mcq") },
    { title: "SA mode", icon: <IoCreateOutline />, gradientFrom: "#FF9966", gradientTo: "#FF5E62", onClick: () => router.push("/test?mode=short") },
    { title: "LA mode", icon: <IoDocumentTextOutline />, gradientFrom: "#80FF72", gradientTo: "#7EE8FA", onClick: () => router.push("/test?mode=long") },
    { title: "YouTube", icon: <IoLogoYoutube />, gradientFrom: "#ffa9c6", gradientTo: "#f434e2", disabled: true },
  ];

  return (
    <div className="relative min-h-screen bg-white">
      <BackgroundCircles title="" variant="senary" />
      <div className="absolute inset-0 flex flex-col gap-6 items-center justify-center w-full">
        <GlassFilter />
        <GradientMenu items={menuItems} />
        <div className="bg-white/80 rounded-3xl p-4">
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
          <GlassButton onClick={openFileDialog} disabled={uploading}>
            <span>{uploading ? "Uploading..." : "Upload documents"}</span>
          </GlassButton>
        </div>
      </div>
    </div>
  );
}


