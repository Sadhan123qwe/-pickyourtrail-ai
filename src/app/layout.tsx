import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { FeedbackProvider } from "@/components/feedback";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Pickyourtrail AI — Trip planner & business platform (demo)", template: "%s · Pickyourtrail AI (demo)" },
  description: "AI-powered trip discovery, itineraries, support and an employee business platform. Interview demo build.",
};

export const viewport: Viewport = { themeColor: "#17152f" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col text-foreground">
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
