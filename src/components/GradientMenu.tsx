"use client";
import React from "react";
import { IoChatbubbleEllipsesOutline, IoHelpCircleOutline, IoCreateOutline, IoDocumentTextOutline, IoLogoYoutube } from "react-icons/io5";

type MenuItem = {
  title: string;
  icon: React.ReactNode;
  gradientFrom: string;
  gradientTo: string;
  onClick?: () => void;
  disabled?: boolean;
};

export default function GradientMenu({ items }: { items: MenuItem[] }) {
  return (
    <div className="flex justify-center items-center min-h-[200px]">
      <ul className="flex gap-6">
        {items.map(({ title, icon, gradientFrom, gradientTo, onClick, disabled }, idx) => (
          <li
            key={idx}
            style={
              ({
                "--gradient-from": gradientFrom,
                "--gradient-to": gradientTo,
              } as React.CSSProperties)
            }
            className={`relative w-[60px] h-[60px] bg-white/90 shadow-lg rounded-full flex items-center justify-center transition-all duration-500 hover:w-[180px] hover:shadow-none group cursor-pointer ${disabled ? "opacity-60 pointer-events-none" : ""}`}
            onClick={disabled ? undefined : onClick}
            aria-disabled={disabled}
            title={title}
          >
            <span className="absolute inset-0 rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] opacity-0 transition-all duration-500 group-hover:opacity-100"></span>
            <span className="absolute top-[10px] inset-x-0 h-full rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] blur-[15px] opacity-0 -z-10 transition-all duration-500 group-hover:opacity-50"></span>

            <span className="relative z-10 transition-all duration-500 group-hover:scale-0 delay-0">
              <span className="text-2xl text-gray-600">{icon}</span>
            </span>

            <span className="absolute text-white uppercase tracking-wide text-sm transition-all duration-500 scale-0 group-hover:scale-100 delay-150">
              {title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Named export: default set for convenience if needed elsewhere
export const defaultGradientMenuItems = {
  IoChatbubbleEllipsesOutline,
  IoHelpCircleOutline,
  IoCreateOutline,
  IoDocumentTextOutline,
  IoLogoYoutube,
};


