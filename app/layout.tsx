import type { Metadata } from "next";
import { Hanken_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import PageTransition from "@/components/PageTransition";
import "./globals.css";

const sansFont = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const displayFont = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Ripple — Signal Monitoring Platform",
  description:
    "AI-powered monitoring across the open web, X, Reddit, and Bluesky. Ripple clusters emerging complaints, bugs, and sentiment shifts into actionable issues.",
};

const NAV = [
  { href: "/monitor", label: "Monitor" },
  { href: "/insight", label: "Insight" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sansFont.variable} ${displayFont.variable} ${monoFont.variable}`}>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen flex flex-col">
        <header className="sticky top-0 z-50 backdrop-blur-md bg-background/85 border-b border-zinc-200/80 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto flex items-center justify-between h-14">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent text-white">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
                  <path d="M3 12a9 9 0 0 1 18 0" />
                  <path d="M6.5 12a5.5 5.5 0 0 1 11 0" opacity={0.75} />
                  <path d="M10 12a2 2 0 0 1 4 0" opacity={0.5} />
                </svg>
              </span>
              <span className="font-display font-semibold tracking-tight text-[17px] text-foreground">
                Ripple
              </span>
            </Link>

            <nav className="flex items-center gap-0.5 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-lg text-muted hover:text-foreground hover:bg-zinc-100 transition-colors font-medium"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <PageTransition>{children}</PageTransition>
        </main>

        <footer className="border-t border-zinc-200/80 bg-white/60 px-4 sm:px-6 py-6">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="font-mono text-[11px] text-muted">© 2026 Ripple — Signal Monitoring Platform</p>
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-positive" />
              <span className="font-mono text-[11px] text-muted">All Systems Operational</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
