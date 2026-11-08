import { Application } from "@pixi/react";

function App() {
	return (
		<Application
			className="block h-screen w-screen"
			preference="webgl"
			resizeTo={window}
		/>
	);
}

export default App;
