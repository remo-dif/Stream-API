import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../database/entities/user.entity';

function makeContext(user?: any): ExecutionContext {
  const request = { user };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
  });

  it('returns true when no roles are required (no @Roles decorator)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext({ role: UserRole.USER });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when user has the required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = makeContext({ role: UserRole.ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('returns true when user has one of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN, UserRole.SUPERADMIN]);
    const ctx = makeContext({ role: UserRole.SUPERADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user has insufficient role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = makeContext({ role: UserRole.USER });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is not authenticated', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for USER trying to access SUPERADMIN route', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPERADMIN]);
    const ctx = makeContext({ role: UserRole.USER });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException for ADMIN trying to access SUPERADMIN route', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPERADMIN]);
    const ctx = makeContext({ role: UserRole.ADMIN });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
