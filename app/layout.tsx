import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: "BEES Sync | Excel a ITEMS v2",
  description: "Procesa, valida y envia catalogos de Excel a BEES.",
  openGraph: {
    title: "BEES Sync | Excel a ITEMS v2",
    description: "Procesa, valida y envia catalogos de Excel a BEES.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "BEES Sync, Excel a ITEMS v2" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BEES Sync | Excel a ITEMS v2",
    description: "Procesa, valida y envia catalogos de Excel a BEES.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
