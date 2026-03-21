import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelScope v1.0",
  description: "Real-time session observatory",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="noise-overlay scope-entrance">{children}</body>
    </html>
  );
}
