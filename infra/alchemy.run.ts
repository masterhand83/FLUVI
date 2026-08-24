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
		const page = yield* Cloudflare.Website.Vite("FLUVI", {
			rootDir: "./apps/v1",
		});
		return {
			page: page.url,
		};
	}),
);
