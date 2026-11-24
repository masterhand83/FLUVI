import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildStaticSite } from "../../v1/scripts/build-static.mjs"

export const payloadDirectory = fileURLToPath(new URL("../dist/payload/", import.meta.url))

export async function stagePayload(output = payloadDirectory) {
	// Use the exact production builder, not Vite or a rewritten desktop HTML.
	await buildStaticSite(output)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await stagePayload()
	console.log(`Desktop payload staged at ${payloadDirectory}`)
}
