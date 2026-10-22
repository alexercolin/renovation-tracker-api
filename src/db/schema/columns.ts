import { timestamp, uuid } from 'drizzle-orm/pg-core';

import { newId } from '../../shared/ids.js';

export const idColumn = () => uuid().primaryKey().$defaultFn(newId);

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
