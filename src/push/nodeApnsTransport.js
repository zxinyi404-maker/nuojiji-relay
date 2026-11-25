import { lookup } from 'node:dns/promises';
import { request } from 'node:https';

const preferred = new Map();

function attempt(url, address, options) {
    return new Promise((resolve, reject) => {
        let connected = false;
        let connectTimer, totalTimer;
        const finish = (error, result) => {
            clearTimeout(connectTimer);
            clearTimeout(totalTimer);
            if (error) { error.apnsConnected = connected; reject(error); }
            else resolve(result);
        };
        const req = request(url, {
            method: 'POST', headers: options.headers, autoSelectFamily: false,
            lookup: (hostname, settings, callback) => callback(null, address.address, address.family),
        }, response => {
            const chunks = [];
            let bytes = 0;
            response.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > 16384) req.destroy(new Error('APNs relay response too large'));
                else chunks.push(chunk);
            });
            response.on('end', () => finish(null, {
                status: response.statusCode,
                text: async () => Buffer.concat(chunks).toString('utf8'),
            }));
            response.on('error', error => req.destroy(error));
            response.on('aborted', () => req.destroy(new Error('APNs relay response interrupted')));
        });
        connectTimer = setTimeout(() => req.destroy(Object.assign(new Error('APNs TLS connection timed out'), { code: 'APNS_CONNECT_TIMEOUT' })), 5000);
        totalTimer = setTimeout(() => req.destroy(Object.assign(new Error('APNs relay response timed out'), { code: 'APNS_RESPONSE_TIMEOUT' })), 35000);
        req.on('socket', socket => {
            const markConnected = () => { connected = true; clearTimeout(connectTimer); };
            if (socket.authorized && !socket.connecting) markConnected();
            else socket.once('secureConnect', markConnected);
        });
        req.on('error', error => finish(error));
        req.end(options.body);
    });
}

export async function postApns(endpoint, options) {
    const url = new URL(endpoint);
    const addresses = await lookup(url.hostname, { all: true });
    addresses.sort((first, second) => Number(second.address === preferred.get(url.hostname))
        - Number(first.address === preferred.get(url.hostname)) || first.family - second.family);
    let lastError = new Error('No addresses available for APNs relay');
    for (const address of addresses.slice(0, 4)) {
        try {
            const response = await attempt(url, address, options);
            if (preferred.size >= 32) preferred.clear();
            preferred.set(url.hostname, address.address);
            return response;
        } catch (error) {
            if (error.apnsConnected) throw error;
            lastError = error;
        }
    }
    throw lastError;
}
