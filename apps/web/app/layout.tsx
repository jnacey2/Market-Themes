import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Themes",
  description: "Narrative intelligence for market research."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
