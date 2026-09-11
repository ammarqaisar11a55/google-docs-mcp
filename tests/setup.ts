import { setLogLevel } from '../src/utils/logger.js';

// Keep test output readable; individual tests may raise the level to assert on logs.
setLogLevel('error');
