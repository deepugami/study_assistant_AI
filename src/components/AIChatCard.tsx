"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlowingEffect } from "@/components/GlowingEffect";

type ChatMessage = { sender: "ai" | "user"; text: string };

export default function AIChatCard({ className }: { className?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { sender: "ai", text: "👋 Hello! I’m your AI assistant." },
  ]);
  const [input, setInput] = useState("");
  const [deep, setDeep] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;
    // Pre-check for active docs to avoid AI calls; if none, do nothing (no toast on chat page)
    try {
      const state = await fetch("/api/state/active-docs").then(r => r.json()).catch(() => ({ hasActiveDocs: false }));
      if (!state?.hasActiveDocs) return;
    } catch { return; }
    const q = input.trim();
    setMessages(prev => [...prev, { sender: "user", text: q }]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, deep }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || "⚠️ AI request failed.";
        const details = data?.details ? `\n${String(data.details)}` : "";
        setMessages(prev => [...prev, { sender: "ai", text: `${msg}${details}` }]);
        return;
      }
      const answer = data?.answer ?? "(no answer)";
      setMessages(prev => [...prev, { sender: "ai", text: answer }]);
    } catch {
      setMessages(prev => [...prev, { sender: "ai", text: "⚠️ Network error." }]);
    } finally {
      setIsTyping(false);
    }
  }

  const canSend = Boolean(input.trim());

  return (
    <div className={cn("relative w-[94vw] max-w-[1040px] h-[76vh] min-h-[560px] rounded-3xl p-[2px] mb-8", className)}>
      <GlowingEffect glow blur={18} spread={36} proximity={72} movementDuration={1.2} borderWidth={2} disabled={false} />

      <div className="relative flex flex-col w-full h-full rounded-2xl border border-white/10 overflow-hidden bg-black/85 backdrop-blur-xl shadow-2xl">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.04),transparent_35%),linear-gradient(145deg,rgba(255,255,255,0.05),transparent)]"
          animate={{ opacity: [0.7, 1, 0.85, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Header */}
        <div className="relative z-10 px-6 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">Chat with AI</p>
            <h2 className="text-2xl font-semibold text-white">Assistant</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-200 bg-emerald-400/10 px-3 py-1.5 rounded-full border border-emerald-300/30">
            <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" aria-hidden />
            Live
          </div>
        </div>

        {/* Messages */}
        <div className="relative z-10 flex-1 px-6 py-5 overflow-y-auto space-y-4 text-sm flex flex-col">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={cn(
                "max-w-[78%] rounded-2xl px-4 py-3 shadow-sm border backdrop-blur",
                msg.sender === "ai"
                  ? "self-start bg-white/6 border-white/10 text-white"
                  : "self-end bg-white text-black border-white/30"
              )}
            >
              <p className="text-[11px] uppercase tracking-[0.12em] mb-1 text-white/60">
                {msg.sender === "ai" ? "Assistant" : "You"}
              </p>
              <p className="leading-relaxed whitespace-pre-wrap text-sm">{msg.text}</p>
            </motion.div>
          ))}

          {isTyping && (
            <motion.div
              className="self-start bg-white/6 border border-white/10 text-white rounded-2xl px-4 py-3 inline-flex items-center gap-2 shadow-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.6, 1, 0.8, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
            >
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              <span className="h-2 w-2 rounded-full bg-white animate-pulse delay-150" />
              <span className="h-2 w-2 rounded-full bg-white animate-pulse delay-300" />
              <span className="text-xs text-white/80">Thinking…</span>
            </motion.div>
          )}
        </div>

        {/* Input */}
        <div className="relative z-10 border-t border-white/10 px-6 py-4 bg-black/60 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="accent-white" />
              Deep explanation
            </label>
            <div className="flex items-center gap-2 w-full">
              <div className="flex items-center gap-2 w-full bg-white/5 border border-white/10 rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-white/40">
                <input
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
                  placeholder="Ask anything about your documents..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "h-11 w-11 rounded-full border border-white/15 flex items-center justify-center transition-colors",
                  canSend ? "bg-white text-black hover:bg-white/90" : "bg-white/10 text-white/50 cursor-not-allowed"
                )}
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}



