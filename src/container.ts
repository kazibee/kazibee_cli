import 'reflect-metadata';
import createContainer from '@noego/ioc';
import { configureLogging } from '@noego/logger';
import { FileTransport } from './utils/file-transport.js';

configureLogging({
  transports: [new FileTransport()],
});

const container = createContainer();

export { container };
