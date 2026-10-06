// After `vite build`: renders src/landing to HTML and writes ../dist/landing.html,
// the app shell with the landing page already inside #root. The server sends it
// to signed-out visitors at / (src/web/app.py); the app then renders over it.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const ssrOut = here('../node_modules/.landing-prerender');
const dist = here('../../dist');

await build({
  logLevel: 'warn',
  build: { ssr: 'src/landing/prerender.tsx', outDir: ssrOut, emptyOutDir: true, rollupOptions: { output: {} } },
});
const { render } = await import(pathToFileURL(`${ssrOut}/prerender.js`).href);
rmSync(ssrOut, { recursive: true, force: true });

// Applies the saved or system theme before first paint, as ThemeProvider would.
const theme = `<script>try{var p=localStorage.getItem('cashe-appearance'),t=p==='light'||p==='dark'?p:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}</script>`;
const shell = readFileSync(`${dist}/index.html`, 'utf8');
if (!shell.includes('<div id="root"></div>')) throw new Error('index.html has no empty #root to fill');
// Google Fonts is a third-party stylesheet that blocks first paint on a slow
// connection; here the page paints in the fallback font and swaps when it lands.
const fonts = /<link\s+rel="stylesheet"\s+href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"\s*\/>/;
if (!fonts.test(shell)) throw new Error('index.html has no Google Fonts stylesheet to defer');
// The page works without the app's scripts (its links are plain links), so they
// load after it rather than competing with its CSS for a slow connection.
const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>/;
if (!entry.test(shell)) throw new Error('index.html has no module entry script');
const loadAfterPage = `<script>addEventListener('load',function(){var s=document.createElement('script');s.type='module';s.crossOrigin='';s.src='$1';document.head.appendChild(s)})</script>`;
writeFileSync(`${dist}/landing.html`, shell
  .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
  .replace(entry, loadAfterPage)
  .replace(fonts, '<link rel="stylesheet" href="$1" media="print" onload="this.media=\'all\'" /><noscript><link rel="stylesheet" href="$1" /></noscript>')
  .replace('</head>', `${theme}</head>`)
  .replace('<div id="root"></div>', `<div id="root" data-prerendered="landing">${render()}</div>`));
console.log('prerendered dist/landing.html');
