import { DatabaseService } from './database';
import { ConfigService } from './config';
// Import node-cron as any to avoid type requirement in builder
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
const cron: any = require('node-cron');
import { logger } from '../utils/logger';

export class RetentionService {
  private task: any | null = null;
  constructor(private db: DatabaseService, private config: ConfigService) {}

  start() {
    // Run hourly
    this.task = cron.schedule('0 * * * *', async () => {
      try {
        const days = Number((await this.config.get<number>('features.retention_days')) || 0);
        if (!days || days <= 0) return;
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const deleted = await this.db
          .client('locations')
          .where('created_at', '<', cutoff)
          .delete();
        if (deleted) logger.info(`Retention: purged ${deleted} location rows older than ${days}d`);
      } catch (e: any) {
        logger.error('Retention job failed', { message: e?.message });
      }
    });
  }

  stop() {
    this.task?.stop();
  }
}


