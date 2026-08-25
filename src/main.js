import { createSystem } from './system/createSystem.js';

createSystem(document.querySelector('#app')).catch(error => {
  console.error(error);
  document.querySelector('#app').innerHTML=`<main class="fatal-error"><h1>Future could not start</h1><pre>${error.message}</pre></main>`;
});
