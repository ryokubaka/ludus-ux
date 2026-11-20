# LUXAI

LUXAI is the in-app assistant for configuring, building, deploying, and checking Ludus ranges, including GOAD labs. It runs inside LUX and calls Ludus as the signed-in user, or as the user an admin is impersonating. Creating a range sends that user's Ludus id, and Ludus grants the range to them in that call. LUXAI does not call the admin-only assign endpoint. An admin turns it on. Until then the page explains that it is off, and no model is contacted.

LUX does not add a second MCP server. The official Ludus MCP (`@badsectorlabs/ludus-mcp`) already exposes the Ludus API as `list_ludus_operations`, `describe_ludus_operation`, and `call_ludus_api`. LUXAI calls the same API through LUX, so the session, impersonation, and range checks stay in one place. Agents that run outside LUX (Cursor, Claude Code, OpenCode) should use that MCP plus [ludus-skills](https://gitlab.com/badsectorlabs/ludus-skills). See the [Ludus MCP docs](https://docs.ludus.cloud/docs/using-ludus/mcp/).

## What it can change

Every mutation is a proposal. Nothing is uploaded, powered, deployed, or run until you press **Apply** on that proposal. **Reject** leaves the range alone.

| Proposal | What Apply does | Revert |
| --- | --- | --- |
| Range config | Uploads the YAML with the existing config route | Restores the previous YAML when the live file still matches the applied copy |
| Power | `PUT /range/poweron` or `poweroff` | Not automatic. Power the other way |
| Deploy | `POST /range/deploy` | Not automatic |
| Guest command | One Ansible module on one inventory host | Not automatic. The journal keeps the command and a short copy of the output |

A guest command is `ansible.builtin.shell` or `ansible.windows.win_shell` against one inventory host. When that command finishes, the same chat continues the request that is still open. The output is kept up to 256,000 characters. JSON, YAML, and a fixed-width table are shown as Markdown. A read-only check does not end a change: if the setting is not already in place, the next step is the proposal for the change. The inventory from Ludus is written as YAML before Ansible reads it, so a `[` in a host name or a value is not treated as a host range. The name is not an Ansible group: `all` and `windows` do not fan out. The connection is `ssh` or `winrm`, and a host line that says `ansible_connection=local` is refused. The Ludus host runs it through `lux-host guest-ansible` as one playbook task. The script is the task body. It is not an Ansible `@file` argument, which Windows PowerShell would run as the script text. The API key and the command are stdin, not arguments. The helper reads the inventory from the local Ludus API at `https://127.0.0.1:8080`, writes the playbook to a temp file, and deletes that file. The next guest command updates the host helper from this LUX build when Settings has an update key. Range-config proposals do not need the new helper.

LUXAI will not invent a range id. A question about an existing range is a dropdown of the ranges this user can access, with the range named in the message selected when it matches. An AD CS question is a dropdown of the configurations LUXAI can set (ESC1, ESC2, ESC3, ESC6, ESC9, ESC15, and ESC16), and the one named in the message is selected. Inventory passwords are redacted unless your own message names that one account. Lab notes for GOAD and for those AD CS settings tell it to read the attributes back and to stop at configuration. They do not include exploit steps.

Chats and proposals are stored in `data/ludus-ux.db` and belong to the signed-in user, or to the user an admin is impersonating. The session list shows the chat title on the row. Rename, archive, restore, and delete are in that row's menu. Archived chats stay in a collapsed list. Double-click a title to rename it. Each chat is a separate run. Several chats can run at the same time, and opening another chat leaves the others going. A second question in a chat that is already running is a steer, not a second run. Pause, stop, steer, and interrupt cancel the model call that is in progress instead of waiting for it to finish.

A question on the page is a form, not a free-text quiz. The prompt is one or two sentences: what to choose, and that Continue only saves the answers. Labels name the value (Range, Range id, Domain name, VLAN). Building a range is the Deploy New Range wizard, or the GOAD wizard, one step at a time inside the chat. Continue is on the last step and only saves the answers. That step shows the answers and waits until you choose create only or create and deploy. An existing range says update or deploy. The same colors, labels, and controls as the rest of LUX are specified in [Design](DESIGN.md). Asking to build a Ludus range from scratch collects the networks, the domain, and each VM on those steps. Each VM is one row: hostname, role, template, and VLAN. A domain controller lists Windows Server templates only. More than one primary domain controller is a separate domain. The form writes that config and proposes it, including a deploy when that was the choice, without another model pass. A firewall rule uses a VLAN number, or the words public, all, or wireguard, as the range config schema requires. Each VM picks one of those networks. A workstation stays off the domain until you join it on the domain step. A joined VM on another VLAN than the domain controller is named there, with the choice to allow that path, move the VM, or leave it off the domain, because the join may fail when inter-VLAN traffic is rejected. Ludus and GOAD both collect firewall rules with the same editor as Configuration: rule name, source and destination VLAN, optional last octet, protocol, ports, and action. Rows are evaluated top to bottom, and they can be dragged to change that order. Apply loads that lab's Ludus config from the GOAD checkout, merges those firewall rules into it, and uploads that file in place of the stock range config. The install sets that same file, and the rules are put back if the install rewrites the config. Every hostname is the short computer name. `{{ range_id }}` stays on the VM name. When a hostname includes that token, LUX says the hostname is saved without it. Ludus ranges, GOAD, the builder, blueprints, Configuration, and LUXAI write hostnames the same way. A Windows hostname is at most 15 characters. A lab name has to be one of the catalog names. Add a VM, choose its role, and choose a built template. A Windows role only lists Windows templates, and a Linux router only lists Linux templates. Continue waits until the hostnames, roles, templates, VLAN, and domain check out. The proposal then shows the full range config in an editable box. Apply creates the range with the text in that box. A Windows template without a windows object, or a Linux template without linux, is filled in before that upload. Ludus rejects a VM that has neither. If they also chose deploy, that same Apply starts a full deploy. The form they filled stays in the chat. Asking to deploy a GOAD lab, for example "Using rangeb range, I want to deploy GOAD-Mini", checks the GOAD catalog on this server. If that lab is available and the range is one this user can use, the chat lists the extensions that lab accepts. The checklist is the operator's. Apply then starts the same GOAD install as Deploy New GOAD Instance. A lab that is not in the catalog is named as unavailable, along with the labs that are. A lab, extension, template, or blueprint this host cannot install stays in the list with the missing template or Ansible role, and Apply is not offered for it. A Ludus deploy opens that range on the dashboard. A GOAD deploy opens the install page, then the instance dashboard once the instance exists.

## Connect a model

An admin sets this on the LUXAI page. The API key is encrypted with `APP_SECRET` (`enc:v2:`) and is not shown again. Each provider keeps its own API key, model, and base URL. Switching providers restores the key saved for the one you select. Leaving the key blank keeps that provider's saved key. Changing that provider's egress or base URL clears its key, so a saved key is not sent to a new address. **Test connection** calls the provider's model list and fills the model menu. It sends no range data. A redirect on the same host is followed, so nginx can send HTTP to HTTPS or add a trailing slash. A redirect to another host, or to a login page, is not followed. Effort is Default, Low, Medium, High, or Extra high. The context window is how much of the chat LUXAI sends (Default, 32k, 128k, 200k, 256k, 500k, or 1M). Replies stream as the model produces them. Apply shows that it is running, and a failed guest command stays on the card with the output. A proxy variable on the LUX process (`HTTP_PROXY`, `HTTPS_PROXY`) can still send that request somewhere else; leave those unset for the LUX service when the model URL must be the one you saved.

**Local** allows `http` or `https` only when every resolved address is private, loopback, or link-local (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, IPv6 loopback, link-local, and unique-local). **Cloud** requires `https` and refuses loopback, link-local, and metadata addresses. One public address on a name is enough to refuse it in local mode.

### Direct, OpenAI-compatible

Use provider **OpenAI-compatible**. The base URL should end in `/v1`. LUXAI posts to `{base}/chat/completions` and does not send `tool_choice`, because Ollama rejects that field. Tools are still sent.

Ollama, from [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility):

1. Run `ollama serve` (the app does this).
2. Base URL `http://127.0.0.1:11434/v1`. Egress **Local**.
3. API key can be any non-empty placeholder or blank. Ollama ignores it.
4. Model id is the name you pulled, such as the id from `GET /v1/models`.

llama.cpp's server, from the [server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), listens on its own port and serves `POST /v1/chat/completions`. Use that origin plus `/v1`, egress **Local**, and the model name the server reports. If you started it with `--api-key`, put that key in LUXAI.

A cloud gateway that speaks the same API (OpenAI, or another host you trust) uses egress **Cloud**, `https`, and a bearer key. Set **Effort** when that server accepts `reasoning_effort`. Leave it on Default for a local server that rejects the field.

Hermes Agent's dashboard and its API server are different listeners. The dashboard on `https://your-host` answers `/v1/models` with a redirect to `/login`. The API server listens on `127.0.0.1:8642` and expects `Authorization: Bearer` set to `API_SERVER_KEY`. Publish that listener with nginx, and leave buffering off so replies can stream:

```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:8642;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

The LUXAI base URL is then `https://your-host/v1`, egress **Local** when that name resolves to a private address. The key is `API_SERVER_KEY`, not the dashboard password.

### Claude

Use provider **Anthropic (Claude)** and egress **Cloud**. Base URL `https://api.anthropic.com`. LUXAI calls `POST /v1/messages` with header `anthropic-version: 2026-10-21` and `x-api-key`, and sends tools as `input_schema`. The shape is the [Messages API](https://platform.claude.com/docs/en/api/messages). Tool results go back as a user turn of `tool_result` blocks. Create the key in the Anthropic console. **Test connection** uses `GET /v1/models` and does not send a range. Effort raises the thinking budget: Low stays at 1024 tokens, Medium 4096, High 8192, Extra high 16000.

### OpenCode

OpenCode the app is a client. It is not a model server LUXAI can call. Its local server does not currently publish a stable OpenAI-compatible gateway; that remains a [requested feature](https://github.com/anomalyco/opencode/issues/31724). Two supported ways to use it:

- **LUXAI calls a model OpenCode also uses.** In OpenCode, providers are configured in `opencode.jsonc` ([provider docs](https://opencode.ai/docs/providers/)). Point LUXAI at that same OpenAI-compatible or Anthropic base URL and key.
- **OpenCode Zen** hosts models at documented endpoints ([Zen](https://opencode.ai/docs/zen/)). Chat-completions models use an OpenAI-compatible base of `https://opencode.ai/zen/v1` (egress Cloud). Claude models on Zen speak the Anthropic messages API at `https://opencode.ai/zen`; set provider Anthropic and that base URL. Use the Zen credential as the API key.
- **OpenCode as the agent.** Add the official Ludus MCP and ludus-skills in OpenCode. That path does not go through LUXAI.

### Cursor

Provider **Cursor** uses a user API key from [Cursor Dashboard → API Keys](https://cursor.com/dashboard). The base URL is `https://api.cursor.com` and egress is Cloud. **Test connection** calls `GET /v1/models` ([Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)) and fills the model menu, including any extra parameters that model lists. Effort and context window are sent as those parameters when the model lists a matching one. Auto left on Default is sent as that model's default variant, which is Cost when the catalog says so. Grok and Composer are sent as their default variant, without the effort or context window from the fields above, unless you set a parameter on that model. Those models use the included pool. Balance and Intelligence can spend prepaid credit. Save after the test.

A Cursor key does not speak chat completions. Each LUXAI turn runs a local Cursor agent on this server, in an empty directory, with no tools. It does not call the Cloud Agents API, so Auto, Grok, and Composer draw from the included pool and do not need a prepaid balance. LUXAI still runs its own range tools. The prompt and tool results leave the lab, the same way a Claude or OpenAI cloud key does. Cursor's own [bring-your-own-key](https://cursor.com/help/models-and-usage/api-keys) setting is the other direction: that key is for Cursor, not for LUXAI.

To work on ranges from the Cursor app itself, add the Ludus MCP in `.cursor/mcp.json` and install ludus-skills. That uses the Ludus API key in the MCP config, not the LUX session.

### What test connection checks without a real key

The request builder and the response parser are covered by unit tests: URL shape, headers, tool schema, a 401 body, a same-host redirect, and a refusal to follow a login page or a different host. A live cloud call needs a real key and is not part of those tests. With a blank cloud key, **Test connection** returns before any request is sent.
