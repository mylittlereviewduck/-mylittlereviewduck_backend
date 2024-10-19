import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserEntity } from './entity/User.entity';
import { NotificationUserEntity } from 'src/notification/entity/NotificationUser.entity';

@Injectable()
export class FollowCheckService {
  constructor(private readonly prismaService: PrismaService) {}

  async isFollow(
    accountIdx: string,
    toUsers: UserEntity[] | NotificationUserEntity[],
  ): Promise<UserEntity[] | NotificationUserEntity[]> {
    const sqlResult = await this.prismaService.followTb.findMany({
      select: {
        followee: true,
      },
      where: {
        followerIdx: accountIdx,
        followeeIdx: {
          in: toUsers.map((elem) => elem.idx),
        },
      },
    });

    const followingUserList = sqlResult.map((elem) => elem.followee.idx);

    for (let i = 0; i < toUsers.length; i++) {
      if (followingUserList.includes(toUsers[i].idx)) {
        toUsers[i].isMyFollowing = true;
      } else {
        toUsers[i].isMyFollowing = false;
      }
    }

    return toUsers;
  }
}
