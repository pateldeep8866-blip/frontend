import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteFooter from "../components/SiteFooter";
import CookieConsent from "../components/CookieConsent";
import GlobalDisclaimerBanner from "../components/GlobalDisclaimerBanner";

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
  icons: {
    icon: "/arthastra-premium-logo-alt2.svg",
    shortcut: "/arthastra-premium-logo-alt2.svg",
    apple: "/arthastra-premium-logo-alt2.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GlobalDisclaimerBanner />
        {children}
        <SiteFooter />
        <CookieConsent />
      </body>
    </html>
  );
}
