import { render } from 'solid-js/web';
import { useExampleSession } from './main.ts';
function App(){ const qaraa=useExampleSession(); return <output>{qaraa.snapshot().revision}</output>; }
render(() => <App />, document.getElementById('app')!);
