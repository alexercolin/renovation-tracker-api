import DataLoader from 'dataloader';

import { type Container } from '../container.js';
import { type Job } from '../modules/jobs/jobs.types.js';
import { type User } from '../modules/users/users.service.js';
import { NotFoundError } from '../shared/errors.js';

export interface Loaders {
  userById: DataLoader<string, User>;
  homeownersByJobId: DataLoader<string, User[]>;
  jobById: DataLoader<string, Job>;
}

type Batch<V> = Promise<Array<V | Error>>;

export function createLoaders(services: Container['services']): Loaders {
  const loadUsers = async (ids: readonly string[]): Batch<User> => {
    const found = await services.users.findManyByIds(ids);
    return ids.map((id) => found.get(id) ?? new NotFoundError('User', id));
  };

  const loadHomeowners = async (jobIds: readonly string[]): Batch<User[]> => {
    const found = await services.jobs.homeownersByJobIds(jobIds);
    return jobIds.map((jobId) => found.get(jobId) ?? []);
  };

  const loadJobs = async (ids: readonly string[]): Batch<Job> => {
    const found = await services.jobs.findManyByIds(ids);
    return ids.map((id) => found.get(id) ?? new NotFoundError('Job', id));
  };

  return {
    userById: new DataLoader(loadUsers),
    homeownersByJobId: new DataLoader(loadHomeowners),
    jobById: new DataLoader(loadJobs),
  };
}
