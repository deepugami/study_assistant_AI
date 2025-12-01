"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const pathname = usePathname();
  const hideNav = pathname.startsWith("/dashboard");
  if (hideNav) return null;
    return null;
}
