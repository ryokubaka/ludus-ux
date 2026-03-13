// Full-screen layout for the VNC console viewer — no sidebar or shell
export const metadata = { title: "VM Console" }

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
