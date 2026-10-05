import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export default Alchemy.Stack(
	"my-app",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const v1Page = yield* Cloudflare.Website.StaticSite("FLUVI", {
			cwd: "./apps/v1",
			command: "pnpm run build",
			outdir: "dist",
			dev: { command: "pnpm run dev" },
			name: "fluvi",
		});
		return {
			page: v1Page.url,
		};
	}),
);
