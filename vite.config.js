import { defineConfig } from 'vite';

const alpineProxy={
  target:'https://dl-cdn.alpinelinux.org',
  changeOrigin:true,
  secure:true,
  followRedirects:true,
  proxyTimeout:30000,
  timeout:30000,
  configure(proxy){
    proxy.on('proxyReq',request=>request.setHeader('accept-encoding','identity'));
  },
};
const backendProxy={target:'http://127.0.0.1:4318',changeOrigin:false,ws:true};

export default defineConfig({
  optimizeDeps:{exclude:['pyodide']},
  worker:{format:'es'},
  server:{proxy:{'/alpine':alpineProxy,'/api':backendProxy}},
  preview:{proxy:{'/alpine':alpineProxy,'/api':backendProxy}},
});
