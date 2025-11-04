"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Auth removed: redirect this route away
export default function LoginPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/dashboard"); }, [router]);
  return null;
}


