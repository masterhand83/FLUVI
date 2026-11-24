import { app, BrowserWindow, dialog } from "electron"
import { join, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { startStaticServer, DESKTOP_PORT } from "./server.mjs"

// Never put preferences inside the portable executable's extraction directory.
app.setPath("userData", join(app.getPath("appData"), "FLUVI Desktop"))
const hasLock = app.requestSingleInstanceLock()
let window
let server
let stopping = false

if (!hasLock) {
	app.quit()
} else {
	app.on("second-instance", () => {
		if (!window) return
		if (window.isMinimized()) window.restore()
		window.show()
		window.focus()
	})

	app.on("window-all-closed", () => app.quit())
	app.on("before-quit", (event) => {
		if (!server || stopping) return
		event.preventDefault()
		stopping = true
		server.close().catch((error) => console.error("FLUVI server shutdown:", error)).finally(() => {
			server = undefined
			// Normal quit lets Chromium flush localStorage and the profile to disk.
			app.quit()
		})
	})

	app.whenReady().then(async () => {
		try {
			const root = app.isPackaged
				? join(process.resourcesPath, "payload")
				: fileURLToPath(new URL("./dist/payload/", import.meta.url))
			server = await startStaticServer({ root })
			window = new BrowserWindow({
				title: "FLUVI",
				width: 1440,
				height: 960,
				show: false,
				autoHideMenuBar: true,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
					webSecurity: true,
				},
			})
			window.removeMenu()
			const contents = window.webContents
			const stayLocal = (event, url) => {
				if (new URL(url).origin !== server.origin) event.preventDefault()
			}
			contents.on("will-navigate", stayLocal)
			contents.on("will-redirect", stayLocal)
			contents.setWindowOpenHandler(() => ({ action: "deny" }))
			contents.on("will-attach-webview", (event) => event.preventDefault())
			contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
			contents.session.setPermissionCheckHandler(() => false)
			contents.session.on("will-download", (_event, item) => {
				// Keep browser downloads (including Blob URLs), with a native Save As dialog.
				item.setSaveDialogOptions({
					title: "Save FLUVI export",
					defaultPath: join(app.getPath("downloads"), basename(item.getFilename())),
				})
			})
			await window.loadURL(`${server.origin}/`)
			window.show()
		} catch (error) {
			dialog.showErrorBox("FLUVI could not start",
				`FLUVI could not open its bundled application.\n\n${error.message}\n\n` +
				`If port ${DESKTOP_PORT} is in use, close the other FLUVI instance or the program using it and retry. ` +
				"The port is kept fixed to preserve your saved preferences. " +
				"Do not disable Windows security protections. If files are missing, obtain a fresh executable from your maintainer.")
			// Startup failed before the page became usable. Release any bound port.
			try {
				if (server) await server.close()
			} finally {
				app.exit(1)
			}
		}
	})
}
