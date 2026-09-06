import { Application, extend } from "@pixi/react";
import { Assets, Container, Graphics, Sprite, Texture } from "pixi.js";
import { useEffect, useRef, useState } from "react";

extend({
	Container,
	Graphics,
	Sprite,
});

function App() {
	return (
		<Application
			className="block h-screen w-screen"
			preference="webgl"
			resizeTo={window}
		></Application>
	);
}

export default App;
