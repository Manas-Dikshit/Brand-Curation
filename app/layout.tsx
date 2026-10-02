import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brand Curation & Evaluation",
  description: "Local, evidence-gated brand research and scoring. No API keys.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}