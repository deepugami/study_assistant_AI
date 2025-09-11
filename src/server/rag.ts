import { embedText } from "@/server/ai";
import cosineSimilarity from "cosine-similarity";

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


