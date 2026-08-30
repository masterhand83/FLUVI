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
		const v1Page = yield* Cloudflare.Website.Vite("FLUVI", {
			rootDir: "./apps/v1",
		});
		const v2Page = yield* Cloudflare.Website.Vite("FLUVI-2", {
			rootDir: "./apps/v2",
		});
		return {
			page: v1Page.url,
			page2: v2Page.url,
		};
	}),
);
