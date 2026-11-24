# Desktop packages: Windows, Ubuntu Linux, and macOS

Maintainers can distribute the unchanged FLUVI v1 application as a Windows x64 portable executable, Ubuntu x64 AppImage or Debian package, and macOS DMG or ZIP for Apple Silicon or Intel. Users do not install Node.js, Python, or a browser. Maintainers must complete acceptance checks on each target operating system before calling its release validated.

## What users receive

The following portable-executable instructions apply to Windows. See the Linux and macOS sections below for their formats, launch steps, and profile locations. All platforms retain the existing internet requirements and isolated desktop preferences.

- Run `FLUVI-1.0.0-windows-x64-portable.exe` from a writable local folder. You may use spaces or non-ASCII characters in the path. Keep personal maps outside the executable's temporary files.
- Allow time for extraction on first launch. “Single executable” describes the download: Electron-builder's portable launcher extracts runtime files under the user's temporary directory, and Chromium writes a profile under `%APPDATA%\FLUVI Desktop`.
- Choose a destination in the native **Save As** dialog for each export. You initially see your Windows Downloads folder; you may select another folder. Import maps and images with the existing application file pickers.
- Keep internet access available. You still request the web application's existing CDN resources, including PixiJS, JSZip, Pyodide and its scientific Python packages. You cannot assume offline rendering, ZIP export, or Python analysis will work, even if they worked on a previous run.
- Obtain releases from a trusted maintainer. You may encounter SmartScreen, antivirus, or organization-policy warnings for unsigned executables. Verify the source and the maintainer's published SHA-256; ask your administrator if policy blocks execution. Do not disable security protections.

You retain language, theme, and browser-stored scenarios across restarts in `%APPDATA%\FLUVI Desktop`. You do **not** carry those preferences to another computer by copying the EXE, and you do not automatically share them with your regular browser. Save map JSON explicitly if you want to exchange maps. To back up or reset the desktop profile, first close every FLUVI process, then copy or rename that profile directory.

You always use `http://127.0.0.1:47831` inside the desktop window. If another program occupies that port, you receive a startup error rather than a different origin with apparently missing preferences. Close that program and retry; do not change the port as a workaround. When you double-click another copy while FLUVI is running, you return to the existing window.

## Build the Windows x64 release

Use a **Windows x64 build host**, Node.js 24 LTS, pnpm 11, and an internet connection. Electron 45's upstream Windows baseline is Windows 10 or later; maintainers must record the actual Windows edition/build they test and must not imply support for untested versions. Build each platform on its own native host; Wine cross-builds and Windows/Linux ARM releases are outside this package's supported workflow.

