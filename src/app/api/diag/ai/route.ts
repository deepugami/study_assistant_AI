/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

function getClient() {
  const key = process.env.API_KEY;
  if (!key) return null;
  try {
    return new GoogleGenerativeAI(key);
  } catch (e) {
    return { error: String(e) } as any;
  }
}

export async function GET() {
  const info: any = {
    node: process.versions.node,
    hasEnv: Boolean(process.env.API_KEY),
    configuredTextModel: process.env.AI_TEXT_MODEL || "gemini-1.5-pro-latest",
    configuredEmbedModel: process.env.AI_EMBED_MODEL || "text-embedding-004",
  };
  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, ...info, reason: "Missing API_KEY in environment" }, { status: 200 });
  }
  if ((client as any).error) {
    return NextResponse.json({ ok: false, ...info, reason: (client as any).error }, { status: 200 });
  }

  // Test text model
  try {
    const model = (client as GoogleGenerativeAI).getGenerativeModel({ model: info.configuredTextModel });
    const res = await model.generateContent("ping");
    info.textOk = true;
    info.textResponsePreview = await res.response.text();
  } catch (e: any) {
    info.textOk = false;
    info.textError = e?.message || String(e);
  }

  // Test embedding model
  try {
    const em = (client as GoogleGenerativeAI).getGenerativeModel({ model: info.configuredEmbedModel });
    const r = await em.embedContent("ping");
    info.embedOk = true;
    info.embedDim = Array.isArray((r as any).embedding?.values) ? (r as any).embedding.values.length : null;
  } catch (e: any) {
    info.embedOk = false;
    info.embedError = e?.message || String(e);
  }

  // Try to fetch available models (best effort)
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models`;
    const resp = await fetch(`${url}?key=${encodeURIComponent(process.env.API_KEY as string)}`);
    if (resp.ok) {
      const j = await resp.json();
      info.modelsListed = Array.isArray(j.models) ? j.models.slice(0, 10).map((m: any) => m.name) : [];
    } else {
      info.modelsListError = `${resp.status} ${resp.statusText}`;
    }
  } catch (e: any) {
    info.modelsListError = e?.message || String(e);
  }

  const ok = Boolean(info.textOk || info.embedOk);
  return NextResponse.json({ ok, ...info });
}
