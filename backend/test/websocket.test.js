import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWebSocketFrame} from '../src/http/websocket.js';

test('websocket encoder supports small and large screencast frames',()=>{
  const small=encodeWebSocketFrame('ok');assert.equal(small[0],0x81);assert.equal(small[1],2);assert.equal(small.subarray(2).toString(),'ok');
  const medium=encodeWebSocketFrame('x'.repeat(1024));assert.equal(medium[1],126);assert.equal(medium.readUInt16BE(2),1024);
  const large=encodeWebSocketFrame('x'.repeat(70000));assert.equal(large[1],127);assert.equal(Number(large.readBigUInt64BE(2)),70000);
});
