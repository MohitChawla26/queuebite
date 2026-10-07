import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueueBite | Book a table",
  description: "Find a restaurant and reserve a real table.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
