import { Controller, Post, Body, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() body: { email: string; password: string }) {
    return this.authService.signUp(body.email, body.password);
  }

  @Post('signin')
  async signIn(@Body() body: { email: string; password: string }) {
    return this.authService.signIn(body.email, body.password);
  }

  @Post('signout')
  async signOut(@Headers('authorization') authorization: string) {
    const token = this.extractToken(authorization);
    return this.authService.signOut(token);
  }

  @Get('user')
  async getUser(@Headers('authorization') authorization: string) {
    const token = this.extractToken(authorization);
    return this.authService.getUser(token);
  }

  @Post('refresh')
  async refresh(@Body() body: { refresh_token: string }) {
    return this.authService.refreshSession(body.refresh_token);
  }

  private extractToken(authorization: string): string {
    if (!authorization) {
      throw new UnauthorizedException('No authorization header');
    }

    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization header');
    }

    return token;
  }
}
