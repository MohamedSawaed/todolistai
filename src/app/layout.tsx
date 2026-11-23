import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getOptionalSession } from "@/lib/auth";
import { aiConfigured, storageMode } from "@/lib/config";
import { defaultPreferences } from "@/lib/schemas";
import { Providers } from "@/components/providers";
import { isRtl } from "@/lib/i18n";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Tempo — your time, intelligently organized",
  description: "A personal planner that turns your plans into a schedule.",
  applicationName: "Tempo",
  // iPhone "Add to Home Screen": open full-screen with the app name
  appleWebApp: { capable: true, title: "Tempo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
    { media: "(prefers-color-scheme: dark)", color: "#111116" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getOptionalSession();
  const prefs = session ? await session.repo.getPreferences() : defaultPreferences();
  const theme = prefs.theme === "system" ? undefined : prefs.theme;
  return (
    <html
      lang={prefs.locale}
      dir={isRtl(prefs.locale) ? "rtl" : "ltr"}
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <Providers
          initialPrefs={prefs}
          signedIn={!!session}
          status={{ storage: storageMode(), ai: aiConfigured(), email: session?.user.email ?? null }}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
