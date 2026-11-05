import type { Metadata } from "next"
import "./globals.css"
import { AuthenticatedRoot } from "@/components/layout/authenticated-root"

export const metadata: Metadata = {
  title: "Ludus UX - Cyber Range User eXperience",
  description: "Open source web interface for Ludus Cyber Range",
  // Favicon points at /api/logo so it tracks the currently-configured LUX
  // logo (custom admin upload, falling back to the bundled default). The
  // `/favicon.ico` rewrite in next.config.js covers browsers that still
  // probe the legacy path directly.
  icons: {
    icon: [{ url: "/api/logo", type: "image/png" }],
    shortcut: "/api/logo",
    apple: "/api/logo",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <AuthenticatedRoot>{children}</AuthenticatedRoot>
      </body>
    </html>
  )
}
