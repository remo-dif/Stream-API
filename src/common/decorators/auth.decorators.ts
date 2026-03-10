import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  email: string;
  tenantId?: string;
  user_metadata?: any;
}

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);

export const Public = () => SetMetadata('isPublic', true);

export const CurrentUser = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user;

  return data ? user?.[data] : user;
});

export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user?.tenantId;
});
