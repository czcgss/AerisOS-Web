import { defineConfig } from 'vite';

const alpineProxy={
  target:'https://dl-cdn.alpinelinux.org',
  changeOrigin:true,
  secure:true,
};

export default defineConfig({
  server:{proxy:{'/alpine':alpineProxy}},
  preview:{proxy:{'/alpine':alpineProxy}},
});
