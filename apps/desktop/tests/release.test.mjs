import assert from "node:assert/strict"
import test from "node:test"
import { releaseArguments } from "../scripts/package.mjs"

test("release commands select native platform formats and architecture", () => {
	assert.deepEqual(releaseArguments("win", "win32", "x64"), ["--win", "portable", "--x64"])
	assert.deepEqual(releaseArguments("linux", "linux", "x64"), ["--linux", "AppImage", "deb", "--x64"])
	assert.deepEqual(releaseArguments("mac", "darwin", "arm64"), ["--mac", "dmg", "zip", "--arm64"])
	assert.deepEqual(releaseArguments("mac", "darwin", "x64"), ["--mac", "dmg", "zip", "--x64"])
})

test("release commands reject unsupported hosts before staging or downloading tools", () => {
	assert.throws(() => releaseArguments("win", "linux", "x64"), /Windows x64/)
	assert.throws(() => releaseArguments("linux", "darwin", "x64"), /Linux x64/)
	assert.throws(() => releaseArguments("linux", "linux", "arm64"), /Linux x64/)
	assert.throws(() => releaseArguments("mac", "linux", "x64"), /macOS/)
	assert.throws(() => releaseArguments("mac", "darwin", "ia32"), /macOS/)
	assert.throws(() => releaseArguments("unknown", "linux", "x64"), /Unknown release target/)
})
