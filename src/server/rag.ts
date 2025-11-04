import { embedText } from "@/server/ai";

// Local, typed cosine similarity to avoid untyped dependency issues in builds
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Fallback: compare up to the shortest length to be tolerant
    const len = Math.min(a.length, b.length);
    a = a.slice(0, len);
    b = b.slice(0, len);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!isFinite(denom) || denom === 0) return 0;
  return dot / denom;
}

export function chunkText(text: string, chunkSize = 800, overlap = 150): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(words.length, start + chunkSize);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlap;
  }
  return chunks;
}

export async function embedChunks(chunks: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const ch of chunks) {
    embeddings.push(await embedText(ch));
  }
  return embeddings;
}

export function topKSimilar(queryEmbedding: number[], candidates: { id: string; embedding: number[]; text: string }[], k = 5) {
  const scored = candidates.map(c => ({
    ...c,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}


