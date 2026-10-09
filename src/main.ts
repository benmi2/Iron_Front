import './ui/styles.css';
import { App } from './App';

const app = new App(document.getElementById('app')!);
// exposed for automated visual checks (scripts/shot.mjs) and debugging
(window as unknown as { __iron: App }).__iron = app;
