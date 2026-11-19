import type { Metadata, Viewport } from "next";
import { Noto_Sans_Georgian } from "next/font/google";
import { connection } from "next/server";
import { GeorgianValidation } from "@/components/georgian-validation";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: the CSP nonce from src/proxy.ts only reaches the page's
  // scripts in a request-time render; a page prerendered at build time would be blocked.
  await connection();
  return (
    <html lang="ka" className={georgian.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <GeorgianValidation />
        {children}
      </body>
    </html>
  );
}
