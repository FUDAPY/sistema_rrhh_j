// scripts/tls-check.mjs
// Diagnostico del certificado TLS y de la redireccion HTTPS de un dominio
// publicado detras de Traefik (Dokploy). Usa solo modulos nativos de Node.
//
// Uso:  npm run tls:check -- mi-dominio.com

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const TRAEFIK_DEFAULT_CN = 'TRAEFIK DEFAULT CERT';

const host = (process.argv[2] || process.env.TLS_CHECK_HOST || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

if (!host) {
    console.error('Uso: npm run tls:check -- <dominio>   (ej: npm run tls:check -- rrhh.midominio.com)');
    console.error('Variable opcional: TLS_CHECK_PORT para inspeccionar un puerto distinto de 443.');
    process.exit(1);
}

const tlsPort = Number(process.env.TLS_CHECK_PORT || 443);

const line = () => console.log('-'.repeat(72));
const daysUntil = (date) => Math.round((date - Date.now()) / 86400000);

function lookupDns(name) {
    return dns
        .lookup(name, { all: true })
        .then((records) => records.map((record) => `${record.address} (IPv${record.family})`).join(', '))
        .catch((error) => `ERROR ${error.code || error.message}`);
}

function readCertificate(name) {
    return new Promise((resolve) => {
        const socket = tls.connect(
            { host: name, port: tlsPort, servername: name, rejectUnauthorized: false, timeout: 12000 },
            () => {
                resolve({
                    cert: socket.getPeerCertificate(),
                    authorized: socket.authorized,
                    authError: socket.authorizationError ? String(socket.authorizationError) : '',
                });
                socket.end();
            }
        );
        socket.once('timeout', () => {
            socket.destroy();
            resolve({ error: 'timeout al conectar al puerto 443' });
        });
        socket.once('error', (error) => resolve({ error: error.message }));
    });
}

// Peticion sin seguir redirecciones, para leer el status y las cabeceras reales.
function probe(protocol, name, path) {
    return new Promise((resolve) => {
        const transport = protocol === 'https:' ? https : http;
        const options = {
            protocol,
            host: name,
            port: protocol === 'https:' ? tlsPort : 80,
            path,
            method: 'GET',
            timeout: 12000,
        };
        if (protocol === 'https:') options.rejectUnauthorized = false;

        const request = transport.request(options, (response) => {
            response.resume();
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
        });
        request.once('timeout', () => {
            request.destroy();
            resolve({ error: 'timeout' });
        });
        request.once('error', (error) => resolve({ error: error.message }));
        request.end();
    });
}

function sanEntries(san) {
    return String(san || '')
        .split(',')
        .map((entry) =>
            entry
                .trim()
                .replace(/^(DNS|IP Address|IP):/i, '')
                .trim()
        )
        .filter(Boolean);
}

function certCoversHost(san, hostname) {
    const name = hostname.toLowerCase();
    return sanEntries(san).some((entry) => {
        const value = entry.toLowerCase();
        if (value === name) return true;
        if (!value.startsWith('*.')) return false;
        // El comodin cubre solo un nivel: *.dominio.com != a.b.dominio.com
        const suffix = value.slice(1);
        return name.endsWith(suffix) && !name.slice(0, name.length - suffix.length).includes('.');
    });
}

function describeHttp(result, label) {
    if (!result || result.error) return `${label}: sin respuesta (${result?.error || 'desconocido'})`;
    const location = result.headers?.location;
    const redirected = result.status === 301 || result.status === 302 || result.status === 308;
    return `${label}: HTTP ${result.status}${redirected && location ? ` -> ${location}` : ''}`;
}

function describeHttps(result) {
    if (!result || result.error) return `HTTPS: sin respuesta (${result?.error || 'desconocido'})`;
    const hsts = result.headers?.['strict-transport-security'];
    return `HTTPS: HTTP ${result.status} | HSTS: ${hsts || 'no publicado (HSTS_ENABLED=true para activarlo)'}`;
}

console.log(`Diagnostico TLS/HTTPS de: ${host}`);
line();
console.log(`DNS      : ${await lookupDns(host)}`);
console.log(await describeHttp(await probe('http:', host, '/api/health'), 'HTTP (80)'));

const tlsInfo = await readCertificate(host);
if (tlsInfo.error) {
    console.log(`TLS (443): sin respuesta (${tlsInfo.error})`);
    line();
    console.log('No hay TLS escuchando en el 443: revisa que Traefik y el contenedor esten arriba.');
    process.exit(1);
}

const cert = tlsInfo.cert || {};
const subjectCn = cert.subject?.CN || '(sin CN)';
const issuer = cert.issuer?.CN || cert.issuer?.O || '(sin emisor)';
const san = cert.subjectaltname || '(sin SAN)';
const validTo = cert.valid_to ? new Date(cert.valid_to) : null;

console.log(await describeHttps(await probe('https:', host, '/api/health')));
console.log(`Emisor   : ${issuer}`);
console.log(`Sujeto   : CN=${subjectCn}`);
console.log(`SAN      : ${san}`);
if (validTo) console.log(`Vigencia : hasta ${validTo.toLocaleString()} (${daysUntil(validTo)} dias)`);
console.log(`Cadena   : ${tlsInfo.authorized ? 'valida' : `FALLA (${tlsInfo.authError || 'desconocida'})`}`);
line();

const showsDefaultCert = subjectCn.toUpperCase() === TRAEFIK_DEFAULT_CN;
const coversHost = certCoversHost(san, host);

if (showsDefaultCert) {
    console.log('DIAGNOSTICO: Traefik sirve su certificado AUTOFIRMADO por defecto.');
    console.log('Ese host no tiene certificado emitido ni router TLS asociado.');
    console.log('');
    console.log('Revisa en este orden:');
    console.log('  1. Dokploy -> Application -> Domains: Host exacto (sin https://, sin puerto, sin /),');
    console.log('     Path=/, Port=3000, HTTPS activado y Certificate Provider=letsencrypt.');
    console.log('  2. DNS: el registro A debe apuntar a la IP del servidor donde corre Traefik.');
    console.log('  3. Firewall: puertos 80 y 443 abiertos (la validacion ACME usa el 80).');
    console.log('  4. Que el host consultado sea el mismo que registraste en Domains.');
    console.log('  5. Cloudflare con proxy (nube naranja): pásalo a DNS only para el reto HTTP-01.');
    console.log('  6. Logs de Traefik en Dokploy: busca "unable to obtain certificate" o errores ACME.');
} else if (!coversHost) {
    console.log(`DIAGNOSTICO: hay certificado valido pero NO cubre "${host}" (SAN: ${san}).`);
    console.log('Registra este hostname en Dokploy -> Domains o entra por uno de los nombres del SAN.');
} else if (!tlsInfo.authorized) {
    console.log('DIAGNOSTICO: el certificado cubre el host pero la cadena no valida.');
    console.log('Suele faltar el certificado intermedio en Traefik (cadena incompleta).');
} else {
    console.log('DIAGNOSTICO: el certificado es valido y cubre este host.');
    console.log('Si el navegador muestra "No es seguro", busca contenido mixto (http://) en');
    console.log('DevTools -> Console y luego activa HSTS_ENABLED=true.');
}
