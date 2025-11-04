"use client";
import { useEffect, useState } from "react";
import AIChatCard from "@/components/AIChatCard";
import { BackgroundPathsOverlay } from "@/components/BackgroundPaths";
import { motion } from "framer-motion";

export default function ChatPage() {
  // No toast on chat page for missing uploads; navigation is gated from dashboard

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 pb-16">
      <BackgroundPathsOverlay />
      <AIChatCard />
    </div>
  );
}


