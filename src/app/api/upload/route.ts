import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { getDb } from "@/server/db";
import { v4 as uuid } from "uuid";
import { chunkText } from "@/server/rag";
import { embedText } from "@/server/ai";

export const runtime = "nodejs"; // to support fs/multer-less streaming

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    if (files.length === 0 || files.length > 3) {
      return NextResponse.json({ error: "Upload 1-3 files" }, { status: 400 });
    }

  const db = getDb();
  const uploadedDocIds: string[] = [];
    for (const file of files) {
      const name = file.name;
      const mime = file.type || "application/octet-stream";
      const buf = Buffer.from(await file.arrayBuffer());

      let text = "";
      if (mime.includes("pdf") || name.toLowerCase().endsWith(".pdf")) {
        try {
          const mod = await import("pdf-parse/lib/pdf-parse.js").catch(() => import("pdf-parse"));
          const pdfParse: any = (mod as any).default ?? (mod as any);
          const parsed = await pdfParse(buf);
          text = parsed?.text || "";
        } catch (e) {
          return NextResponse.json({ error: `Failed to parse PDF: ${name}` }, { status: 400 });
        }
      } else if (mime.includes("word") || name.toLowerCase().endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const res = await mammoth.extractRawText({ buffer: buf });
        text = res.value || "";
      } else if (mime.startsWith("text/") || name.toLowerCase().endsWith(".txt")) {
        text = buf.toString("utf8");
      } else {
        continue;
      }

      const docId = uuid();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO documents (id, userId, name, mime, createdAt) VALUES (?, ?, ?, ?, ?)")
        .run(docId, session.userId, name, mime, now);
      uploadedDocIds.push(docId);

      const chunks = chunkText(text);
      for (const ch of chunks) {
        const emb = await embedText(ch);
        db.prepare("INSERT INTO chunks (id, documentId, content, embedding) VALUES (?, ?, ?, ?)")
          .run(uuid(), docId, ch, JSON.stringify(emb));
      }
    }
    // Scope chat/test to the most recently uploaded files in this session
    session.currentDocIds = uploadedDocIds;
    await session.save();

    return NextResponse.json({ ok: true, currentDocIds: uploadedDocIds });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


