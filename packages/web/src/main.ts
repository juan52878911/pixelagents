import { Application, Graphics } from 'pixi.js';

// Owner: W3 (engine) / W7 (world). Placeholder so the build works from day one.
const app = new Application();
await app.init({ width: 480, height: 328, background: '#14111b', antialias: false });
document.getElementById('app')!.appendChild(app.canvas);
app.stage.addChild(new Graphics().rect(8, 8, 32, 32).fill('#ffe9a8'));
