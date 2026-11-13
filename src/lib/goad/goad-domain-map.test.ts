import { describe, expect, it } from "vitest"
import type { BuilderGraph, BuilderVm } from "@/lib/range/range-builder-document"
import {
  addPlannedExtensionVms,
  applyMemberDomains,
  buildGoadDirectory,
  isSafeGoadName,
  matchGoadHost,
  learnGoadDomains,
  overlayGoadDomains,
  pickGoadDirectory,
} from "./goad-domain-map"

const RAW_HOSTS = [
  { key: "dc01", hostname: "kingslanding", type: "dc", domain: "sevenkingdoms.local" },
  { key: "dc02", hostname: "winterfell", type: "dc", domain: "north.sevenkingdoms.local" },
  { key: "srv02", hostname: "castelblack", type: "server", domain: "north.sevenkingdoms.local" },
  { key: "dc03", hostname: "meereen", type: "dc", domain: "essos.local" },
  { key: "srv03", hostname: "braavos", type: "server", domain: "essos.local" },
  { key: "dc04", hostname: "dragonstone", type: "dc", domain: "sevenkingdoms.local" },
]

const RAW_DOMAINS = [
  { fqdn: "sevenkingdoms.local", dc: "dc01", trust: "essos.local" },
  { fqdn: "north.sevenkingdoms.local", dc: "dc02", trust: "" },
  { fqdn: "essos.local", dc: "dc03", trust: "sevenkingdoms.local" },
]

function vm(partial: Partial<BuilderVm> & Pick<BuilderVm, "vmName">): BuilderVm {
  return {
    id: partial.id ?? partial.vmName,
    hostname: partial.hostname ?? partial.vmName,
    template: "win",
    vlan: 10,
    ipLastOctet: 10,
    ramGb: 4,
    cpus: 2,
    os: "windows",
    domainFqdn: null,
    domainRole: "none",
    roles: [],
    roleVars: {},
    raw: {},
    ...partial,
  }
}

function graph(vms: BuilderVm[], domains: BuilderGraph["domains"] = []): BuilderGraph {
  return {
    vms,
    vlans: [],
    domains,
    router: { present: false, vmName: null, hostname: null, template: null, ramGb: null, cpus: null },
    rules: [],
    networkDefaults: {},
    rangeDefaults: {},
    trusts: [],
    dependsOn: [],
  }
}

describe("GOAD domain directory", () => {
  const directory = buildGoadDirectory(RAW_HOSTS, RAW_DOMAINS)

  it("marks the named DC as primary and other DCs as alternates", () => {
    const role = (key: string) => directory.hosts.find((host) => host.key === key)?.role
    expect(role("dc01")).toBe("primary-dc")
    expect(role("dc04")).toBe("alt-dc")
    expect(role("dc02")).toBe("primary-dc")
    expect(role("srv02")).toBe("member")
    expect(role("srv03")).toBe("member")
  })

  it("treats a DNS suffix as a child domain and a trust field as a forest trust", () => {
    const north = directory.domains.find((domain) => domain.fqdn === "north.sevenkingdoms.local")
    const essos = directory.domains.find((domain) => domain.fqdn === "essos.local")
    expect(north?.childOf).toBe("sevenkingdoms.local")
    expect(north?.trust).toBeNull()
    expect(essos?.childOf).toBeNull()
    expect(essos?.trust).toBe("sevenkingdoms.local")
  })

  it("uses the first domain controller when the domains section has no dc", () => {
    const directory = buildGoadDirectory(
      [
        { key: "dc01", hostname: "a", type: "dc", domain: "lab.local" },
        { key: "dc02", hostname: "b", type: "dc", domain: "lab.local" },
      ],
      [],
    )
    expect(directory.hosts.find((host) => host.key === "dc01")?.role).toBe("primary-dc")
    expect(directory.hosts.find((host) => host.key === "dc02")?.role).toBe("alt-dc")
  })

  it("rejects path-like names", () => {
    expect(isSafeGoadName("GOAD")).toBe(true)
    expect(isSafeGoadName("../GOAD")).toBe(false)
    expect(isSafeGoadName("")).toBe(false)
  })
})

