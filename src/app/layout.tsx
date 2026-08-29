import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Stockt Pantry",
  description: "What can I cook right now?",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
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
