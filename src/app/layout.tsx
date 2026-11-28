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
  title: "PlanMind",
  description: "A personal planner that turns your plans into a schedule.",
  applicationName: "PlanMind",
  // iPhone "Add to Home Screen": open full-screen with the app name
  appleWebApp: { capable: true, title: "PlanMind", statusBarStyle: "default" },
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
  // Hosted servers (e.g. Vercel) can't keep a local data file, so Supabase is required there.
  if (storageMode() === "local" && process.env.VERCEL) {
    return (
      <html lang="en">
        <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "15vh auto", padding: 16, lineHeight: 1.5 }}>
          <h1 style={{ fontSize: 22 }}>PlanMind needs a database</h1>
          <p>
            This deployment has no Supabase connection, so your data couldn&apos;t be saved. In your Vercel project settings, add{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then redeploy.
          </p>
        </body>
      </html>
    );
  }
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
      <head>
        {/* first launch only: show the short introduction before the page paints (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(!localStorage.getItem('planmind.introduced'))document.documentElement.setAttribute('data-splash','')}catch(e){}" }} />
      </head>
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
