import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tenant module",
  description: "An OpenTenant tenant-module screen",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
