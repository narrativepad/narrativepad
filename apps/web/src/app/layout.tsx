import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { PreviewBanner } from "@/components/PreviewBanner";
import { Providers } from "@/components/Providers";
import { config, publicConfig } from "@/lib/config";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--font-serif" });

export const metadata: Metadata = {
  metadataBase: new URL(config.publicUrl),
  title: { default: "narrativepad: the crowd builds the coin", template: "%s · narrativepad" },
  description:
    "Propose a narrative, vote on the name, ticker and image, then buy it together in one public pool. The official coin is the one the crowd built.",
};

export const viewport: Viewport = { themeColor: "#06080b", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = publicConfig();
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Providers config={cfg}>
          {cfg.simulation && <PreviewBanner />}
          <Header />
          {/* overflow-x-clip: the hero's spinning orbit must never widen the page on phones. */}
          <main id="main" className="flex w-full flex-1 flex-col overflow-x-clip px-4 pt-5 sm:px-5 lg:px-8 2xl:px-10">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
