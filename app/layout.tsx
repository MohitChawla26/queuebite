import type { Metadata } from "next";
import "./globals.css";
import "./brand-theme.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "QueueBite | Book a table",
  description: "Find a restaurant and reserve a real table.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><ThemeProvider>{children}<Toaster position="top-right" richColors closeButton /></ThemeProvider></body></html>;
}
