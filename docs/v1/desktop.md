# Portable Windows desktop package

Maintainers can distribute FLUVI v1 as one Windows x64 executable. Users double-click it under a standard account; they do not install Node.js, Python, or a browser. Maintainers must complete the Windows acceptance checklist below before calling a release validated.

## What users receive

- Run `FLUVI-1.0.0-windows-x64-portable.exe` from a writable local folder. You may use spaces or non-ASCII characters in the path. Keep personal maps outside the executable's temporary files.
- Allow time for extraction on first launch. “Single executable” describes the download: Electron-builder's portable launcher extracts runtime files under the user's temporary directory, and Chromium writes a profile under `%APPDATA%\FLUVI Desktop`.
- Choose a destination in the native **Save As** dialog for each export. You initially see your Windows Downloads folder; you may select another folder. Import maps and images with the existing application file pickers.
- Keep internet access available. You still request the web application's existing CDN resources, including PixiJS, JSZip, Pyodide and its scientific Python packages. You cannot assume offline rendering, ZIP export, or Python analysis will work, even if they worked on a previous run.
- Obtain releases from a trusted maintainer. You may encounter SmartScreen, antivirus, or organization-policy warnings for unsigned executables. Verify the source and the maintainer's published SHA-256; ask your administrator if policy blocks execution. Do not disable security protections.

You retain language, theme, and browser-stored scenarios across restarts in `%APPDATA%\FLUVI Desktop`. You do **not** carry those preferences to another computer by copying the EXE, and you do not automatically share them with your regular browser. Save map JSON explicitly if you want to exchange maps. To back up or reset the desktop profile, first close every FLUVI process, then copy or rename that profile directory.

You always use `http://127.0.0.1:47831` inside the desktop window. If another program occupies that port, you receive a startup error rather than a different origin with apparently missing preferences. Close that program and retry; do not change the port as a workaround. When you double-click another copy while FLUVI is running, you return to the existing window.

## Build the Windows x64 release

Use a **Windows x64 build host**, Node.js 24 LTS, pnpm 11, and an internet connection. Electron 45's upstream Windows baseline is Windows 10 or later; maintainers must record the actual Windows edition/build they test and must not imply support for untested versions. Linux and macOS release builds, Wine cross-builds, ARM releases, and installers are outside this package's supported build workflow.

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

### Development and focused checks

```sh
pnpm --filter @fluvi/desktop dev
pnpm --filter @fluvi/desktop test
pnpm --filter @fluvi/desktop test:smoke
```

Close any running FLUVI instance before using the fixed-port tests or development smoke. You can develop the wrapper on a graphical Linux host. The opt-in smoke command isolates its profile with `XDG_CONFIG_HOME`, launches Electron twice, and checks visible pause/step controls, language persistence, renderer isolation, blocked popups/remote navigation, and server shutdown after closing the last window. Playwright launches this test process with its own automation/debugging flags (including `--no-sandbox`); maintainers must not copy those flags into the release launcher. The release wrapper still requests a sandboxed renderer. Native file dialogs, real exports, and Windows portable extraction remain manual artifact-acceptance checks.

For a **Linux-only packaging diagnostic**, you may stage and package an unpacked directory, then run the same smoke against it:

```sh
pnpm --filter @fluvi/desktop payload
pnpm --filter @fluvi/desktop exec electron-builder --linux --dir --x64
pnpm --filter @fluvi/desktop exec node tests/desktop-smoke.mjs /absolute/path/to/apps/desktop/dist/release/linux-unpacked/FLUVI
```

You must not interpret this diagnostic as a Linux distribution commitment or Windows validation. You can run the server/content tests without a graphical session. Those tests use temporary payload directories and check HTTP responses, MIME types, fixed-origin conflicts, traversal/junction rejection, and packaging resource integrity.

## Maintenance boundary

You maintain the wrapper under `apps/desktop/`; you leave `apps/v1/` unchanged. The desktop payload command calls the existing production static builder, which preserves classic-script ordering and the HTML bytes. The builder's `afterPack` hook copies every staged file to `resources/payload` using Node's copy operation, avoiding electron-builder's default exclusions, then checks every packaged file byte-for-byte. You package only the wrapper modules and metadata in ASAR; you do not need a repository checkout or Vite at runtime.

You can keep running existing web build/deploy commands without building a desktop artifact. The desktop package intentionally defines no `build` script, adds no v1 dependency on Electron, and exposes only an explicit `package:win` command.

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

## Reference documentation

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron application paths and lifecycle](https://www.electronjs.org/docs/latest/api/app)
- [Electron download items and save dialogs](https://www.electronjs.org/docs/latest/api/download-item)
- [electron-builder portable target](https://www.electron.build/app-builder-lib.interface.portableoptions)
