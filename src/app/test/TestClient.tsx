"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BackgroundPathsOverlay } from "@/components/BackgroundPaths";

type Q = { id: string; type: string; question: string; options?: string[] };
type QReveal = Q & { answerKey?: string; hint?: string };

export default function TestClient() {
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QReveal[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"mcq" | "short" | "long" | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<
    | {
        score: number;
        maxScore: number;
        breakdown: Array<{ id: string; userAnswer: string; correctAnswer: string | null; isCorrect: boolean; hint: string | null }>;
      }
    | null
  >(null);

  // On mount: check active docs for toast; respond to mode query param
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await fetch("/api/state/active-docs").then(r => r.json()).catch(() => ({ hasActiveDocs: false }));
        const m = (search.get("mode") as "mcq" | "short" | "long") || null;
        if (!cancelled && st?.hasActiveDocs && m) start(m);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function start(mode: "mcq" | "short" | "long") {
    // Pre-check active docs to show toast and avoid AI calls
    try {
      const state = await fetch("/api/state/active-docs").then(r => r.json()).catch(() => ({ hasActiveDocs: false }));
      if (!state?.hasActiveDocs) return;
    } catch {
      return;
    }
    setLoading(true);
    setMode(mode);
    const res = await fetch("/api/test", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ mode, durationSec: 600, numQuestions: 6 }) });
    let data: any = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      const txt = await res.text().catch(() => "");
      data = txt ? { error: txt } : null;
    }
    setLoading(false);
    if (!res.ok) { alert((data && data.error) || "Failed to start test"); return; }
    setTestId(data.testId);
    // Fetch questions from DB via same page API isn't set; load via minimal call here
    const qs = await fetch(`/api/test-questions?testId=${data.testId}`, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        const cth = r.headers.get("content-type") || "";
        if (cth.includes("application/json")) {
          try { return await r.json(); } catch { return null; }
        }
        return null;
      })
      .catch(() => null);
    setQuestions((qs?.questions as QReveal[]) || []);
  }

  async function submit() {
    if (!testId) return;
    const res = await fetch("/api/test", { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ testId, answers }) });
    let data: any = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      const txt = await res.text().catch(() => "");
      data = txt ? { error: txt } : null;
    }
    if (!res.ok) { alert((data && data.error) || "Failed to submit"); return; }
    setResult(data);
  }

  function retake() {
    setAnswers({});
    setResult(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="relative min-h-[80vh] text-white max-w-3xl mx-auto px-6 py-4 space-y-4">
      <BackgroundPathsOverlay />
      <h1 className="text-3xl font-extrabold tracking-tight">Test Mode</h1>
      {loading && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
          <span className="ml-3 text-sm text-white/90">Generating questions…</span>
        </div>
      )}
      {!testId && (
        <div className="flex gap-2">
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded disabled:opacity-50" disabled={loading} onClick={() => start("mcq")}>{loading ? "Generating…" : "Start MCQ Test"}</button>
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded disabled:opacity-50" disabled={loading} onClick={() => start("short")}>{loading ? "Generating…" : "Start Short Answer"}</button>
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded disabled:opacity-50" disabled={loading} onClick={() => start("long")}>{loading ? "Generating…" : "Start Long Answer"}</button>
        </div>
      )}

      {testId && (
        <div className="space-y-4">
          <AnimatePresence>
            {result && mode === "mcq" && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm p-4 flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-white/70">Your Score</p>
                  <p className="text-2xl font-bold">{result.score} / {result.maxScore}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-white/70">Accuracy</p>
                  <p className="text-2xl font-bold">{Math.round((result.score / Math.max(1, result.maxScore)) * 100)}%</p>
                </div>
                {mode === "mcq" && (
                  <div className="ml-4">
                    <button onClick={retake} className="px-3 py-2 text-sm rounded-md border border-white/20 hover:border-white/40 bg-white/10">Retake Test</button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {questions.map((q, idx) => {
            const b = result?.breakdown.find(x => x.id === q.id);
            const isAnswered = answers[q.id] != null && String(answers[q.id]).length > 0;
            const disabled = mode === "mcq" ? !!result : false;
            return (
              <div key={q.id} className="rounded-xl border border-white/15 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold leading-relaxed">{q.question}</p>
                  {mode === "mcq" && result && (
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${b?.isCorrect ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                      {b?.isCorrect ? "Correct" : "Wrong"}
                    </span>
                  )}
                </div>

                {mode === "mcq" && q.type === "mcq" && q.options && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {q.options.map((opt, i) => {
                      const checked = answers[q.id] === opt;
                      const correctOpt = result && b?.correctAnswer === opt;
                      const wrongSelected = result && checked && !b?.isCorrect;
                      return (
                        <label key={i} className={`group relative flex items-center gap-2 rounded-lg border px-3 py-2 transition ${checked ? "border-white/50 bg-white/10" : "border-white/10 hover:border-white/20"} ${correctOpt ? "ring-1 ring-emerald-500/40" : ""} ${wrongSelected ? "ring-1 ring-rose-500/40" : ""}`}>
                          <input
                            type="radio"
                            name={q.id}
                            value={opt}
                            disabled={disabled}
                            checked={checked}
                            onChange={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                            className="accent-white/80"
                          />
                          <span>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {mode !== "mcq" && (
                  <div className="mt-3">
                    <button
                      className="px-3 py-2 text-sm rounded-md border border-white/20 hover:border-white/40 bg-white/10"
                      onClick={() => setRevealed(r => ({ ...r, [q.id]: !r[q.id] }))}
                    >
                      {revealed[q.id] ? "Hide answer" : "Show answer"}
                    </button>
                    <AnimatePresence>
                      {revealed[q.id] && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.25 }}
                          className="mt-3 text-sm text-white/80 space-y-1"
                        >
                          {q.answerKey && (
                            <p><span className="text-white/60">Answer:</span> <span className="font-medium">{q.answerKey}</span></p>
                          )}
                          {q.hint && (
                            <p className="text-white/70"><span className="text-white/60">Hint:</span> {q.hint}</p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                <AnimatePresence>
                  {mode === "mcq" && result && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25, delay: Math.min(0.04 * idx, 0.6) }}
                      className="mt-3 text-sm text-white/80 space-y-1"
                    >
                      {!b?.isCorrect && b?.correctAnswer && (
                        <p><span className="text-white/60">Correct answer:</span> <span className="font-medium">{b.correctAnswer}</span></p>
                      )}
                      {b?.hint && (
                        <p className="text-white/70"><span className="text-white/60">Hint:</span> {b.hint}</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {mode === "mcq" && !result && (
            <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded" onClick={submit} disabled={!questions.length || Object.keys(answers).length === 0 || Object.values(answers).every(v => !v)}>
              Submit
            </button>
          )}
        </div>
      )}

      {/* spacer */}
      <div className="h-16" />

    </div>
  );
}
