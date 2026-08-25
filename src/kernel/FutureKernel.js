import { EventBus } from './EventBus.js';

export class FutureKernel {
  constructor() {
    this.bus = new EventBus();
    this.services = new Map();
    this.state = 'created';
  }

  register(name, service) {
    if (this.services.has(name)) throw new Error(`Service already registered: ${name}`);
    service.kernel = this;
    this.services.set(name, service);
    return service;
  }

  service(name) {
    const service = this.services.get(name);
    if (!service) throw new Error(`Unknown system service: ${name}`);
    return service;
  }

  async boot() {
    this.state = 'booting';
    this.bus.emit('kernel:state', this.state);
    for (const service of this.services.values()) await service.start?.();
    this.state = 'running';
    this.bus.emit('kernel:state', this.state);
  }

  async shutdown() {
    this.state = 'stopping';
    for (const service of [...this.services.values()].reverse()) await service.stop?.();
    this.state = 'stopped';
    this.bus.emit('kernel:state', this.state);
  }
}
