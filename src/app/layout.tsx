import type { Metadata } from "next"
import "./globals.css"
import { AppShell } from "@/components/layout/app-shell"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"

export const metadata: Metadata = {
  title: "Ludus UX - Cyber Range User eXperience",
  description: "Open source web interface for Ludus Cyber Range",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  )
}
