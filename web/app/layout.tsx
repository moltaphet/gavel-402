import type { Metadata, Viewport } from "next";
import "@fontsource/marcellus";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gavel: agents pay only for proof",
  description:
    "A 3D courtroom replay of pay-on-proof cases: a fast AI judge, a GenLayer appeal court, and a payment held until the ruling.",
};

export const viewport: Viewport = {
  themeColor: "#0b0807",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
