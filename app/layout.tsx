import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vocasa",
  description: "Voice-first home sketching for homeowners.",
  icons: {
    icon: "/brand/vocasa-icon.svg",
    apple: "/brand/vocasa-icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
