# Setup (one-time per machine)

Prerequisites: Python 3 + pip (for `gmsaas`), and outbound HTTPS to `*.geny.io`.
The fast path is `bash scripts/bootstrap.sh`; the manual steps and Windows
equivalents are below.

## 1. Authentication — the user's step (keep the token private)

The Genymotion API token is a secret. Claude must never ask for it in chat or run
`gmsaas auth token <value>` on the user's behalf. The user does this themselves:

1. Sign in at https://cloud.geny.io and create an API token at
   https://cloud.geny.io/api.
2. Make it available to gmsaas in one of two ways:
   - Environment variable (recommended):
     - bash/zsh: `export GENYMOTION_API_TOKEN=<token>` (add to `~/.bashrc`/`~/.zshrc`)
     - PowerShell: `$env:GENYMOTION_API_TOKEN="<token>"` (persist with `setx GENYMOTION_API_TOKEN "<token>"`)
     - cmd: `setx GENYMOTION_API_TOKEN "<token>"`
   - Or run once: `gmsaas auth token <token>` (caches it locally).

Never place the token in a URL, a committed file, or the chat transcript.

## 2. Install adb + gmsaas

- Debian/Ubuntu/most cloud Linux:
  ```
  sudo apt-get install -y android-tools-adb
  pip3 install gmsaas --break-system-packages
  ```
- macOS (Homebrew):
  ```
  brew install android-platform-tools
  pip3 install gmsaas
  ```
- Windows:
  - Install Android platform-tools (via Android Studio's SDK, or `choco install adb` / `scoop install adb`) so `adb.exe` is on PATH.
  - `pip install gmsaas`

Confirm: `adb version` and `gmsaas --version` both print.

## 3. Point gmsaas at adb (android-sdk-path)

gmsaas needs to know where adb is so it can bridge a cloud instance to your local
adb server. It expects a folder containing `platform-tools/adb`.

- If you already have an Android SDK, use it:
  `gmsaas config set android-sdk-path "$ANDROID_HOME"`
  (Windows: `gmsaas config set android-sdk-path "%LOCALAPPDATA%\Android\Sdk"`)
- If you do NOT have a full SDK (e.g. you installed only `adb` via apt/brew), make
  a minimal layout that points at the adb you have:
  ```
  mkdir -p "$HOME/.android-cloud-sdk/platform-tools"
  ln -sf "$(command -v adb)" "$HOME/.android-cloud-sdk/platform-tools/adb"
  gmsaas config set android-sdk-path "$HOME/.android-cloud-sdk"
  ```
  `bootstrap.sh` does exactly this automatically.

## 4. Verify

```
gmsaas doctor
```

A healthy result reports no issues. If it says:
- **Authentication failed** → the token isn't set. This is the user's step (see 1).
- **Android SDK not configured** → redo step 3 (or re-run `bootstrap.sh`).

`bash scripts/status.sh` shows doctor + running instances + `adb devices` together.

## Troubleshooting

- **Behind a proxy**: `gmsaas config set proxy <url>` (supports auth via the URL or
  `GMSAAS_PROXY_USERNAME`/`GMSAAS_PROXY_PASSWORD`).
- **Can't reach the API**: confirm outbound 443 to `api.geny.io`. Corporate
  networks may need the proxy setting above.
- **`gmsaas` not found after pip install**: your pip bin dir (often `~/.local/bin`)
  isn't on PATH — add it, or reinstall without `--user`.
- **adbconnect shows nothing**: give it a few seconds, then `adb devices`. Ensure
  `android-sdk-path` is set (step 3) so gmsaas can drive adb.
