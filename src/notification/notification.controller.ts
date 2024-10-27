import { FollowCheckService } from './../user/follow-check.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { Controller, Get, Query, Sse, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetUser } from 'src/auth/get-user.decorator';
import { LoginUser } from 'src/auth/model/login-user.model';
import { Exception } from 'src/decorator/exception.decorator';
import { NotificationPagerbleResponseDto } from './dto/response/notification-pagerble-response.dto';
import { NotificationService } from './notification.service';
import { Observable } from 'rxjs';
import { NotificationEntity } from './entity/Notification.entity';
import { GetNotificationDto } from './dto/get-notification.dto';

@Controller('')
@ApiTags('user')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly followCheckService: FollowCheckService,
  ) {}

  @Get('/user/notification/all')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 알림목록보기' })
  @Exception(400, '유효하지않은 요청')
  @ApiResponse({ status: 200, type: NotificationPagerbleResponseDto })
  async getMyNotifications(
    @Query() dto: GetNotificationDto,
    @GetUser() loginUser: LoginUser,
  ): Promise<NotificationPagerbleResponseDto> {
    const notificationPagerbleResponseDto =
      await this.notificationService.getMyNotificationAll({
        userIdx: loginUser.idx,
        page: dto.page || 1,
        size: dto.size || 20,
      });

    await this.followCheckService.isFollow(
      loginUser.idx,
      notificationPagerbleResponseDto.notifications.map(
        (notification) => notification.sender,
      ),
    );

    return notificationPagerbleResponseDto;
  }

  @Sse('/sse')
  @UseGuards(AuthGuard)
  sendClientNotification(
    @GetUser() loginUser: LoginUser,
  ): Observable<NotificationEntity> {
    return this.notificationService.getNotification(loginUser.idx);
  }
}
