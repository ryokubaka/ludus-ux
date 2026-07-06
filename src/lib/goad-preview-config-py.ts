/** Embedded Python: render GOAD Ludus provider config.yml (lab + extensions) without writing workspace. */
export const GOAD_PREVIEW_CONFIG_PY = `
import json, os, sys, base64

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

# Trust boundary: templates are read only from the local, trusted GOAD repo
# checkout under goad_path (ad/<lab> and extensions/<ext>). They are not
# user-supplied, so a plain (non-sandboxed) Jinja2 Environment is acceptable
# here. If custom/user-provided GOAD sources are ever introduced, switch to
# jinja2.sandbox.SandboxedEnvironment before rendering.
try:
    from jinja2 import Environment, FileSystemLoader
except ImportError:
    out["error"] = "Jinja2 not installed on GOAD host"
    print(json.dumps(out))
    sys.exit(0)

ip_range = _b(5) if len(sys.argv) > 5 and sys.argv[5] else "192.168.56"
range_id = _b(6) if len(sys.argv) > 6 and sys.argv[6] else "{{ range_id }}"

def lab_provider_path(lab, provider):
    return os.path.join(goad_path, "ad", lab, "providers", provider)

def ext_provider_path(ext, provider):
    return os.path.join(goad_path, "extensions", ext, "providers", provider)

def template_provider_path(provider):
    return os.path.join(goad_path, "template", "provider", provider)

try:
    lab_path = lab_provider_path(lab_name, provider_name)
    if not os.path.isdir(lab_path):
        out["error"] = "Lab " + lab_name + " has no " + provider_name + " provider directory"
        print(json.dumps(out))
        sys.exit(0)

    lab_env = Environment(loader=FileSystemLoader(lab_path))
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
        ext_env = Environment(loader=FileSystemLoader(ext_path))
        ext_content += ext_env.get_template("config.yml").render(
            lab_name=lab_name, range_id=range_id, ip_range=ip_range
        ) + "\\n"

    tpl_path = template_provider_path(provider_name)
    if not os.path.isdir(tpl_path):
        out["error"] = "Missing template/provider/" + provider_name
        print(json.dumps(out))
        sys.exit(0)

    wrap_env = Environment(loader=FileSystemLoader(tpl_path))
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
