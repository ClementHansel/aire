import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const DATABASE_POOL = 'DATABASE_POOL';

export const DatabasePoolProvider: Provider = {
  provide: DATABASE_POOL,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): Pool => {
    return new Pool({
      connectionString: configService.get<string>(
        'DATABASE_URL',
        'postgresql://aire:aire@localhost:5432/aire',
      ),
    });
  },
};
