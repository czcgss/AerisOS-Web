import {createBackend} from './app.js';

const backend=createBackend(),{host,port}=backend.config;
backend.server.once('error',async error=>{console.error(error.code==='EADDRINUSE'?`Future backend cannot start because ${host}:${port} is already in use.`:error);await backend.browser.stop().catch(()=>{});process.exit(1)});
backend.server.listen(port,host,()=>console.log(`Future backend listening on http://${host}:${port}`));

const shutdown=async()=>{await backend.close();process.exit(0)};
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
