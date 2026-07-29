# gmsaas command reference

`gmsaas` is the Genymotion Cloud SaaS CLI (verified against v1.16.0). Add
`--format json` (or `compactjson`) to any command for machine-readable output;
the helper scripts use this with `scripts/pick_uuid.py` to extract UUIDs.

## Auth & config

| Command | Purpose |
| --- | --- |
| `gmsaas auth token <TOKEN>` | Set the API token (or set `GENYMOTION_API_TOKEN` in the env — user's step). |
| `gmsaas auth reset` | Clear the cached token. |
| `gmsaas config set android-sdk-path <PATH>` | Tell gmsaas where `platform-tools/adb` lives. |
| `gmsaas config list` | Show current config. |
| `gmsaas doctor` | Verify auth + SDK are configured. |

## Recipes (device templates)

| Command | Purpose |
| --- | --- |
| `gmsaas recipes list` | List available recipes (device model + Android version). |
| `gmsaas recipes list --name "Pixel 7"` | Filter by name substring. |
| `gmsaas recipes list --source official` | Restrict to official recipes. |
| `gmsaas recipes get <RECIPE_UUID>` | Details for one recipe. |

## Instance lifecycle

| Command | Purpose |
| --- | --- |
| `gmsaas instances start <RECIPE_UUID> <NAME>` | Start a device; waits until booted. Returns the instance UUID. |
| `gmsaas instances start <RECIPE_UUID> <NAME> --max-run-duration <MIN>` | Auto-stop after N minutes (cost safety; 0 = no timeout). |
| `gmsaas instances start ... --no-wait` | Return immediately without waiting for boot. |
| `gmsaas instances adbconnect [<INSTANCE_UUID>]` | Bridge the instance to local adb. UUID optional if only one is running. `--adb-serial-port <PORT>` to pin the port. |
| `gmsaas instances list` | List running instances. |
| `gmsaas instances get <INSTANCE_UUID>` | Details (state, adb serial). |
| `gmsaas instances adbdisconnect <INSTANCE_UUID>` | Disconnect from adb. |
| `gmsaas instances stop <INSTANCE_UUID>` | Stop (and bill-stop) the instance. |

## Full sequence (manual, any OS)

```
# 1. find a recipe
gmsaas --format json recipes list --name "Pixel 7"      # copy a recipe uuid

# 2. start it (auto-stop after 60 min)
gmsaas --format json instances start --max-run-duration 60 <RECIPE_UUID> claude-test
#    -> copy the instance uuid from the output

# 3. connect to adb, then drive with normal adb commands
gmsaas instances adbconnect <INSTANCE_UUID>
adb devices                                              # confirm the serial

# ... install / tap / screenshot / logcat (see adb-recipes.md) ...

# 4. ALWAYS stop when done (billing ends on stop)
gmsaas instances adbdisconnect <INSTANCE_UUID>
gmsaas instances stop <INSTANCE_UUID>
```

The `scripts/start-device.sh` and `scripts/stop-device.sh` helpers wrap steps
1–3 and 4 respectively, extracting UUIDs for you.

## Notes

- `instances start` blocks until the device is fully booted (unless `--no-wait`),
  so the returned instance is ready for `adbconnect` immediately.
- Billing runs while an instance is up. Use `--max-run-duration` as a backstop and
  always `stop` when finished. `gmsaas instances list` shows what is still running.
- JSON key names can vary slightly by version; `scripts/pick_uuid.py` searches the
  structure rather than assuming exact keys.
