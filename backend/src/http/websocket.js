import {createHash} from 'node:crypto';

const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame=source=>{
  const payload=Buffer.from(source),length=payload.length;
  if(length<126)return Buffer.concat([Buffer.from([0x81,length]),payload]);
  if(length<=0xffff){const header=Buffer.allocUnsafe(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(length,2);return Buffer.concat([header,payload])}
  const header=Buffer.allocUnsafe(10);header[0]=0x81;header[1]=127;header.writeBigUInt64BE(BigInt(length),2);return Buffer.concat([header,payload]);
};

export const acceptWebSocket=(request,socket)=>{
  const key=request.headers['sec-websocket-key'];if(!key)throw new Error('Missing WebSocket key.');
  const accept=createHash('sha1').update(`${key}${GUID}`).digest('base64');socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return{send:value=>{if(!socket.destroyed)socket.write(frame(JSON.stringify(value)))},buffered:()=>socket.writableLength,close:()=>socket.end(Buffer.from([0x88,0x00]))};
};

export const rejectWebSocket=(socket,status=403,message='WebSocket connection rejected.')=>{socket.end(`HTTP/1.1 ${status} Error\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)};

export const encodeWebSocketFrame=frame;
