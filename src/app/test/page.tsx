"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Q = { id: string; type: string; question: string; options?: string[] };

export default function TestPage() {
  const search = useSearchParams();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; maxScore: number } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => { if (!d.user) window.location.href = "/login"; else setUser(d.user); });
  }, []);

  useEffect(() => {
    const mode = (search.get("mode") as "mcq" | "short" | "long") || null;
    if (mode) {
      start(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function start(mode: "mcq" | "short" | "long") {
    setLoading(true);
    const res = await fetch("/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, durationSec: 600, numQuestions: 6 }) });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { alert(data.error || "Failed to start test"); return; }
    setTestId(data.testId);
    // Fetch questions from DB via same page API isn't set; load via minimal call here
    const qs = await fetch(`/api/test-questions?testId=${data.testId}`).then(r => r.json()).catch(() => null);
    setQuestions((qs?.questions as Q[]) || []);
  }

  async function submit() {
    if (!testId) return;
    const res = await fetch("/api/test", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ testId, answers }) });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Failed to submit"); return; }
    setResult(data);
  }

  return (
    <div className="min-h-screen bg-black text-white max-w-3xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Test Mode</h1>
      {!testId && (
        <div className="flex gap-2">
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded" disabled={loading} onClick={() => start("mcq")}>Start MCQ Test</button>
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded" disabled={loading} onClick={() => start("short")}>Start Short Answer</button>
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded" disabled={loading} onClick={() => start("long")}>Start Long Answer</button>
        </div>
      )}

      {testId && (
        <div className="space-y-4">
          {questions.map(q => (
            <div key={q.id} className="border p-3 rounded">
              <p className="font-medium">{q.question}</p>
              {q.type === "mcq" && q.options && (
                <div className="mt-2 space-y-1">
                  {q.options.map((opt, i) => (
                    <label key={i} className="flex items-center gap-2">
                      <input type="radio" name={q.id} value={opt} onChange={() => setAnswers(a => ({ ...a, [q.id]: opt }))} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
              {q.type !== "mcq" && (
                <input className="w-full border border-white/20 bg-black/40 text-white p-2 rounded mt-2" placeholder="Your answer" onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />
              )}
            </div>
          ))}
          <button className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded" onClick={submit}>Submit</button>
        </div>
      )}

      {result && (
        <div className="border p-3 rounded">
          <p className="font-semibold">Score: {result.score} / {result.maxScore}</p>
        </div>
      )}
    </div>
  );
}


