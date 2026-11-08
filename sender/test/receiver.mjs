import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext } from 'node:tls';

const callbacks = [];
const queries = {};
const dns = createSocket('udp4');
dns.on('message', (message, peer) => {
  let offset = 12;
  const labels = [];
  while (message[offset]) {
    const size = message[offset++];
    labels.push(message.subarray(offset, offset + size).toString());
    offset += size;
  }
  const hostname = labels.join('.');
  const type = message.readUInt16BE(++offset);
  offset += 4;
  queries[`${hostname}:${type}`] = (queries[`${hostname}:${type}`] ?? 0) + 1;
  let addresses = [];
  if (type === 1 && hostname !== 'ipv6.test') {
    addresses = hostname === 'private.test' || (hostname === 'rebind.test' && queries[`${hostname}:1`] > 1)
      ? [[127, 0, 0, 1]] : [[93, 184, 216, 20]];
    if (hostname === 'mixed.test') addresses.push([10, 0, 0, 1]);
  }
  if (type === 28 && hostname === 'ipv6.test') addresses = [[0xfc, 0, ...Array(14).fill(0)]];
  const header = Buffer.from(message.subarray(0, 12));
  header.writeUInt16BE(0x8180, 2);
  header.writeUInt16BE(addresses.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const records = addresses.map((address) => {
    const record = Buffer.alloc(12 + address.length);
    record.writeUInt16BE(0xc00c);
    record.writeUInt16BE(type, 2);
    record.writeUInt16BE(1, 4);
    record.writeUInt32BE(0, 6);
    record.writeUInt16BE(address.length, 10);
    Buffer.from(address).copy(record, 12);
    return record;
  });
  const answer = () => dns.send(Buffer.concat([header, message.subarray(12, offset), ...records]), peer.port, peer.address);
  if (hostname === 'slowdns.test' || hostname === 'deadline-dns.test') setTimeout(answer, hostname === 'slowdns.test' ? 3000 : 1500);
  else answer();
});
dns.bind(53, '0.0.0.0');

const tls={cert:readFileSync('/fixtures/cert.pem'),key:readFileSync('/fixtures/key.pem')};
const receiver = createHttpsServer({
  ...tls,SNICallback(host,callback) {if (host==='slowtls.test') setTimeout(()=>callback(null,createSecureContext(tls)),1500);else callback(null,createSecureContext(tls));},
}, async (request, response) => {
  const body = [];
  for await (const chunk of request) body.push(chunk);
  callbacks.push({
    path: request.url, host: request.headers.host, servername: request.socket.servername,
    localAddress: request.socket.localAddress, headers: request.headers,
    bodyBase64: Buffer.concat(body).toString('base64'),
  });
  if (request.url === '/redirect') {
    response.writeHead(302, { location: 'https://127.0.0.1/redirect-target' }).end('redirect');
  } else if (request.url === '/large-response') {
    response.writeHead(200).end('x'.repeat(16 * 1024 + 1));
  } else if (request.url === '/slow') {
    setTimeout(() => response.end('late'), 15_000).unref();
  } else if (request.url === '/finish-after-sigterm') {
    setTimeout(() => response.writeHead(202).end('accepted'), 500);
  } else {
    response.writeHead(202, { 'content-type': 'application/json' }).end('{"challenge":"test-challenge"}');
  }
});
receiver.listen(443, '0.0.0.0');
const admin = createHttpServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ callbacks, queries }));
});
admin.listen(8081, '0.0.0.0');
process.on('SIGTERM', () => {
  dns.close(); receiver.closeAllConnections(); receiver.close(); admin.closeAllConnections(); admin.close();
});