describe("SCCM lab matching", () => {
  const sccm = buildGoadDirectory(
    [
      { key: "dc01", hostname: "DC", type: "dc", domain: "sccm.lab" },
      { key: "srv01", hostname: "MECM", type: "server", domain: "sccm.lab" },
      { key: "srv02", hostname: "MSSQL", type: "server", domain: "sccm.lab" },
      { key: "ws01", hostname: "CLIENT", type: "workstation", domain: "sccm.lab" },
    ],
    [{ fqdn: "sccm.lab", dc: "dc01", trust: "" }],
  )

  it("matches Ludus SCCM names to the GOAD host key", () => {
    const hit = matchGoadHost(
      { vmName: "{{ range_id }}-SCCM-DC", hostname: "{{ range_id }}-DC01" },
      "sccm",
      sccm.hosts,
    )
    expect(hit?.key).toBe("dc01")
    expect(hit?.role).toBe("primary-dc")
    expect(
      matchGoadHost(
        { vmName: "{{ range_id }}-SCCM-CLIENT", hostname: "{{ range_id }}-WS01" },
        "sccm",
        sccm.hosts,
      )?.role,
    ).toBe("member")
  })

  it("picks the SCCM lab for an unlinked range and leaves elk out", () => {
    const picked = pickGoadDirectory(
      [
        vm({ vmName: "{{ range_id }}-SCCM-DC", hostname: "{{ range_id }}-DC01" }),
        vm({ vmName: "{{ range_id }}-SCCM-MECM", hostname: "{{ range_id }}-SRV01" }),
        vm({ vmName: "{{ range_id }}-SCCM-MSSQL", hostname: "{{ range_id }}-SRV02" }),
        vm({ vmName: "{{ range_id }}-SCCM-CLIENT", hostname: "{{ range_id }}-WS01" }),
        vm({ vmName: "{{ range_id }}-elk", hostname: "elk", os: "linux" }),
      ],
      "sccm",
      {
        labs: [{ name: "SCCM", ...sccm }, { name: "GOAD", ...buildGoadDirectory(RAW_HOSTS, RAW_DOMAINS) }],
        extensions: [],
      },
    )
    expect(picked?.domains.map((domain) => domain.fqdn)).toEqual(["sccm.lab"])
    const overlaid = overlayGoadDomains(
      graph([
        vm({ vmName: "{{ range_id }}-SCCM-DC", hostname: "{{ range_id }}-DC01" }),
        vm({ vmName: "{{ range_id }}-SCCM-CLIENT", hostname: "{{ range_id }}-WS01" }),
        vm({ vmName: "{{ range_id }}-elk", hostname: "elk", os: "linux" }),
      ]),
      picked,
      "sccm",
    )
    expect(overlaid.vms.find((entry) => entry.hostname.endsWith("DC01"))?.domainFqdn).toBe("sccm.lab")
    expect(overlaid.vms.find((entry) => entry.hostname.endsWith("DC01"))?.domainRole).toBe("primary-dc")
    expect(overlaid.vms.find((entry) => entry.hostname === "elk")?.domainFqdn).toBeNull()
  })
})

describe("GOAD host matching", () => {
  const directory = buildGoadDirectory(RAW_HOSTS, RAW_DOMAINS)

  it("matches a Ludus VM name token and does not let dc01 consume dc011", () => {
    const hit = matchGoadHost(
      { vmName: "{{ range_id }}-GOAD-DC01", hostname: "{{ range_id }}-DC01" },
      "tstrds",
      directory.hosts,
    )
    expect(hit?.key).toBe("dc01")
    const longer = matchGoadHost(
      { vmName: "{{ range_id }}-GOAD-DC011", hostname: "{{ range_id }}-DC011" },
      "tstrds",
      directory.hosts,
    )
    expect(longer).toBeNull()
  })

  it("matches a GOAD hostname token", () => {
    const hit = matchGoadHost(
      { vmName: "custom-host", hostname: "kingslanding" },
      "tstrds",
      directory.hosts,
    )
    expect(hit?.key).toBe("dc01")
  })
})

