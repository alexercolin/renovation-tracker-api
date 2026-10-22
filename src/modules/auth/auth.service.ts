import { compare } from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { type Db } from '../../db/client.js';
import { type Actor } from '../../shared/actor.js';
import { UnauthenticatedError, ValidationError } from '../../shared/errors.js';
import { toUser, type User } from '../users/users.service.js';
import { type UsersRepository } from '../users/users.repository.js';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export type CurrentUser = Actor;

export interface AuthPayload {
  token: string;
  user: User;
}

const loginInputSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

const roleSchema = z.enum(['CONTRACTOR', 'HOMEOWNER']);

const INVALID_CREDENTIALS = 'Invalid email or password';

export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    private readonly db: Db,
    private readonly usersRepository: UsersRepository,
    private readonly config: AuthConfig,
  ) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
  }

  async login(input: { email: string; password: string }): Promise<AuthPayload> {
    const parsed = loginInputSchema.safeParse(input);
    if (!parsed.success) throw ValidationError.fromZod(parsed.error);

    const row = await this.usersRepository.findByEmail(this.db, parsed.data.email);
    if (!row) throw new UnauthenticatedError(INVALID_CREDENTIALS);

    const passwordMatches = await compare(parsed.data.password, row.passwordHash);
    if (!passwordMatches) throw new UnauthenticatedError(INVALID_CREDENTIALS);

    const user = toUser(row);
    return { token: await this.issueToken(user), user };
  }

  async issueToken(user: Pick<User, 'id' | 'role'>): Promise<string> {
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(this.config.jwtExpiresIn)
      .sign(this.secret);
  }

  async verifyToken(token: string): Promise<CurrentUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
      const role = roleSchema.safeParse(payload.role);
      if (!payload.sub || !role.success) throw new UnauthenticatedError('Invalid token');
      return { id: payload.sub, role: role.data };
    } catch (error) {
      if (error instanceof UnauthenticatedError) throw error;
      throw new UnauthenticatedError('Invalid or expired token');
    }
  }
}
