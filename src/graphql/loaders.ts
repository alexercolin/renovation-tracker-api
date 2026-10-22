import DataLoader from 'dataloader';

import { type Container } from '../container.js';
import { type User } from '../modules/users/users.service.js';
import { NotFoundError } from '../shared/errors.js';

export interface Loaders {
  userById: DataLoader<string, User>;
  homeownersByJobId: DataLoader<string, User[]>;
}

export function createLoaders(services: Container['services']): Loaders {
  return {
    userById: new DataLoader<string, User>(async (ids) => {
      const found = await services.users.findManyByIds(ids);
      return ids.map((id) => found.get(id) ?? new NotFoundError('User', id));
    }),
    homeownersByJobId: new DataLoader<string, User[]>(async (jobIds) => {
      const found = await services.jobs.homeownersByJobIds(jobIds);
      return jobIds.map((jobId) => found.get(jobId) ?? []);
    }),
  };
}
