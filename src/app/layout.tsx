import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Stockt Pantry",
  description: "What can I cook right now?",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
        The inline styles stay until the app shell replaces them (SPEC.md §3.3).
        `antialiased` is the first real utility class in the tree, and it earns
        its place twice: it is part of the shell's eventual body class, and it
        is what proves @tailwindcss/oxide actually scanned this file rather than
        merely emitting preflight.
      */}
      <body
        className="antialiased"
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: "0 auto",
          maxWidth: "48rem",
          padding: "2rem 1rem",
        }}
      >
        {children}
      </body>
    </html>
  );
}
