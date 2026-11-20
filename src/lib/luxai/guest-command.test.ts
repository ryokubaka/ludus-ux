import { describe, expect, it } from "vitest"
import { fitGuestCommand, guestOsForHost } from "@/lib/luxai/guest-command"

const TABLE = "Get-Process | Format-Table Name, Id -AutoSize"

describe("guest command shell", () => {
  it("reads Windows from the inventory group and the range config template", () => {
    const inventory = "[windows]\ntest2-GOAD-DC01 ansible_host=10.2.10.10\n\n[linux]\ntest2-kali ansible_host=10.2.20.10\n"
    expect(guestOsForHost("test2", "test2-GOAD-DC01", "", inventory)).toBe("windows")
    expect(guestOsForHost("test2", "test2-kali", "", inventory)).toBe("posix")
    const config = "ludus:\n  - vm_name: \"{{ range_id }}-GOAD-DC01\"\n    hostname: \"{{ range_id }}-DC01\"\n    template: win2022-server-x64-template\n"
    expect(guestOsForHost("test2", "test2-GOAD-DC01", config, "")).toBe("windows")
    const linux = "ludus:\n  - vm_name: \"{{ range_id }}-kali\"\n    template: kali-x64-desktop-template\n"
    expect(guestOsForHost("test2", "test2-kali", linux, "")).toBe("posix")
  })

  it("turns ps aux into the PowerShell process table on a Windows host", () => {
    const fitted = fitGuestCommand("windows", "posix", "ps aux")
    expect(fitted.shell).toBe("powershell")
    expect(fitted.command).toBe(TABLE)
    expect(fitted.note).toContain("does not run in PowerShell")
    expect(fitted.note).toContain(TABLE)
  })

  it("uses the process table when the model already chose win_shell", () => {
    expect(fitGuestCommand("unknown", "powershell", "ps aux").command).toBe(TABLE)
    expect(fitGuestCommand("unknown", "powershell", "ps").command).toBe(TABLE)
    expect(fitGuestCommand("unknown", "powershell", "ps").note).toContain("instead of")
    expect(fitGuestCommand("windows", "powershell", "ps explorer").command).toBe(
      "Get-Process -Name explorer | Format-Table Name, Id -AutoSize",
    )
    expect(fitGuestCommand("windows", "powershell", TABLE).command).toBe(TABLE)
    expect(fitGuestCommand("windows", "powershell", TABLE).note).toBeNull()
  })

  it("keeps ps aux on Linux and rewrites a PowerShell cmdlet", () => {
    const posix = fitGuestCommand("posix", "powershell", "ps aux")
    expect(posix.shell).toBe("posix")
    expect(posix.command).toBe("ps aux")
    const cmdlet = fitGuestCommand("posix", "powershell", "Get-Process")
    expect(cmdlet.shell).toBe("posix")
    expect(cmdlet.command).toBe("ps -eo pid,comm")
  })

  it("refuses a Unix command it cannot run in PowerShell", () => {
    expect(() => fitGuestCommand("windows", "powershell", "chmod 755 /tmp")).toThrow(/does not run in PowerShell/)
    expect(() => fitGuestCommand("windows", "powershell", "vi C:\\note.txt")).toThrow(/does not run in PowerShell/)
    expect(fitGuestCommand("windows", "posix", "whoami").command).toBe("whoami")
    expect(fitGuestCommand("windows", "posix", "whoami").shell).toBe("powershell")
  })
})
