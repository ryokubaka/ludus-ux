/** Node/undici fetch option — not in DOM `RequestInit` (breaks `tsc` in Docker). */
declare global {
  interface RequestInit {
    dispatcher?: import("undici").Dispatcher
  }
}

export {}
