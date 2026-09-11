import { defineConfig } from 'vite';

// El sitio vive en /public (raiz de Vite). El build sale a /dist.
export default defineConfig({
    root: 'public',
    publicDir: 'static',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                index: 'index.html',
                rrhh: 'rrhh.html',
                vales: 'vales.html',
                descuentos: 'descuentos.html',
                notFound: '404.html',
            },
        },
    },
    server: {
        port: 5173,
        open: '/index.html',
        proxy: {
            '/api': 'http://localhost:3000',
        },
    },
});
