import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backslash",
  description: "Open-source LaTeX editor with live PDF preview",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "Backslash",
    description: "Open-source LaTeX editor with live PDF preview",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