describe("GOAD domain overlay", () => {
  const directory = buildGoadDirectory(RAW_HOSTS, RAW_DOMAINS)

  it("fills DC and member when the range config has no domain", () => {
    const source = graph([
      vm({ vmName: "{{ range_id }}-GOAD-DC01", ipLastOctet: 11 }),
      vm({ vmName: "{{ range_id }}-GOAD-SRV02", ipLastOctet: 22 }),
      vm({ vmName: "{{ range_id }}-GOAD-DC03", ipLastOctet: 31 }),
      vm({ vmName: "kali", hostname: "kali", os: "linux", domainFqdn: null }),
    ])
    const next = overlayGoadDomains(source, directory, "tstrds")
    const dc = next.vms.find((entry) => entry.vmName.includes("DC01"))
    const member = next.vms.find((entry) => entry.vmName.includes("SRV02"))
    const kali = next.vms.find((entry) => entry.vmName === "kali")
    expect(dc?.domainFqdn).toBe("sevenkingdoms.local")
    expect(dc?.domainRole).toBe("primary-dc")
    expect(member?.domainFqdn).toBe("north.sevenkingdoms.local")
    expect(member?.domainRole).toBe("member")
    expect(kali?.domainFqdn).toBeNull()
    expect(next.domains.find((domain) => domain.fqdn === "north.sevenkingdoms.local")?.childOfFqdn).toBe(
      "sevenkingdoms.local",
    )
    expect(next.trusts.some((trust) => trust.sourceVmId === "goad:sevenkingdoms.local>essos.local")).toBe(true)
    expect(source.vms[0]?.domainFqdn).toBeNull()
  })

  it("keeps a domain that range-config.yml already set", () => {
    const joined = vm({
      vmName: "{{ range_id }}-GOAD-DC01",
      domainFqdn: "yaml.local",
      domainRole: "member",
    })
    const source = graph([joined])
    const next = overlayGoadDomains(source, directory, "tstrds")
    expect(next.vms[0]).toBe(joined)
    expect(next.vms[0]?.domainFqdn).toBe("yaml.local")
  })

  it("returns the same graph when the lab has no hosts", () => {
    const source = graph([vm({ vmName: "ws" })])
    expect(overlayGoadDomains(source, { hosts: [], domains: [] }, "tstrds")).toBe(source)
    expect(overlayGoadDomains(source, null, "tstrds")).toBe(source)
  })

  it("joins a workstation from commonwkstn when the extension config has the domain", () => {
    const hosts = applyMemberDomains(
      [{ key: "ws01", hostname: "casterlyrock", type: "workstation", domain: "sevenkingdoms.local" }],
      [{ hosts: "ws01", memberDomain: "{{lab.hosts[dict_key].domain}}", role: "commonwkstn" }],
    )
    const directory = buildGoadDirectory(hosts, [])
    expect(directory.hosts.find((host) => host.key === "ws01")).toMatchObject({
      domain: "sevenkingdoms.local",
      role: "member",
    })
  })

  it("enrolls every workstation when the play targets the workstation group", () => {
    const hosts = applyMemberDomains(
      [
        { key: "dc01", hostname: "kingslanding", type: "dc", domain: "sevenkingdoms.local" },
        { key: "ws01", hostname: "casterlyrock", type: "workstation", domain: "" },
        { key: "ws02", hostname: "winterfell", type: "workstation", domain: "north.sevenkingdoms.local" },
        { key: "srv02", hostname: "castelblack", type: "server", domain: "" },
      ],
      [{ hosts: "workstation", memberDomain: "sevenkingdoms.local", role: "commonwkstn" }],
    )
    const directory = buildGoadDirectory(hosts, [
      { fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" },
    ])
    expect(directory.hosts.find((host) => host.key === "ws01")).toMatchObject({
      domain: "sevenkingdoms.local",
      role: "member",
    })
    expect(directory.hosts.find((host) => host.key === "ws02")?.domain).toBe("north.sevenkingdoms.local")
    expect(directory.hosts.find((host) => host.key === "srv02")).toBeUndefined()
    expect(directory.hosts.find((host) => host.key === "dc01")?.role).toBe("primary-dc")
  })

  it("keeps a workstation domain when member_domain is the GOAD host lookup", () => {
    const hosts = applyMemberDomains(
      [{ key: "ws01", hostname: "casterlyrock", type: "workstation", domain: "sevenkingdoms.local" }],
      [{ hosts: "workstation", memberDomain: "{{lab.hosts[dict_key].domain}}", role: "commonwkstn" }],
    )
    expect(buildGoadDirectory(hosts, []).hosts[0]?.domain).toBe("sevenkingdoms.local")
  })

  it("uses a literal member_domain when the host record has none", () => {
    const hosts = applyMemberDomains(
      [{ key: "ws01", hostname: "casterlyrock", type: "workstation", domain: "" }],
      [{ hosts: "ws01", memberDomain: "north.sevenkingdoms.local", role: "commonwkstn" }],
    )
    expect(buildGoadDirectory(hosts, []).hosts[0]).toMatchObject({
      domain: "north.sevenkingdoms.local",
      role: "member",
    })
  })

  it("joins W1125H2 to the domain on the hyphenated extension host", () => {
    const directory = buildGoadDirectory(
      [{ key: "w11-25h2", hostname: "highgarden", type: "workstation", domain: "sevenkingdoms.local" }],
      [{ fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" }],
    )
    const source = graph([
      vm({
        vmName: "{{ range_id }}-GOAD-W11-25H2",
        hostname: "{{ range_id }}-W1125H2",
        ipLastOctet: 35,
      }),
      vm({ vmName: "{{ range_id }}-elk", hostname: "{{ range_id }}-elk", os: "linux" }),
    ])
    const next = overlayGoadDomains(source, directory, "adminuser-GOAD-947161")
    expect(next.vms.find((entry) => entry.hostname.includes("W1125H2"))?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname.includes("W1125H2"))?.domainRole).toBe("member")
    expect(next.vms.find((entry) => entry.hostname.endsWith("elk"))?.domainFqdn).toBeNull()
    const withLab = buildGoadDirectory(
      [...RAW_HOSTS, { key: "w11-25h2", hostname: "highgarden", type: "workstation", domain: "sevenkingdoms.local" }],
      RAW_DOMAINS,
    )
    expect(matchGoadHost(
      { vmName: "{{ range_id }}-GOAD-W11-25H2", hostname: "{{ range_id }}-W1125H2" },
      "adminuser-GOAD-947161",
      withLab.hosts,
    )?.key).toBe("w11-25h2")
    expect(matchGoadHost(
      { vmName: "{{ range_id }}-GOAD-DC01", hostname: "kingslanding" },
      "adminuser-GOAD-947161",
      withLab.hosts,
    )?.key).toBe("dc01")
  })

  it("puts an older extension name in the domain of the machine with the same template and address", () => {
    const directory = buildGoadDirectory(
      [{ key: "w11-23h2", hostname: "casterlyrock", type: "workstation", domain: "sevenkingdoms.local" }],
      [{ fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" }],
    )
    directory.vms = [{
      extension: "w11-23h2",
      vmName: "{{ range_id }}-GOAD-W11-23H2",
      hostname: "{{ range_id }}-W1123H2",
      template: "win11-23h2-x64-enterprise-template",
      vlan: 10,
      ipLastOctet: 31,
      ramGb: 4,
      cpus: 2,
    }]
    const source = graph([
      vm({
        vmName: "{{ range_id }}-GOAD-WS01",
        hostname: "{{ range_id }}-WS01",
        template: "win11-23h2-x64-enterprise-template",
        ipLastOctet: 31,
      }),
      vm({ vmName: "{{ range_id }}-elk", hostname: "{{ range_id }}-elk", os: "linux", template: "ubuntu-22.04-x64-server-template", ipLastOctet: 50 }),
    ])
    const next = overlayGoadDomains(source, directory, "despacito")
    expect(next.vms.find((entry) => entry.hostname.endsWith("WS01"))?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname.endsWith("WS01"))?.domainRole).toBe("member")
    expect(next.vms.find((entry) => entry.hostname.endsWith("elk"))?.domainFqdn).toBeNull()
  })

  it("joins member_server and commonwkstn targets by inventory address", () => {
    const learned = learnGoadDomains(
      [{ key: "dc01", hostname: "kingslanding", type: "dc", domain: "sevenkingdoms.local" }],
      [{ fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" }],
      [
        {
          extension: "adfs",
          hosts: ["adfs_server", "entra"],
          roles: ["member_server"],
          memberDomain: "sevenkingdoms.local",
          domain: "",
          parentDomain: "",
          domainName: "",
        },
        {
          extension: "adfs",
          hosts: ["adfs_workstation"],
          roles: ["commonwkstn"],
          memberDomain: "sevenkingdoms.local",
          domain: "",
          parentDomain: "",
          domainName: "",
        },
      ],
      [
        { extension: "adfs", host: "adfs-adfs", octet: 70, groups: ["adfs_server"] },
        { extension: "adfs", host: "adfs-entraconnect", octet: 71, groups: ["entra"] },
        { extension: "adfs", host: "adfs-ws01", octet: 72, groups: ["adfs_workstation"] },
        { extension: "adfs", host: "adfs-gitlab", octet: 73, groups: ["gitlab"] },
      ],
      [
        { extension: "adfs", name: "adfs_server", hosts: ["adfs-adfs"], children: [] },
        { extension: "adfs", name: "entra", hosts: ["adfs-entraconnect"], children: [] },
        { extension: "adfs", name: "adfs_workstation", hosts: ["adfs-ws01"], children: [] },
      ],
    )
    const directory = buildGoadDirectory(learned.hosts, learned.domains)
    directory.vms = [
      { extension: "adfs", vmName: "{{ range_id }}-ADFS-ADFS", hostname: "ADFS-WinServer2022", template: "win2022-server-x64-template", vlan: 10, ipLastOctet: 70, ramGb: 8, cpus: 4 },
      { extension: "adfs", vmName: "{{ range_id }}-ADFS-EntraConnect", hostname: "EntraConnect-WinServer2022", template: "win2022-server-x64-template", vlan: 10, ipLastOctet: 71, ramGb: 8, cpus: 4 },
      { extension: "adfs", vmName: "{{ range_id }}-ADFS-Workstation", hostname: "Workstation-Win11", template: "win11-22h2-x64-enterprise-template", vlan: 10, ipLastOctet: 72, ramGb: 4, cpus: 4 },
      { extension: "adfs", vmName: "{{ range_id }}-ADFS-gitlab", hostname: "{{ range_id }}-gitlab", template: "debian-12-x64-server-template", vlan: 10, ipLastOctet: 73, ramGb: 8, cpus: 2 },
    ]
    const next = overlayGoadDomains(
      graph([
        vm({ vmName: "{{ range_id }}-ADFS-ADFS", hostname: "ADFS-WinServer2022", template: "win2022-server-x64-template", ipLastOctet: 70 }),
        vm({ vmName: "{{ range_id }}-ADFS-EntraConnect", hostname: "EntraConnect-WinServer2022", template: "win2022-server-x64-template", ipLastOctet: 71 }),
        vm({ vmName: "{{ range_id }}-ADFS-Workstation", hostname: "Workstation-Win11", template: "win11-22h2-x64-enterprise-template", ipLastOctet: 72 }),
        vm({ vmName: "{{ range_id }}-ADFS-gitlab", hostname: "{{ range_id }}-gitlab", os: "linux", template: "debian-12-x64-server-template", ipLastOctet: 73 }),
      ]),
      directory,
      "despacito",
    )
    expect(next.vms.find((entry) => entry.hostname === "ADFS-WinServer2022")?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname === "EntraConnect-WinServer2022")?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname === "EntraConnect-WinServer2022")?.domainRole).toBe("member")
    expect(next.vms.find((entry) => entry.hostname === "Workstation-Win11")?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname.includes("gitlab"))?.domainFqdn).toBeNull()
  })

  it("creates a domain from domain_controller and joins member_server children to it", () => {
    const learned = learnGoadDomains(
      [],
      [],
      [
        {
          extension: "corp",
          hosts: ["dc9"],
          roles: ["domain_controller"],
          memberDomain: "",
          domain: "corp.lab.local",
          parentDomain: "",
          domainName: "",
        },
        {
          extension: "corp",
          hosts: ["files"],
          roles: ["child_domain"],
          memberDomain: "",
          domain: "files.corp.lab.local",
          parentDomain: "{{'.'.join(domain.split('.')[1:])}}",
          domainName: "",
        },
        {
          extension: "corp",
          hosts: ["app"],
          roles: ["member_server"],
          memberDomain: "files.corp.lab.local",
          domain: "",
          parentDomain: "",
          domainName: "",
        },
      ],
      [
        { extension: "corp", host: "dc9", octet: 80, groups: [] },
        { extension: "corp", host: "files", octet: 81, groups: [] },
        { extension: "corp", host: "app", octet: 82, groups: [] },
      ],
    )
    const directory = buildGoadDirectory(learned.hosts, learned.domains)
    expect(directory.domains.find((domain) => domain.fqdn === "files.corp.lab.local")?.childOf).toBe("corp.lab.local")
    expect(directory.hosts.find((host) => host.key === "dc9")).toMatchObject({ role: "primary-dc", domain: "corp.lab.local" })
    expect(directory.hosts.find((host) => host.key === "files")?.role).toBe("primary-dc")
    expect(directory.hosts.find((host) => host.key === "app")).toMatchObject({ domain: "files.corp.lab.local", role: "member" })
    directory.vms = [{
      extension: "corp",
      vmName: "APP-BOX",
      hostname: "not-the-host-key",
      template: "win2019-server-x64-template",
      vlan: 10,
      ipLastOctet: 82,
      ramGb: 4,
      cpus: 2,
    }]
    const next = overlayGoadDomains(
      graph([vm({ vmName: "APP-BOX", hostname: "not-the-host-key", template: "win2019-server-x64-template", ipLastOctet: 82 })]),
      directory,
      "lab",
    )
    expect(next.vms[0]?.domainFqdn).toBe("files.corp.lab.local")
    expect(next.vms[0]?.domainRole).toBe("member")
  })

  it("joins WS01 by the inventory address when the planned VM list is missing", () => {
    const directory = buildGoadDirectory(
      [{ key: "w11-23h2", hostname: "casterlyrock", type: "workstation", domain: "sevenkingdoms.local", ipLastOctet: 31 }],
      [{ fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" }],
    )
    const next = overlayGoadDomains(
      graph([
        vm({ vmName: "{{ range_id }}-GOAD-WS01", hostname: "{{ range_id }}-WS01", template: "win11-23h2-x64-enterprise-template", ipLastOctet: 31 }),
        vm({ vmName: "{{ range_id }}-elk", hostname: "{{ range_id }}-elk", os: "linux", template: "ubuntu-22.04-x64-server-template", ipLastOctet: 50 }),
      ]),
      directory,
      "despacito",
    )
    expect(next.vms.find((entry) => entry.hostname.endsWith("WS01"))?.domainFqdn).toBe("sevenkingdoms.local")
    expect(next.vms.find((entry) => entry.hostname.endsWith("elk"))?.domainFqdn).toBeNull()
  })

  it("does not treat a Jinja member_domain as a domain name", () => {
    const learned = learnGoadDomains(
      [],
      [],
      [{
        extension: "exchange",
        hosts: ["srv01"],
        roles: ["member_server"],
        memberDomain: "{{lab.hosts[dict_key].domain}}",
        domain: "",
        parentDomain: "",
        domainName: "",
      }],
      [{ extension: "exchange", host: "srv01", octet: 21, groups: [] }],
    )
    expect(learned.hosts).toEqual([])
  })

  it("draws a staged extension VM in its VLAN until deploy", () => {
    const source = graph([vm({ vmName: "{{ range_id }}-GOAD-DC01", ipLastOctet: 10, vlan: 10 })], )
    source.vlans = [{ vlan: 10, vmIds: ["{{ range_id }}-GOAD-DC01"] }]
    const staged = addPlannedExtensionVms(
      source,
      [{
        extension: "ws01",
        vmName: "{{ range_id }}-GOAD-WS01",
        hostname: "{{ range_id }}-WS01",
        template: "win10",
        vlan: 10,
        ipLastOctet: 31,
        ramGb: 4,
        cpus: 2,
      }],
      "lab",
    )
    expect(staged.pendingVmIds).toEqual(["{{ range_id }}-GOAD-WS01"])
    expect(staged.graph.vlans[0]?.vmIds).toContain("{{ range_id }}-GOAD-WS01")
    const directory = buildGoadDirectory(
      [{ key: "ws01", hostname: "casterlyrock", type: "workstation", domain: "sevenkingdoms.local" }],
      [{ fqdn: "sevenkingdoms.local", dc: "dc01", trust: "" }],
    )
    const shown = overlayGoadDomains(staged.graph, directory, "lab")
    expect(shown.vms.find((entry) => entry.vmName.endsWith("WS01"))?.domainFqdn).toBe("sevenkingdoms.local")
  })

  it("keeps an empty domain and does not duplicate an existing trust", () => {
    const source = graph([vm({ vmName: "{{ range_id }}-GOAD-DC03" })], [
      { fqdn: "empty.local", vmIds: [], primaryDcVmId: null, childOfFqdn: null },
    ])
    source.trusts.push({
      sourceVmId: "already",
      fromFqdn: "essos.local",
      toFqdn: "sevenkingdoms.local",
      sidHistory: false,
    })
    const next = overlayGoadDomains(source, directory, "tstrds")
    expect(next.domains.some((domain) => domain.fqdn === "empty.local")).toBe(true)
    expect(next.trusts.filter((trust) => trust.fromFqdn === "essos.local" && trust.toFqdn === "sevenkingdoms.local")).toHaveLength(1)
  })
})
