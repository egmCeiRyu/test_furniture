import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const host = '127.0.0.1';
const port = 4173;
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error('Missing file');
        response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
        createReadStream(path).pipe(response);
    } catch {
        response.writeHead(404).end('Arquivo não encontrado.');
    }
});
const url = 'http://' + host + ':' + port + '/';
function openBrowser() {
    if (!process.argv.includes('--open')) return;
    const browser = spawn('explorer.exe', [url], { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => console.log('Abra no navegador: ' + url));
}
server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error('A porta local 4173 já está em uso. Se o QRIE já estiver aberto, acesse ' + url);
    } else {
        console.error(error);
    }
    process.exitCode = 1;
});
server.listen(port, host, () => {
    console.log('QRIE local: ' + url);
    openBrowser();
});

