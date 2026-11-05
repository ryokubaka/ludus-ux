import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Home, Search } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
      <p className="text-8xl font-bold text-muted-foreground/20 mb-4">404</p>
      <h2 className="text-2xl font-semibold mb-2">Page Not Found</h2>
      <p className="text-muted-foreground mb-8">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Button asChild>
        <Link href="/">
          <Home className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </Button>
    </div>
  )
}
