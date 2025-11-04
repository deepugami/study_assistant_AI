import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function ensureGenAI(): GoogleGenerativeAI | null {
	const key = process.env.API_KEY;
	if (!key) return null;
	if (!genAI) {
		genAI = new GoogleGenerativeAI(key);
	}
	return genAI;
}

function localEmbed(input: string, dim = 256): number[] {
	const vec = new Array(dim).fill(0);
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		hash ^= code;
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		const idx = Math.abs(hash) % dim;
		vec[idx] += 1;
	}
	let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
	return vec.map(v => v / norm);
}

export async function embedText(input: string): Promise<number[]> {
	const client = ensureGenAI();
	if (!client) {
		return localEmbed(input);
	}
	try {
		if (String(process.env.AI_EMBED_LOCAL || "").toLowerCase() === "true") {
			return localEmbed(input);
		}
		const embedModel = process.env.AI_EMBED_MODEL || "text-embedding-004";
		const model = client.getGenerativeModel({ model: embedModel });
		const resp = await model.embedContent(input);
		// Typings may vary; treat as any and cast
	return (resp as any).embedding.values as number[];
	} catch (_e) {
		// Fallback to local embedding on any failure to keep core features working offline
		return localEmbed(input);
	}
}

export async function generateText(prompt: string): Promise<string> {
	const key = process.env.API_KEY;
	if (!key) throw new Error("Missing API_KEY for text generation");
	const preferred = process.env.AI_TEXT_MODEL || "gemini-2.5-flash";
	const fallbacks = [preferred, "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-1.5-pro", "gemini-1.5-flash"];
	let lastErr: unknown = null;
	for (const model of fallbacks) {
		try {
			const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
			const body = {
				contents: [{ role: "user", parts: [{ text: prompt }] }],
			} as any;
			const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
			const json: any = await resp.json();
			const candidates = json.candidates || [];
			const parts = candidates[0]?.content?.parts || [];
			const text = parts.map((p: any) => p.text).filter(Boolean).join("");
			if (text && text.trim()) return text.trim();
		} catch (e) {
			lastErr = e;
			continue;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error("All text generation models failed (REST)");
}

async function callModelsREST(prompt: string, models: string[]): Promise<string> {
	const key = process.env.API_KEY;
	if (!key) throw new Error("Missing API_KEY for text generation");
	let lastErr: unknown = null;
	for (const model of models) {
		try {
			const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
			const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] } as any;
			const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
			const json: any = await resp.json();
			const parts = json.candidates?.[0]?.content?.parts || [];
			const text = parts.map((p: any) => p.text).filter(Boolean).join("");
			if (text && text.trim()) return text.trim();
		} catch (e) {
			lastErr = e;
			continue;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error("All models failed (REST)");
}

export async function generateTextSmart(prompt: string, opts?: { deep?: boolean }): Promise<string> {
	const deep = Boolean(opts?.deep);
	const preferred = process.env.AI_TEXT_MODEL || (deep ? "gemini-2.5-pro" : "gemini-2.5-flash");
	const fallbacks = deep
		? [preferred, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-1.5-pro", "gemini-1.5-flash"]
		: [preferred, "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-1.5-pro", "gemini-1.5-flash"];
	return callModelsREST(prompt, fallbacks);
}

export async function generateJSON<T>(systemPrompt: string): Promise<T> {
	const key = process.env.API_KEY;
	if (!key) throw new Error("Missing API_KEY for JSON generation");
	const preferred = process.env.AI_TEXT_MODEL || "gemini-2.5-flash";
	const fallbacks = [preferred, "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-1.5-pro", "gemini-1.5-flash"];
	let lastErr: unknown = null;
	for (const model of fallbacks) {
		try {
			const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
			const body = { contents: [{ role: "user", parts: [{ text: systemPrompt + "\nReturn ONLY valid JSON." }] }] } as any;
			const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
			const json: any = await resp.json();
			const parts = json.candidates?.[0]?.content?.parts || [];
			const text = parts.map((p: any) => p.text).filter(Boolean).join("");
			const match = text.match(/```json[\s\S]*?```/i);
			const jsonText = match ? match[0].replace(/```json|```/gi, "").trim() : text.trim();
			return JSON.parse(jsonText) as T;
		} catch (e) {
			lastErr = e;
			continue;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error("All JSON generation models failed (REST)");
}


