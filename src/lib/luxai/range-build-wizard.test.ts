import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RangeBuildWizard, VmRows } from "@/components/luxai/range-build-wizard"

describe("range build wizard markup", () => {
  it("shows VLAN and the number in the VM row", () => {
    const html = renderToStaticMarkup(createElement(VmRows, {
      rows: [{ hostname: "dc01", role: "primary-dc", template: "win2019-server-x64-template", vlan: "10" }],
      roles: [{ id: "primary-dc", label: "Primary domain controller" }],
      templates: [
        { id: "win2019-server-x64-template", os: "windows" },
        { id: "win11-25h2-x64-enterprise-template", os: "windows" },
        { id: "debian-12-x64-server-template", os: "linux" },
      ],
      networks: [{ vlan: "10" }, { vlan: "21" }],
      disabled: false,
      onChange: () => undefined,
    }))
    expect(html).toContain("VLAN 10")
    expect(html).toContain("VLAN 21")
    expect(html).toContain("Hostname")
    expect(html).toContain("grid-cols-[minmax(7rem,1.1fr)_minmax(10rem,1.3fr)_minmax(12rem,1.6fr)_9rem_2rem]")
    expect(html).not.toContain("grid-cols-2")
    expect(html).toContain("win2019-server-x64-template")
    expect(html).not.toContain("win11-25h2")
    expect(html).not.toContain("debian-12")
  })

  it("starts on the first step and does not send a create-only choice", () => {
    const html = renderToStaticMarkup(createElement(RangeBuildWizard, {
      choice: {
        id: "c",
        prompt: "Build this range one step at a time.",
        multiple: true,
        options: [],
        fields: [
          { id: "kind", label: "Range type", kind: "select", options: [{ id: "ludus", label: "Ludus range" }] },
          { id: "start", label: "How to start", kind: "select", options: [{ id: "scratch", label: "From scratch" }] },
          {
            id: "action",
            label: "When you press Apply",
            kind: "select",
            options: [
              { id: "create", label: "Create the range only" },
              { id: "deploy", label: "Create the range and deploy it" },
            ],
          },
        ],
      },
      onSubmit: () => {
        throw new Error("the first step must not submit")
      },
    }))
    expect(html).toContain("Config method")
    expect(html).toContain(">Next<")
    expect(html).not.toContain("Create the range only")
    expect(html).not.toContain("type=\"submit\"")
  })

  it("stops on review with both Apply choices and neither one selected", () => {
    const html = renderToStaticMarkup(createElement(RangeBuildWizard, {
      initialIndex: 20,
      initialValues: { kind: "ludus", start: "scratch", rangeId: "ludusai-test", name: "ludusai-test", domain: "meow.local" },
      choice: {
        id: "c",
        prompt: "Build this range one step at a time.",
        multiple: true,
        options: [],
        fields: [
          { id: "kind", label: "Range type", kind: "select", options: [{ id: "ludus", label: "Ludus range" }] },
          { id: "start", label: "How to start", kind: "select", options: [{ id: "scratch", label: "From scratch" }] },
          { id: "rangeMode", label: "Range", kind: "select", options: [{ id: "new", label: "Create a new range" }] },
          {
            id: "action",
            label: "When you press Apply",
            kind: "select",
            options: [
              { id: "create", label: "Create the range only" },
              { id: "deploy", label: "Create the range and deploy it" },
            ],
          },
        ],
      },
      onSubmit: () => {
        throw new Error("review must not submit on its own")
      },
    }))
    expect(html).toContain("Check these answers")
    expect(html).toContain("Create the range only")
    expect(html).toContain("Create the range and deploy it")
    expect(html).toContain("type=\"radio\"")
    expect(html).not.toContain("checked")
    expect(html).toContain("disabled")
    expect(html).toContain(">Continue<")
    expect(html).not.toContain("type=\"submit\"")
    expect(html).not.toContain("When you press Apply: Create the range only")
  })

  it("says update and deploy when the range already exists", () => {
    const html = renderToStaticMarkup(createElement(RangeBuildWizard, {
      initialIndex: 20,
      initialValues: { kind: "ludus", start: "scratch", rangeMode: "rangeb" },
      choice: {
        id: "c",
        prompt: "Build this range one step at a time.",
        multiple: true,
        options: [],
        fields: [
          { id: "kind", label: "Range type", kind: "select", options: [{ id: "ludus", label: "Ludus range" }] },
          { id: "start", label: "How to start", kind: "select", options: [{ id: "scratch", label: "From scratch" }] },
          { id: "rangeMode", label: "Range", kind: "select", options: [{ id: "rangeb", label: "Range B" }] },
          {
            id: "action",
            label: "When you press Apply",
            kind: "select",
            options: [
              { id: "create", label: "Create the range only" },
              { id: "deploy", label: "Create the range and deploy it" },
            ],
          },
        ],
      },
      onSubmit: () => {
        throw new Error("review must not submit on its own")
      },
    }))
    expect(html).toContain("Update this range only")
    expect(html).toContain("Deploy this range")
    expect(html).not.toContain("Create the range only")
    expect(html).toContain("choose update only or deploy")
  })
})
