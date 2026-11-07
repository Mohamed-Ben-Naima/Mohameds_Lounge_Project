// Start HQ: http://127.0.0.1:4600
import { createHq } from './hq.ts';
import { loadConfig } from './config.ts';

const hq = createHq({ config: loadConfig(process.env) });
await hq.app.listen({ host: hq.config.host, port: hq.config.port });
console.log(`${hq.config.companyName} is open at ${hq.url()}  (data: ${hq.config.dataDir})`);
