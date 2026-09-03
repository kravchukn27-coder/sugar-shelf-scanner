import type { Metadata, Viewport } from "next";
import MetaPixel from "@/components/meta-pixel";
import { metaPixelId } from "@/lib/marketing/meta-pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sugar Shelf Scanner",
  description: "Find the sugar score of products on a shelf.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Added to the Home Screen the origin becomes a standalone app, and iOS then
  // keeps the camera grant in system settings instead of re-asking every visit.
  appleWebApp: {
    capable: true,
    title: "Sugar Scanner",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0C",
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pixelId = metaPixelId(process.env.NEXT_PUBLIC_META_PIXEL_ID);
  return (
    <html lang="en">
      <body>{children}{pixelId && <MetaPixel pixelId={pixelId} />}</body>
    </html>
  );
}
