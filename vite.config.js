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

export default defineConfig({
  optimizeDeps:{exclude:['pyodide']},
  worker:{format:'es'},
  server:{proxy:{'/alpine':alpineProxy}},
  preview:{proxy:{'/alpine':alpineProxy}},
});
