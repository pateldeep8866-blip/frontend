import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteFooter from "../components/SiteFooter";
import CookieConsent from "../components/CookieConsent";
import GlobalDisclaimerBanner from "../components/GlobalDisclaimerBanner";
import GlobalThemeSwitcher from "../components/GlobalThemeSwitcher";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Arthastra Analytical Information",
  description: "Analytical information investment research assistant",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Arthastra",
  },
  icons: {
    icon: "/arthastra-premium-logo-alt2.svg",
    shortcut: "/arthastra-premium-logo-alt2.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="supabase-anon-key" content={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''} />
        {/* PWA */}
        <meta name="theme-color" content="#0a0a0f" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').catch(function() {});
            });
          }
        `}} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GlobalDisclaimerBanner />
        <GlobalThemeSwitcher />
        {children}
        <SiteFooter />
        <CookieConsent />
      </body>
    </html>
  );
}
