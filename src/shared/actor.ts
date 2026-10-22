import { type UserRole } from '../db/schema/index.js';

export interface Actor {
  id: string;
  role: UserRole;
}
