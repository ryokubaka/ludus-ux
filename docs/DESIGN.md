# Design

LUX is a dark operations UI for people who already know their range. A screen names the object, the action, and what happens next. It uses one type scale, one set of color tokens, and the controls in `src/components/ui/`. A new screen does not invent a second palette or a second kind of form.

The page title and one-line description live in the header (`src/lib/ui/page-titles.ts`). Do not repeat that title inside the page.

## Review

The shell, tokens, and shared controls are already one system. `src/app/globals.css` sets the palette. `src/lib/ui/status-colors.ts` maps success, warning, error, aborted, neutral, and info onto those tokens. Buttons, inputs, labels, cards, dialogs, and checkboxes live in `src/components/ui/`.

LUXAI had drifted from that system. The chat list was titled LUXAI under a header that already says LUXAI. Messages, the working dot, session rows, and proposal cards used raw `sky`, `zinc`, and `amber` instead of the tokens. Forms used a tinted callout, `text-xs` captions instead of labels, and native selects that did not match `Input`. A VM row was hostname, role, template, and VLAN with no headings. The prompts the person actually reads were fragments: "What kind of range?", "Kind", "Where", "After the config is ready".

Those LUXAI surfaces now follow this file. Other pages still contain raw palette classes (the console, testing, and the dashboard among them). When you edit one of those screens, move the status color onto `statusText`, `statusBadge`, or `statusSurface` instead of adding another `green-400` or `red-500`.

## Color

Use the CSS variables in `src/app/globals.css` through the Tailwind names: `background`, `foreground`, `card`, `muted`, `primary`, `destructive`, `border`, `input`.

Status color goes through `src/lib/ui/status-colors.ts`:

- `statusText` for a short status line or a dot's meaning
- `statusBadge` for a chip
- `statusSurface` for a panel tint

A tinted panel keeps body copy in `text-foreground`. Put that class after `statusSurface` so it wins. The status color is the border, the wash, and the badge, not every sentence in the card.

`primary` is the one action on a screen (Send, Apply, Continue) and the signed-in person's own chat bubble. `destructive` is Stop, Delete, or Destroy. Do not use it for a warning.

## Type and controls

The root size is 13px. Page titles are `text-base font-semibold`. Descriptions and column headers are `text-xs text-muted-foreground`. Section titles override `CardTitle`, which defaults to `text-2xl`.

A single field uses `Label` plus `Input` or `Select` at the default height (`h-10`), with `border-input`, `bg-background`, and the focus ring. A repeating editor row may use `h-8` controls, and it has a visible header row that names each column. On a narrow screen, one line states the column order. A native `<select>` is acceptable in a dense row or a settings grid. Style it like `Input`. Do not leave it as an unstyled browser control.

`Checkbox` sits in a `<label>` with the choice name, and optional detail in `text-xs text-muted-foreground`.

Validation text sits under the field in `text-sm text-destructive`. An empty list says what is missing in one sentence. It does not render a blank box.

## Copy

Write the sentence the person reads. Name the thing and the action. Say what the button does.

- **Continue** records the answers. It does not create, upload, power, or deploy.
- **Apply** is the step that changes the range. **Reject** leaves it alone.
- A form prompt is one or two sentences: what to choose, and that Continue only saves the answers. Then say that nothing changes until Apply, when that is true.
- A label names the value: Range, Range id, Range name, Domain name, VLAN. It is not Kind, Where, or Start from.
- Do not ask someone to type a range id or an AD CS setting when the form can list the ones they can use.
- Do not call the reader "the operator" in the chat. Do not quote proposal ids. The card already shows the summary and the state.

LUXAI appends those writing rules on every run, after the saved system prompt, in `src/lib/luxai/agent.ts`. A custom prompt in Model settings cannot drop them. `ask_operator` uses the same prompt and label rules.

## LUXAI

The header already says LUXAI. The side list is **Chats**. An active chat uses `border-primary` and `bg-accent`. A working chat uses a `primary` dot. A finished chat the person has not opened uses `bg-status-warning`.

The person's messages use `bg-primary` and `text-primary-foreground`. LUXAI's messages use `bg-card` and `border-border`. A question form is the same card, not a separate tint. A proposal card uses a status surface: warning while it waits for Apply, info while Apply is running, success when it applied, error when the command failed, neutral when it was rejected. The badge uses the matching `Badge` variant (`warning`, `info`, `success`, `destructive`, `outline`).

A question that builds a range is a wizard inside the chat, one step at a time. Ludus from scratch follows Deploy New Range: config method, how to start, select range, networks, configure VMs, domain setup, network rules, review. Hostname, role, template, and VLAN are one row. A domain controller lists Windows Server templates only. More than one primary domain controller is a separate domain. A from-scratch range writes the config and proposes it when the form is done, so that step does not wait on the model. A workstation stays off the domain until that step joins it. A joined VM on another VLAN than the domain controller is named there, because the join may fail when inter-VLAN traffic is rejected. A blueprint stops after the blueprint step. A GOAD lab follows Deploy New GOAD Instance: config method, select extensions, select range, network rules, review. Continue is on the last step and only saves the answers. That step shows the answers and waits until you choose create only or create and deploy. Apply is still what creates or deploys the range. Firewall rules in that wizard are `NetworkRulesEditor`, the same component as Configuration and the new-range wizard.

## Motion

`globals.css` already collapses animation when the person prefers reduced motion. A pulse is only for work that is still running.
