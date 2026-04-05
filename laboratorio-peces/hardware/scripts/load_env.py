from pathlib import Path
import os

Import("env")


def parse_env_file(env_path: Path):
    values = {}

    if not env_path.exists():
        return values

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


project_dir = Path(env["PROJECT_DIR"])
web_env_path = project_dir.parent / "web" / ".env"

raw_values = parse_env_file(web_env_path)

for env_key in ("VITE_MQTT_USER", "VITE_MQTT_PASSWORD", "VITE_SUPABASE_ANON_KEY"):
    if os.getenv(env_key):
        raw_values[env_key] = os.getenv(env_key)

define_map = {
    "VITE_MQTT_USER": "MQTT_USER",
    "VITE_MQTT_PASSWORD": "MQTT_PASSWORD",
    "VITE_SUPABASE_ANON_KEY": "SUPABASE_ANON_KEY",
}

cpp_defines = []

for env_key, define_name in define_map.items():
    value = raw_values.get(env_key, "")

    if not value:
        print(f"[load_env] Warning: {env_key} not found in {web_env_path}")
        continue

    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    cpp_defines.append((define_name, f'\\"{escaped}\\"'))

if cpp_defines:
    env.Append(CPPDEFINES=cpp_defines)
    print(f"[load_env] Injected {len(cpp_defines)} secure defines from {web_env_path}")
