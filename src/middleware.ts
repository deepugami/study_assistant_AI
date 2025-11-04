import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth removed: make middleware a no-op
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

// Match nothing to avoid unnecessary middleware execution
export const config = {
  matcher: [],
};


