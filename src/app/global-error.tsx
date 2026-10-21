"use client"

import { useEffect } from "react"
import { reloadDocument, reloadDocumentOnce } from "@/lib/document-reload"

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Global error:", error)
    if (process.env.NODE_ENV === "production") reloadDocumentOnce()
  }, [error])

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          background: "#0b1220",
          color: "#e5e7eb",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "system-ui, sans-serif",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#9ca3af", marginBottom: "1.5rem" }}>
            {process.env.NODE_ENV === "production"
              ? "An unexpected error occurred. Please reload the page."
              : error.message}
          </p>
          <button
            type="button"
            onClick={() => reloadDocument()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #4b5563",
              background: "transparent",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
