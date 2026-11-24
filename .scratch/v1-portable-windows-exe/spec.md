# Package FLUVI v1 as a portable Windows executable

Status: resolved

## Problem Statement

The user wants to distribute FLUVI v1 as one Windows `.exe` that opens the application when double-clicked. They want to keep the existing application's code unchanged rather than maintain a desktop-specific version of the simulator.

Today, users run the web application through a browser and a static server. The maintainer can already produce a static build that preserves the HTML, classic-script load order, localization catalogs, Python analyzer, and simulation assets.

## Solution

Give users one portable Windows executable that opens the existing FLUVI application in a desktop window without an installer, terminal, or separately installed Node.js or Python runtime.

Maintainers will build a separate Electron wrapper around the existing static build and package it with electron-builder's portable Windows target. Users will run the bundled web application through an internal loopback-only static server.

For this first version, users may need internet access for the same CDN resources the web application currently requests. Full offline operation is not part of this spec. This is a working assumption, not a requirement the user has confirmed.

## User Stories

### Launch and distribution

1. As a Windows user, I want to receive one executable, so that I can launch FLUVI without managing a folder of application files.
2. As a Windows user, I want to double-click the executable, so that I can open FLUVI without a terminal.
3. As a Windows user, I want to run FLUVI without an installer or administrator privileges, so that I can use it under a standard account.
4. As a Windows user, I want the executable to include its browser runtime, so that I do not need to install Node.js, Python, or a separate browser.
5. As a Windows user, I want to run the executable from a directory containing spaces or non-ASCII characters, so that I can keep it in my normal downloads or project folder.

### Existing application behavior

6. As a simulator user, I want the existing map and simulation controls to open in the desktop window, so that I can use the application I already know.
7. As a map author, I want to edit streets, street connections, and buildings, so that the desktop package supports my existing workflow.
8. As a map author, I want to save and reopen map JSON, so that I can continue work and exchange maps with browser users.
9. As a map author, I want to upload image buildings and local reference images, so that I can reuse my existing map artwork.
10. As an analyst, I want to export metrics, screenshots, and ZIP archives, so that I can keep the files produced by the simulator.

### Preferences and connectivity

11. As an analyst with internet access, I want to use the existing Python analyzer, so that I can analyze metrics without installing Python.
12. As a bilingual user, I want to keep the existing Spanish and English interface, so that the desktop package follows my language preference.
13. As a returning user, I want my language, theme, and browser-stored scenarios to survive a restart, so that reopening FLUVI does not erase my preferences or saved scenarios.
14. As a Windows user, I want to understand which features require internet access, so that I do not mistake the portable executable for a fully offline package.
15. As a Windows user, I want a clear startup error if the internal server cannot start, so that I do not wait on an empty window.

### Maintenance and lifecycle

16. As a Windows user, I want closing the application window to stop its server and runtime, so that FLUVI does not leave background processes running.
17. As a maintainer, I want to package the existing static build unchanged, so that desktop distribution does not introduce a fork of the application.
18. As a maintainer, I want a documented package-specific build command, so that I can reproduce the Windows artifact.
19. As a maintainer, I want desktop packaging to remain separate from web deployment, so that existing development, tests, and Cloudflare publishing keep working.
20. As a maintainer, I want evidence from the actual Windows executable, so that a successful development launch does not hide packaging failures.

## Implementation Decisions

### Packaging boundary

- Maintainers will add a separate desktop workspace package and consume the v1 static build as its application payload. They will leave the existing v1 HTML, JavaScript, CSS, Python, translations, and assets unchanged.
- Maintainers will use Electron for the desktop runtime and electron-builder's Windows `portable` target for the distributable. They will produce a Windows x64 artifact for the initial release.
- Maintainers will keep wrapper code and packaging configuration outside the application source. Workspace dependency metadata and build orchestration may change where required; the desktop package must work with the repository's pnpm dependency-build approval policy.
- Maintainers will provide distinct commands for wrapper development, focused tests, and portable Windows packaging. They will document the supported build host and toolchain rather than imply that Windows packaging works on every host.
- Maintainers will preserve the current web build and deployment behavior. Desktop packaging must not become a prerequisite for web development or Cloudflare deployment.

### Serving and browser compatibility

- Maintainers will serve the bundled static payload over HTTP on the loopback interface only, wait until the server is ready, and then open its entry point in the desktop window. Users will not launch a separate server.
- Maintainers will preserve resource paths, MIME types, classic-script evaluation order, and relative fetch behavior. They will package production static output rather than depend on Vite or the repository checkout at runtime.
- Maintainers will restrict static serving to the bundled payload, reject traversal requests, and expose no filesystem-write or application-control HTTP endpoints.
- Maintainers will give the desktop application a persistent browser profile and stable local origin across launches so that localStorage-backed preferences and scenarios remain available. They will handle port conflicts explicitly rather than silently switch origins and appear to lose data.
- Maintainers will retain the existing CDN URLs and loading behavior. They will not promise that every simulator feature works without network access.