From the repository root in PowerShell:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @fluvi/desktop test
pnpm --filter v1 exec vitest run tests/static-build.spec.mjs
pnpm --filter @fluvi/desktop package:win
Get-FileHash apps/desktop/dist/release/FLUVI-1.0.0-windows-x64-portable.exe -Algorithm SHA256
```

You may need organization-approved access to npm and GitHub release downloads for Electron and electron-builder's packaging tools. The package has no native application dependencies to compile; the pinned builder downloads its own packaging utilities. If your account cannot extract those tools, fix the build-host permissions with your administrator rather than disabling antivirus or requiring end users to run FLUVI as administrator.

You get the portable artifact under `apps/desktop/dist/release/`. Read the version from `apps/desktop/package.json` when naming releases. Distribute the portable `.exe`, its SHA-256 and release notes; do not distribute the intermediate `win-unpacked` folder as the single-file product.

You keep the repository's pnpm build policy: `electron` is explicitly allowed; the unused Squirrel/`electron-winstaller` install script is denied because this package uses the portable NSIS target. Electron 45 downloads its development binary on first CLI/import use. Do not broadly approve every dependency's build scripts.

## Build the Ubuntu Linux x64 release

Use an **Ubuntu x64 build host** with Node.js 24 LTS, pnpm 11, an internet connection, and standard Debian packaging tools (`dpkg` and `fakeroot`). If those tools are missing, ask the build-host administrator to install them. Ubuntu 24.04 LTS is the initial acceptance target; record the actual Ubuntu version tested rather than assuming every Linux distribution works.

```sh
pnpm install --frozen-lockfile
pnpm --filter @fluvi/desktop test
pnpm --filter @fluvi/desktop package:linux
sha256sum apps/desktop/dist/release/FLUVI-1.0.0-linux-x64.AppImage apps/desktop/dist/release/FLUVI-1.0.0-linux-x64.deb
```

Maintainers get an AppImage and a `.deb` under `apps/desktop/dist/release/`. Users can choose:

1. **AppImage:** download the single file, mark it executable (`chmod +x FLUVI-1.0.0-linux-x64.AppImage`), and run it from a writable local directory. AppImage mounting needs compatible FUSE libraries; Ubuntu 24.04 provides the FUSE 2 compatibility library as `libfuse2t64`. Ask an administrator to install the appropriate package if mounting fails. The AppImage is a single-file distribution, but still writes a browser profile and may extract runtime files.
2. **Debian package:** open the `.deb` with Ubuntu's software installer, or use `sudo apt install ./FLUVI-1.0.0-linux-x64.deb`. Installing the system package needs administrator approval; running FLUVI afterwards uses a standard account and the desktop launcher.

Users retain preferences under `$XDG_CONFIG_HOME/FLUVI Desktop`, or `~/.config/FLUVI Desktop` when `XDG_CONFIG_HOME` is unset. Exports use a native Save As dialog, initially in the user's Downloads directory. The loopback origin and internet requirements are the same as Windows.

Ubuntu's AppArmor/user-namespace policy may restrict Electron sandbox startup, especially for AppImages in arbitrary directories. Maintainers must test the real artifact under the target Ubuntu policy. If policy blocks startup, use an administrator-approved application policy or report the incompatibility; do not run as root, disable AppArmor, or add `--no-sandbox` to the release launcher.

## Build the macOS release

Use a **macOS build host** with native Node.js 24 LTS, pnpm 11, and an internet connection. Install Apple's command-line developer tools when required by the packaging toolchain. The command builds for the architecture reported by Node.js: `arm64` for Apple Silicon, `x64` for Intel. On Apple Silicon, avoid an Intel Node.js running under Rosetta unless intentionally producing an Intel artifact. Build on each native architecture to validate both; these packages are not universal binaries.

```sh
pnpm install --frozen-lockfile
pnpm --filter @fluvi/desktop test
pnpm --filter @fluvi/desktop package:mac
shasum -a 256 apps/desktop/dist/release/FLUVI-1.0.0-macos-*.dmg apps/desktop/dist/release/FLUVI-1.0.0-macos-*.zip
```

Maintainers get architecture-labelled DMG and ZIP files under `apps/desktop/dist/release/`. Users open the DMG and drag FLUVI into Applications (or a writable per-user Applications folder), then launch it. ZIP users extract `FLUVI.app` before opening it. Unlike the Windows portable EXE, the macOS download contains an application bundle rather than a single executable file.

Users retain preferences under `~/Library/Application Support/FLUVI Desktop`; exports use native Save As dialogs. FLUVI deliberately quits when its last window closes, including on macOS, and retains the same fixed loopback origin and CDN requirements.

The build uses electron-builder's normal signing discovery when maintainers supply a suitable Apple signing identity. This repository does not provision a Developer ID certificate, entitlements for a signing pipeline, notarization credentials, or notarization automation. An unsigned/ad-hoc local artifact is not a publicly trusted release: Gatekeeper may block a downloaded copy. For public distribution, maintainers must arrange and validate Developer ID signing and Apple notarization; do not remove quarantine attributes or disable Gatekeeper as a workaround. Record the actual macOS version, architecture, signing identity/status, and notarization result during release acceptance.

### Development and focused checks

```sh
pnpm --filter @fluvi/desktop dev
pnpm --filter @fluvi/desktop test
pnpm --filter @fluvi/desktop test:smoke
```

Close any running FLUVI instance before using the fixed-port tests or development smoke. You can develop the wrapper on a graphical Linux host. The opt-in smoke command isolates its profile with `XDG_CONFIG_HOME`, launches Electron twice, and checks visible pause/step controls, language persistence, renderer isolation, blocked popups/remote navigation, and server shutdown after closing the last window. Playwright launches this test process with its own automation/debugging flags (including `--no-sandbox`); maintainers must not copy those flags into the release launcher. The release wrapper still requests a sandboxed renderer. Native file dialogs, real exports, and Windows portable extraction remain manual artifact-acceptance checks.

For a **Linux unpacked packaging diagnostic**, you may stage and package an unpacked directory, then run the same smoke against it:

```sh
pnpm --filter @fluvi/desktop payload
pnpm --filter @fluvi/desktop exec electron-builder --linux --dir --x64
pnpm --filter @fluvi/desktop exec node tests/desktop-smoke.mjs /absolute/path/to/apps/desktop/dist/release/linux-unpacked/FLUVI
```

You must not interpret this unpacked diagnostic as validation of AppImage mounting, Debian installation, Windows packaging, or macOS bundles. You can run the server/content tests without a graphical session. Those tests use temporary payload directories and check HTTP responses, MIME types, fixed-origin conflicts, traversal/junction rejection, and packaging resource integrity.

## Maintenance boundary

You maintain the wrapper under `apps/desktop/`; you leave `apps/v1/` unchanged. The desktop payload command calls the existing production static builder, which preserves classic-script ordering and the HTML bytes. The builder's `afterPack` hook copies every staged file to `resources/payload` on Windows/Linux or `FLUVI.app/Contents/Resources/payload` on macOS using Node's copy operation, avoiding electron-builder's default exclusions, then checks every packaged file byte-for-byte. You package only the wrapper modules and metadata in ASAR; you do not need a repository checkout or Vite at runtime.

You can keep running existing web build/deploy commands without building a desktop artifact. The desktop package intentionally defines no `build` script, adds no v1 dependency on Electron, and exposes explicit `package:win`, `package:linux`, and `package:mac` commands.

You expose static GET/HEAD responses only, bound to IPv4 loopback. The wrapper checks the Host header, canonical paths and traversal segments and exposes no control/write API. You grant the renderer no Node integration, preload bridge, or permissions; you keep context isolation and sandboxing enabled. You deny popups and remote top-level navigation while retaining CDN subresource fetches and ordinary file dialogs/downloads. Anyone with access to the local machine may read the public bundled static files; this server is not an authentication boundary.

## Windows artifact acceptance — release gate

Use the **actual portable EXE**, copied alone to a clean standard-user Windows x64 environment with no separately installed Node.js or Python. Keep internet access enabled for the normal application/CDN workflows. Record the Windows build, artifact SHA-256, test date, tester, and results. A development launch or the Linux diagnostic cannot satisfy this gate.

### Launch, files and simulator

1. Put the EXE under a path such as `%USERPROFILE%\Downloads\FLUVI prueba ñ\`. Double-click it. Confirm you see the built-in map and no terminal, installer, elevation request, or missing-file error. Record security prompts separately.
2. Start, pause and single-step the simulation. Edit a street, a directed street connection, and a building. Save map JSON with the application's save control or Ctrl+S, choose a path, and reopen that file. Confirm the changes survived.
3. Import a local reference image and an image building. Save/reopen the map and check the artwork. Exchange the map JSON with the web version and verify both directions of compatibility.
4. Export a map screenshot, metrics CSV/JSON, and the complete metrics ZIP. Choose destinations in the native dialogs, inspect the files, unzip the archive, and check representative images. Cancel a save dialog and confirm you can still use FLUVI.
5. With network access, open the Python analyzer, load a metrics file and run the analysis. Inspect the resulting charts/downloads. Disconnect the network on a fresh profile and record the expected CDN-dependent limitations without promising offline support.

### Persistence, isolation and shutdown

1. Choose English, change theme and save a browser-stored scenario. Close the last window, wait for all FLUVI processes to exit, then relaunch the same EXE. Verify all three preferences/scenarios survived. Repeat in Spanish.
2. Double-click the EXE while it is running. Confirm you return to one existing window, without a second server or an apparent profile reset. Try an external link/popup and verify FLUVI does not become a remote-page host.
3. Close the last window. Check Task Manager for leftover FLUVI runtime processes and run `Get-NetTCPConnection -LocalPort 47831 -State Listen -ErrorAction SilentlyContinue`. Confirm no FLUVI listener remains. Repeat after cancelling an export.
4. With FLUVI closed, occupy `127.0.0.1:47831` using the PowerShell procedure below. Launch the EXE: confirm you see an actionable port error, no blank window, and clean process exit after dismissing it. Stop the temporary listener and confirm FLUVI launches normally again.
5. Record extraction/profile locations and the selected download paths. Confirm you can launch from a folder where your account can read the EXE without relying on write access beside it. Do not certify Windows acceptance until every required check above has a recorded result.

In a separate PowerShell window, occupy the port without installing a runtime:

```powershell
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 47831)
$listener.Start()
try { Read-Host "Run the FLUVI port-conflict check, then press Enter" }
finally { $listener.Stop() }
```

Maintainers should also run `pnpm --filter v1 test:full` before shipping and retain its results. Follow the repository quarantine guidance for excluded browser/Python checks; report unavailable or failing checks as limitations, never as passes.

## Ubuntu and macOS artifact acceptance — release gate

Maintainers must repeat the Windows checklist's simulation, JSON exchange, image upload, exports, online Python analysis, preference/scenario persistence, single-instance, port-conflict, and shutdown workflows using the actual platform package on a standard-user account without separately installed Node.js or Python. On macOS, use Cmd+S for map saving. Record artifact hashes, OS versions, architectures, test date, tester, security prompts, and outcomes.

- **Ubuntu:** test both executable AppImage launch and `.deb` installation/desktop launch on stock Ubuntu, including its normal AppArmor policy. Test a path containing spaces/non-ASCII characters, native dialogs, icon/menu integration for the installed package, and no residual listener after exit (`ss -ltn 'sport = :47831'`). Record FUSE dependencies and check package removal without silently deleting the user's profile.
- **macOS:** test each published architecture on matching hardware. Mount/eject the DMG, launch the copied app and ZIP-extracted app, test paths containing spaces/non-ASCII characters, native dialogs, and no residual listener after exit (`lsof -nP -iTCP:47831 -sTCP:LISTEN`). Test a genuinely downloaded artifact's Gatekeeper behavior and verify signing/notarization before calling a public release ready.

For a port-conflict check on Ubuntu/macOS with a system `python3` available, run `python3 -m http.server 47831 --bind 127.0.0.1` in a separate terminal, launch FLUVI and inspect the error, then stop the temporary server with Ctrl+C. The test helper is optional; Python is not a FLUVI runtime dependency.

Packaging success alone is not a passed acceptance checklist. In particular, a Linux Mint/Ubuntu-derived build host is not a substitute for stock Ubuntu runtime validation, and this Linux development environment cannot establish macOS launch, signing, or native dialog behavior.

## Reference documentation

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron application paths and lifecycle](https://www.electronjs.org/docs/latest/api/app)
- [Electron download items and save dialogs](https://www.electronjs.org/docs/latest/api/download-item)
- [electron-builder portable target](https://www.electron.build/app-builder-lib.interface.portableoptions)
