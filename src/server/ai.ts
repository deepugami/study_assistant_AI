import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function ensureGenAI(): GoogleGenerativeAI | null {
	const key = process.env.API_KEY;
	if (!key) return null;
	if (!genAI) genAI = new GoogleGenerativeAI(key);
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
	const model = client.getGenerativeModel({ model: "text-embedding-004" });
	const resp = await model.embedContent(input);
	// @ts-expect-error library typing sometimes lags
	return resp.embedding.values as number[];
}

export async function generateText(prompt: string): Promise<string> {
	const client = ensureGenAI();
	if (!client) throw new Error("Missing API_KEY for text generation");
	const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
	const result = await model.generateContent(prompt);
	const text = await result.response.text();
	return text;
}

export async function generateJSON<T>(systemPrompt: string): Promise<T> {
	const client = ensureGenAI();
	if (!client) throw new Error("Missing API_KEY for JSON generation");
	const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
	const result = await model.generateContent(systemPrompt + "\nReturn ONLY valid JSON.");
	const text = await result.response.text();
	// Try to extract JSON if fenced
	const match = text.match(/```json[\s\S]*?```/i);
	const jsonText = match ? match[0].replace(/```json|```/gi, "").trim() : text.trim();
	return JSON.parse(jsonText) as T;
}


