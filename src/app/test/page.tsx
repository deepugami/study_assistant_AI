import { Suspense } from "react";
import TestClient from "./TestClient";

export const dynamic = "force-dynamic";

export default function TestPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-[60vh] text-white max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 text-white/80">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
            <span>Loading test…</span>
          </div>
        </div>
      }
    >
      <TestClient />
    </Suspense>
  );
}