### Desktop safety and user files

- Maintainers will disable Node.js integration in the application page, enable context isolation and renderer sandboxing, and avoid introducing a privileged renderer bridge for this feature.
- Maintainers will keep navigation within the bundled application, deny unexpected new windows, and avoid granting remote pages desktop privileges.
- Maintainers will preserve browser-style file selection and downloads through Electron host behavior where necessary. Users must be able to choose or locate exported files without changes to the web application's export code.
- Maintainers will store browser profile data in an appropriate writable per-user location rather than alongside the executable or inside its temporary extraction directory.
- Maintainers will close the loopback server and exit the runtime when the last application window closes. If startup fails, users will receive an actionable error and the process will exit cleanly.

### Distribution contract

- Maintainers will document that “single executable” describes the distributed artifact. Users should expect runtime extraction and per-user preference files; this feature does not promise execution without disk writes.
- Maintainers will document that unsigned builds may trigger Windows security warnings. They will not instruct users to disable security protections or claim that portable packaging avoids SmartScreen checks.
- Maintainers will describe internet requirements, the supported Windows architecture, build prerequisites, and the locations of user data and downloaded files.

## Testing Decisions

### Main seam: the packaged desktop application

- Test authors will exercise the application through desktop launch, visible controls, file dialogs or downloads, and process exit. They will assert user-observable results rather than Electron class structure, private helpers, or internal simulator globals.
- Test authors will use the real packaged Windows executable for release acceptance. A wrapper development launch or Linux-only check cannot establish that the portable artifact works on Windows.
- Test authors will cover launch on a standard-user Windows environment without separately installed Node.js or Python; they will also launch from a path containing spaces and non-ASCII characters.
- Test authors will verify that users can start, pause, and step the simulation; edit a map; save and reopen map JSON; upload a local image; and produce representative image, metrics, and ZIP downloads. With network access, they will verify the Python analysis workflow.
- Test authors will verify preference and saved-scenario persistence across a full process restart, clean shutdown without a lingering server, and clear handling of startup or port-binding failure.

### Supporting checks and prior art

- Test authors will reuse the existing static-build tests as the packaging-content precedent: preserve the HTML byte-for-byte and include every local runtime resource. They will extend that check at the desktop package boundary without changing application sources.
- Test authors will borrow user flows from the existing v1 browser smoke checks and focused save/load, image, localization, and export specs. They will keep desktop acceptance coverage focused on wrapper compatibility instead of duplicating the entire simulator suite.
- Test authors may add narrow black-box HTTP checks against the internal server boundary for traversal rejection and content types, where desktop UI tests cannot verify those properties reliably. They will avoid adding test hooks to the simulator.
- Maintainers will run focused desktop checks and affected static-build checks during implementation. Before shipping, they will run the existing full browser-sensitive v1 suite and the Windows artifact acceptance checks, documenting any unavailable environment rather than reporting unrun checks as passed.

## Out of Scope

- Full offline operation, vendoring CDN dependencies, or rewriting resource URLs in a packaged copy.
- Changes to simulation rules, street connection behavior, renderers, map schemas, Python analysis logic, localization, or the web interface.
- macOS, Linux, and Windows ARM distributions.
- Installers, automatic updates, file associations, native menus, and new desktop-only simulator features.
- Code-signing procurement, security-warning suppression, guaranteed artifact size, and a claim that the portable executable never extracts files or stores user data.

## Further Notes

The user explicitly requested feasibility without changing current application code. They have not confirmed Electron, internet access, or a target Windows version; the wrapper approach and network-dependent first release are defaults synthesized from the conversation.

The maintainer should confirm that packaged-app acceptance tests match the user's expectations before implementation. This spec records that proposed seam without blocking publication on an interview.

Maintainers should record the Windows version used for acceptance and avoid claiming support for untested versions. They should distinguish normal Windows security prompts from requirements imposed by FLUVI itself.

## Comments

- Spec published from the packaging discussion; implementation has not started.
- Implementation merged into `integration/v1-portable-windows-exe` at `f337632`. The implementation ticket records test evidence and limitations.
- Standards and spec reviews both completed with zero actionable findings. Reviewers independently reran the five focused desktop tests successfully.
- Windows portable artifact build and runtime acceptance remain an outstanding release gate; resolution records completed implementation, not Windows release approval.
