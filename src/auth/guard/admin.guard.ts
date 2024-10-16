import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No Token');
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (payload.type != 'access') {
        throw new UnauthorizedException();
      }

      if (payload.isAdmin !== true) {
        throw new ForbiddenException('No Admin');
      }

      request.user = payload;
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        throw new UnauthorizedException('Authentication TimeOut');
      }

      throw err;
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type == 'Bearer' ? token : undefined;
  }
}
