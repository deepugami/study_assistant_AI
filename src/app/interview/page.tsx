"use client";
import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import { PulseVoiceRecorder } from "@/components/PulseVoiceRecorder";

export default function InterviewPage() {
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [lastUser, setLastUser] = useState("");
  const [lastAssistant, setLastAssistant] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadLoopRef = useRef<number | null>(null);
  const autoTurnRef = useRef<boolean>(true);
  const shouldListenRef = useRef<boolean>(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTranscriptRef = useRef<string>("");
  const restartingRef = useRef<boolean>(false);

  useEffect(() => {
    (async () => {
      // Initialize interview session and speak last assistant message if any
      try {
        const res = await fetch("/api/interview", { method: "GET" });
        const json = await res.json();
        const msgs: Array<{ role: string; content: string }> = json.messages || [];
        const last = [...msgs].reverse().find(m => m.role === "assistant");
        if (last?.content) speak(last.content);
      } catch {}
    })();
  }, []);

  function ensureRecognition(): SpeechRecognition | null {
    try {
      const SR: typeof window.SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return null;
      const rec: SpeechRecognition = new SR();
      // Keep listening across short pauses; collect interim results
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      return rec;
    } catch {
      return null;
    }
  }

  function speak(text: string) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.lang = navigator.language || "en-US";
      utter.onend = () => {
        // After interviewer finishes speaking, prepare to capture user's reply
        if (autoTurnRef.current) scheduleAutoListen();
      };
      synth.cancel();
      synth.speak(utter);
    } catch {}
  }

  function startListening() {
    const rec = ensureRecognition();
    if (!rec) {
      setStatus("Speech recognition not supported in this browser.");
      return;
    }
    recognitionRef.current = rec;
    shouldListenRef.current = true;
    setListening(true);
    setStatus("Listening…");
    rec.onresult = (ev: any) => {
      let finalSeg = "";
      let interimSeg = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalSeg += (res[0]?.transcript || "");
        else interimSeg += (res[0]?.transcript || "");
      }
      if (finalSeg) pendingTranscriptRef.current += (pendingTranscriptRef.current ? " " : "") + finalSeg.trim();
      const display = [pendingTranscriptRef.current, interimSeg.trim()].filter(Boolean).join(" ");
      setLastUser(display.trim());

      // Debounce silence: finalize a bit after speech pauses
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (shouldListenRef.current) {
          stopListening();
        }
      }, 2000);
    };
    rec.onerror = () => {
      setStatus("Recognition error");
      // Try to keep session alive unless user stopped
      if (shouldListenRef.current && !restartingRef.current) {
        restartingRef.current = true;
        setTimeout(() => {
          try { recognitionRef.current?.start(); } catch {}
          restartingRef.current = false;
        }, 250);
      } else {
        setListening(false);
      }
    };
    rec.onend = () => {
      // Browsers often end after short silence; auto-restart if still in listen mode
      if (shouldListenRef.current && !restartingRef.current) {
        restartingRef.current = true;
        setTimeout(() => {
          try { recognitionRef.current?.start(); } catch {}
          restartingRef.current = false;
        }, 150);
      } else {
        setListening(false);
        setStatus("Idle");
      }
    };
    try { rec.start(); } catch {}
  }

  function stopListening() {
    shouldListenRef.current = false;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
    const text = (pendingTranscriptRef.current || '').trim();
    pendingTranscriptRef.current = "";
    if (text) finalizeAndSend(text);
    else setStatus("Idle");
  }

  async function finalizeAndSend(text: string) {
    setStatus("Thinking…");
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      const reply = json.answer || "(No reply)";
      setLastAssistant(reply);
      speak(reply);
      setStatus("Idle");
    } catch {
      setStatus("Network error");
    }
  }

  // Lightweight VAD: monitors microphone energy and triggers listening when voice activity is detected
  async function ensureVAD() {
    try {
      if (!mediaStreamRef.current) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current!;
      const source = ctx.createMediaStreamSource(mediaStreamRef.current!);
      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyserRef.current = analyser;
        source.connect(analyser);
      }
    } catch (e) {
      // If mic permissions are denied, VAD won't run
    }
  }

  function scheduleAutoListen() {
    ensureVAD().then(() => {
      const analyser = analyserRef.current;
      if (!analyser) {
        // Fallback: start recognition after a brief pause
        setTimeout(() => {
          if (!listening) startListening();
        }, 600);
        return;
      }
      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceFrames = 0;
      let speechFrames = 0;
      const thresh = 12; // energy threshold (tunable)
      const maxSilence = 30; // ~0.5s @ ~60fps
      const minSpeech = 5; // need few frames to confirm speech
      const loop = () => {
        analyser.getByteFrequencyData(data);
        const energy = data.reduce((s, v) => s + v, 0) / data.length;
        if (energy < thresh) {
          silenceFrames++;
          speechFrames = 0;
        } else {
          speechFrames++;
          if (speechFrames >= minSpeech) {
            // Detected speech: start recognition
            if (!listening) startListening();
            cancelAutoListen();
            return;
          }
        }
        if (silenceFrames > maxSilence && !listening) {
          // keep waiting; schedule continues
        }
        vadLoopRef.current = requestAnimationFrame(loop);
      };
      cancelAutoListen();
      vadLoopRef.current = requestAnimationFrame(loop);
    });
  }

  function cancelAutoListen() {
    if (vadLoopRef.current) {
      try { cancelAnimationFrame(vadLoopRef.current); } catch {}
      vadLoopRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      cancelAutoListen();
      try { audioContextRef.current?.close(); } catch {}
      try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    };
  }, []);

  return (
    <AppShell>
      <div className="min-h-screen bg-white text-black">
        <div className="max-w-2xl mx-auto p-8">
          <h1 className="text-2xl font-semibold mb-2">Voice Interview</h1>
          <p className="text-sm text-neutral-600 mb-6">Grounded on your uploaded resume. Tap the recorder to speak; the interviewer will reply by voice.</p>

          <PulseVoiceRecorder onStart={startListening} onStop={stopListening} />

          <div className="mt-4 text-sm text-neutral-700">Status: {status}</div>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <div>
              <div className="mb-1 text-xs text-neutral-500">Last user utterance</div>
              <div className="min-h-12 p-3 rounded-lg border bg-white">{lastUser || "(none)"}</div>
            </div>
            <div>
              <div className="mb-1 text-xs text-neutral-500">Last interviewer reply</div>
              <div className="min-h-12 p-3 rounded-lg border bg-white">{lastAssistant || "(waiting)"}</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-neutral-500">Tip: If speech recognition is unavailable, try Chrome. Ensure your resume is uploaded on the dashboard first.</div>
        </div>
      </div>
    </AppShell>
  );
}
