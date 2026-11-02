/** Embedded Python: render GOAD Ludus provider config.yml (lab + extensions) without writing workspace. */
export const GOAD_PREVIEW_CONFIG_PY = `
import json, os, re, sys, base64

def _b(i):
    return base64.b64decode(sys.argv[i]).decode("utf-8")

goad_path = _b(1)
lab_name = _b(2)
extensions_json = _b(3)
provider_name = _b(4) if len(sys.argv) > 4 else "ludus"

out = {"ok": False, "yaml": "", "error": ""}

# ip_range / range_id are supplied by the caller. When the real range values are
# unknown (pure preview), the caller passes the "192.168.56" GOAD default and the
# literal "{{ range_id }}" placeholder so Ludus resolves it later at deploy.

try:
    extensions = json.loads(extensions_json)
    if not isinstance(extensions, list):
        raise ValueError("extensions must be a JSON array")
    extensions = [str(x) for x in extensions]
except Exception as e:
    out["error"] = "extensions parse: " + str(e)
    print(json.dumps(out))
    sys.exit(0)

# Templates must stay inside the GOAD checkout. Names are a single path segment
# and the resolved directory must remain under goad_path. Rendering uses the
# Jinja sandbox so a template cannot reach Python internals.
try:
    from jinja2 import FileSystemLoader
    from jinja2.sandbox import SandboxedEnvironment
except ImportError:
    out["error"] = "Jinja2 sandbox not installed on GOAD host"
    print(json.dumps(out))
    sys.exit(0)

ip_range = _b(5) if len(sys.argv) > 5 and sys.argv[5] else "192.168.56"
range_id = _b(6) if len(sys.argv) > 6 and sys.argv[6] else "{{ range_id }}"

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

def safe_under_goad(*parts):
    if not all(isinstance(part, str) and NAME_RE.match(part) for part in parts):
        raise ValueError("invalid path segment")
    root_real = os.path.realpath(goad_path)
    joined = os.path.realpath(os.path.join(root_real, *parts))
    if joined != root_real and not joined.startswith(root_real + os.sep):
        raise ValueError("path escapes GOAD root")
    return joined

def primary_vlan(config_text):
    vlans = re.findall(r'(?m)^\\s*vlan:\\s*(\\d+)\\s*$', config_text or '')
    if not vlans:
        return "10"
    counts = {}
    for vlan in vlans:
        counts[vlan] = counts.get(vlan, 0) + 1
    return sorted(counts, key=lambda vlan: (-counts[vlan], int(vlan)))[0]

def lab_provider_path(lab, provider):
    return safe_under_goad("ad", lab, "providers", provider)

def ext_provider_path(ext, provider):
    return safe_under_goad("extensions", ext, "providers", provider)

def template_provider_path(provider):
    return safe_under_goad("template", "provider", provider)

try:
    lab_path = lab_provider_path(lab_name, provider_name)
    if not os.path.isdir(lab_path):
        out["error"] = "Lab " + lab_name + " has no " + provider_name + " provider directory"
        print(json.dumps(out))
        sys.exit(0)

    lab_env = SandboxedEnvironment(loader=FileSystemLoader(lab_path))
    lab_content = lab_env.get_template("config.yml").render(
        lab_name=lab_name, range_id=range_id, ip_range=ip_range
    )

    ext_content = ""
    for extension in extensions:
        ext_path = ext_provider_path(extension, provider_name)
        if not os.path.isdir(ext_path):
            out["error"] = "Extension " + extension + " has no " + provider_name + " provider directory"
            print(json.dumps(out))
            sys.exit(0)
        ext_env = SandboxedEnvironment(loader=FileSystemLoader(ext_path))
        ext_content += ext_env.get_template("config.yml").render(
            lab_name=lab_name,
            range_id=range_id,
            ip_range=ip_range,
            target_vlan=primary_vlan(lab_content),
        ) + "\\n"

    tpl_path = template_provider_path(provider_name)
    if not os.path.isdir(tpl_path):
        out["error"] = "Missing template/provider/" + provider_name
        print(json.dumps(out))
        sys.exit(0)

    wrap_env = SandboxedEnvironment(loader=FileSystemLoader(tpl_path))
    yaml_text = wrap_env.get_template("config.yml").render(
        lab_name=lab_name,
        lab=lab_content,
        extensions=ext_content,
        provider_name=provider_name,
    )

    out["ok"] = True
    out["yaml"] = yaml_text
except Exception as e:
    out["error"] = str(e)

print(json.dumps(out))
`
