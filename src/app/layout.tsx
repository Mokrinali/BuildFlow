import type { Metadata, Viewport } from "next";
import { Noto_Sans_Georgian } from "next/font/google";
import "./globals.css";

const georgian = Noto_Sans_Georgian({
  subsets: ["georgian", "latin"],
  variable: "--font-georgian",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "BuildFlow", template: "%s · BuildFlow" },
  description: "სამშენებლო შესყიდვების მართვა",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#092648",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ka" className={georgian.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
