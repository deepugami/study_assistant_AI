"use client";
import { useEffect, useState } from "react";
import AIChatCard from "@/components/AIChatCard";

export default function ChatPage() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => { if (!d.user) window.location.href = "/login"; else setUser(d.user); });
  }, []);

  async function send() {
    if (!input.trim()) return;
    const q = input;
    setMessages(m => [...m, { role: "user", content: q }]);
    setInput("");
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q }) });
    const data = await res.json();
    setMessages(m => [...m, { role: "assistant", content: data.answer || "(no answer)" }]);
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 pb-12">
      <AIChatCard />
    </div>
  );
}


