import { defineConfig } from 'vitest/config';

// Config propia (evita heredar root: 'public' de vite.config.js).
export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
        globals: false,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Solo se mide la calidad de los modulos mantenidos (los grandes heredados quedan fuera).
            include: ['public/js/vales-cupo.js', 'public/js/export.js', 'server/values.js', 'server/access.js'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
    },
});
