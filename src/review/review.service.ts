import {
  ConsoleLogger,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewEntity } from './entity/Review.entity';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewPagerbleResponseDto } from './dto/response/review-pagerble-response.dto';
import { UserService } from 'src/user/user.service';
import { Cron } from '@nestjs/schedule';
import { ReviewPagerbleDto } from './dto/review-pagerble.dto';
import { GetReviewWithSearchDto } from './dto/get-review-with-search.dto';
import { DEFAULT_REDIS, RedisService } from '@liaoliaots/nestjs-redis';
import { Redis } from 'ioredis';
import { GetLatestReveiwsByUserIdxsDto } from './dto/get-latest-reviews-by-userIdxs.dto';
import { UserFollowService } from 'src/user/user-follow.service';
import { ReviewWithUserStatusService } from './review-with-user-status.service';
import { GetReviewsDto } from './dto/get-reviews.dto';
import { GetReviewDetailDto } from './dto/get-review-detail.dto';
import { GetReviewsWithLoginUserDto } from './dto/get-reviews-with-login-user.dto';
import { ReviewBookmarkService } from './review-bookmark.service';

@Injectable()
export class ReviewService {
  private readonly redis: Redis | null;

  constructor(
    private readonly logger: ConsoleLogger,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly redisService: RedisService,
    private readonly userFollowService: UserFollowService,
    private readonly reviewBookmarkService: ReviewBookmarkService,
    private readonly reviewWithUserStatusService: ReviewWithUserStatusService,
  ) {
    this.redis = this.redisService.getOrThrow(DEFAULT_REDIS);

    setInterval(
      async () => {
        const keys = await this.redis.keys(`review:*:viewCount`);
        const batchSize = 100;

        for (let i = 0; i < keys.length; i += batchSize) {
          const batchKeys = keys.slice(i, i + batchSize);

          const updates = batchKeys.map(async (key) => {
            const reviewIdx = key.split(':')[1];
            const viewCount = await this.redis.get(key);
            await this.prismaService.reviewTb.update({
              where: {
                idx: parseInt(reviewIdx, 10),
              },
              data: {
                viewCount: parseInt(viewCount, 10),
              },
            });
            await this.redis.del(key);
          });
          Promise.all(updates);
        }
      },
      10 * 60 * 1000,
    );
  }

  async createReview(dto: CreateReviewDto): Promise<ReviewEntity> {
    let reviewData;

    reviewData = await this.prismaService.reviewTb.create({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },

      data: {
        accountIdx: dto.userIdx,
        title: dto.title,
        content: dto.content,
        score: dto.score,
        ...(dto.thumbnail && { thumbnail: dto.thumbnail }),
        ...(dto.thumbnailContent && { thumbnailContent: dto.thumbnailContent }),
        tagTb: {
          createMany: {
            data: dto.tags.map((tag) => {
              return {
                tagName: tag,
              };
            }),
          },
        },

        reviewImgTb: {
          createMany: {
            data: dto.images.map((image) => ({
              imgPath: image.image,
              content: image.content,
            })),
          },
        },
      },
    });

    return new ReviewEntity(reviewData);
  }

  async updateReview(dto: UpdateReviewDto): Promise<ReviewEntity> {
    let data;

    await this.prismaService.$transaction(async (tx) => {
      const review = await this.getReviewByIdx(dto.reviewIdx);

      if (!review) {
        throw new NotFoundException('Not Found Review');
      }

      if (review.user.idx !== dto.userIdx) {
        throw new UnauthorizedException('Unauthorized User');
      }

      data = await tx.reviewTb.update({
        include: {
          accountTb: true,
          tagTb: true,
          reviewImgTb: true,
          _count: {
            select: {
              commentTb: true,
              reviewLikeTb: true,
              reviewDislikeTb: true,
              reviewBookmarkTb: true,
            },
          },
        },

        data: {
          title: dto.title,
          score: dto.score,
          content: dto.content,
          updatedAt: new Date(),
          ...(dto.thumbnail && { thumbnail: dto.thumbnail }),
          ...(dto.thumbnailContent && {
            thumbnailContent: dto.thumbnailContent,
          }),
          tagTb: {
            deleteMany: {
              reviewIdx: dto.reviewIdx,
            },
            createMany: {
              data: dto.tags.map((tag) => {
                return {
                  tagName: tag,
                };
              }),
            },
          },
          reviewImgTb: {
            deleteMany: {
              reviewIdx: dto.reviewIdx,
            },
            createMany: {
              data: dto.images.map((image) => ({
                imgPath: image.image,
                content: image.content,
              })),
            },
          },
        },
        where: {
          idx: dto.reviewIdx,
        },
      });
    });

    return new ReviewEntity(data);
  }

  async deleteReview(userIdx: string, reviewIdx: number): Promise<void> {
    const review = await this.getReviewByIdx(reviewIdx);

    if (!review) {
      throw new NotFoundException('Not Found Review');
    }

    if (review.user.idx !== userIdx) {
      throw new UnauthorizedException('Unauthorized User');
    }

    await this.prismaService.reviewTb.update({
      data: {
        deletedAt: new Date(),
      },
      where: {
        idx: reviewIdx,
      },
    });
  }

  async getReviewByIdx(reviewIdx: number): Promise<ReviewEntity> {
    let review = await this.prismaService.reviewTb.findUnique({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },

      where: {
        idx: reviewIdx,
      },
    });

    if (!review) {
      return null;
    }

    return new ReviewEntity(review);
  }

  async getReviewsByIdx(reviewIdxs: number[]): Promise<ReviewEntity[]> {
    let reviews = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },

      where: {
        idx: {
          in: reviewIdxs,
        },
      },
    });

    // reviews를 reviewIdxs 순서대로 정렬
    const reviewsMap = new Map(reviews.map((review) => [review.idx, review]));
    const sortedReviews = reviewIdxs.map((idx) => reviewsMap.get(idx));

    return sortedReviews.map((review) => new ReviewEntity(review));
  }

  async getReviewDetail(dto: GetReviewDetailDto): Promise<ReviewEntity> {
    const reviewEntity = await this.getReviewByIdx(dto.reviewIdx);

    const viewCount = await this.getViewCount(reviewEntity.idx);

    reviewEntity.viewCount = viewCount + 1;
    await this.increaseViewCount(reviewEntity.idx);

    if (!dto.loginUserIdx) {
      return reviewEntity;
    }

    const userStatus = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      [dto.reviewIdx],
      null,
    );

    if (userStatus[0]) {
      reviewEntity.isMyLike = userStatus[0].isMyLike;
      reviewEntity.isMyDislike = userStatus[0].isMyDislike;
      reviewEntity.isMyBookmark = userStatus[0].isMyBookmark;
      reviewEntity.isMyBlock = userStatus[0].isMyBlock;
    }

    return reviewEntity;
  }

  async getReviewsAll(dto: GetReviewsDto): Promise<ReviewPagerbleResponseDto> {
    if (dto.userIdx) {
      const user = await this.userService.getUser({ idx: dto.userIdx });

      if (!user) {
        throw new NotFoundException('Not Found User');
      }
    }

    const now = new Date();
    let startDate: Date;

    if (dto.timeframe == '1D') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      startDate.setHours(0, 0, 0);
    } else if (dto.timeframe == '7D') {
      startDate = new Date(now.setDate(now.getDate() - 6));
      startDate.setHours(0, 0, 0);
    } else if (dto.timeframe == '1M') {
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      startDate.setHours(0, 0, 0);
    } else if (dto.timeframe == '1Y') {
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      startDate.setHours(0, 0, 0);
    } else {
      startDate = new Date(0);
    }

    const reviewCount = await this.prismaService.reviewTb.count({
      where: {
        ...(dto.userIdx && { accountIdx: dto.userIdx }),
        ...(dto.userIdxs && { accountIdx: { in: dto.userIdxs } }),
        createdAt: {
          gte: startDate,
        },
        deletedAt: null,
      },
    });

    const reviewSQLResult = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        // prettier-ignore
        ...(dto.userIdx && { accountIdx: dto.userIdx  } ),
        ...(dto.userIdxs && { accountIdx: { in: dto.userIdxs } }),
        createdAt: {
          gte: startDate,
        },
        deletedAt: null,
      },
      orderBy: {
        idx: 'desc',
      },
      take: dto.size,
      skip: (dto.page - 1) * dto.size,
    });

    return {
      totalPage: Math.ceil(reviewCount / dto.size),
      reviews: reviewSQLResult.map((elem) => new ReviewEntity(elem)),
    };
  }

  //개선후쿼리응답: 40ms
  async getFollowingReviews(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const totalCount = await this.prismaService.reviewTb.count({
      where: {
        accountTb: {
          followers: {
            some: {
              followerIdx: dto.loginUserIdx,
            },
          },
        },
      },
    });
    const skip = dto.page * dto.size;
    const take = dto.size;

    // const mainReviews: {
    //   idx: number;
    //   title: string;
    //   content: string;
    //   accountIdx: string;
    //   viewCount: number;
    //   score: number;
    //   thumbnail: string;
    //   thumbnailContent: string;
    //   createdAt: Date;
    //   updatedAt: Date;
    //   deletedAt: Date;
    //   likeCount: number;
    //   dislikeCount: number;
    //   bookmarkCount: number;
    //   commentCount: number;
    // }[] = await this.prismaService.$queryRaw/*<ReviewRow[]>*/ `
    //   WITH new_reviews AS (
    //     SELECT rt.*
    //     FROM review_tb rt
    //     WHERE rt.account_idx IN (
    //       SELECT following_idx
    //       FROM follow_tb
    //       WHERE follower_idx = ${dto.loginUserIdx}
    //     )
    //     ORDER BY rt.created_at DESC
    //     LIMIT ${take}
    //     OFFSET ${skip}
    //   )
    //   SELECT
    //     nr.idx,
    //     nr.title,
    //     nr.content,
    //     nr.account_idx as "accountIdx",
    //     nr.view_count as "viewCount",
    //     nr.score,
    //     nr.thumbnail,
    //     nr.thumbnail_content as "thumbnailContent",
    //     nr.created_at as "createdAt",
    //     nr.updated_at as "updatedAt",
    //     nr.deleted_at as "deletedAt",
    //     CAST( COALESCE(rlt.like_count, 0) AS INTEGER) AS "likeCount",
    //     CAST( COALESCE(rdt.dislike_count, 0) AS INTEGER) AS "dislikeCount",
    //     CAST( COALESCE(rbt.bookmark_count, 0) AS INTEGER) AS "bookmarkCount",
    //     CAST( COALESCE(ct.comment_count, 0) AS INTEGER) AS "commentCount"
    //   FROM new_reviews nr
    //   LEFT JOIN (
    //     SELECT review_idx, COUNT(*) AS like_count
    //     FROM review_like_tb
    //     WHERE review_idx IN (SELECT idx FROM new_reviews)
    //     GROUP BY review_idx
    //   ) rlt ON nr.idx = rlt.review_idx
    //   LEFT JOIN (
    //     SELECT review_idx, COUNT(*) AS dislike_count
    //     FROM review_dislike_tb
    //     WHERE review_idx IN (SELECT idx FROM new_reviews)
    //     GROUP BY review_idx
    //   ) rdt ON nr.idx = rdt.review_idx
    //   LEFT JOIN (
    //     SELECT review_idx, COUNT(*) AS bookmark_count
    //     FROM review_bookmark_tb
    //     WHERE review_idx IN (SELECT idx FROM new_reviews)
    //     GROUP BY review_idx
    //   ) rbt ON nr.idx = rbt.review_idx
    //   LEFT JOIN (
    //     SELECT review_idx, COUNT(*) AS comment_count
    //     FROM comment_tb
    //     WHERE review_idx IN (SELECT idx FROM new_reviews)
    //     GROUP BY review_idx
    //   ) ct ON nr.idx = ct.review_idx
    //   ORDER BY nr.created_at DESC
    // `;

    // const accountIdxList = Array.from(
    //   new Set(mainReviews.map((r) => r.accountIdx)),
    // );

    // const reviewIdxList = Array.from(
    //   new Set(mainReviews.map((elem) => elem.idx)),
    // );

    // const accounts = await this.prismaService.accountTb.findMany({
    //   where: {
    //     idx: { in: accountIdxList },
    //   },
    // });

    // const tags = await this.prismaService.tagTb.findMany({
    //   where: {
    //     reviewIdx: { in: reviewIdxList },
    //   },
    // });

    // const reviewImgs = await this.prismaService.reviewImgTb.findMany({
    //   where: {
    //     reviewIdx: { in: reviewIdxList },
    //   },
    // });

    // const reviewData: Review[] = mainReviews.map((elem) => {
    //   return {
    //     ...elem,
    //     accountTb: accounts.find((account) => account.idx === elem.accountIdx),

    //     tagTb: tags.filter((tag) => tag.reviewIdx === elem.idx),

    //     reviewImgTb: reviewImgs.filter((img) => img.reviewIdx === elem.idx),
    //     _count: {
    //       commentTb: elem.commentCount,
    //       reviewLikeTb: elem.likeCount,
    //       reviewDislikeTb: elem.dislikeCount,
    //       reviewBookmarkTb: elem.bookmarkCount,
    //     },
    //   };
    // });

    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        accountTb: {
          followers: {
            some: {
              followerIdx: dto.loginUserIdx,
            },
          },
        },
      },
      skip: dto.page * dto.size,
      take: dto.size,
      orderBy: { createdAt: 'desc' },
    });

    // return;
    return {
      totalPage: Math.ceil(totalCount / dto.size),
      reviews: reviewData.map((elem) => new ReviewEntity(elem)),
    };
  }

  async getFollowingReviewsWithUserStatus(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const reviewPagerbleResponseDto = await this.getFollowingReviews(dto);

    if (!dto.loginUserIdx) {
      return reviewPagerbleResponseDto;
    }

    const reviewIdxs = reviewPagerbleResponseDto.reviews.map(
      (review) => review.idx,
    );

    const userStatus = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      reviewIdxs,
      null,
    );

    const statusMap = new Map(
      userStatus.map((status) => [status.reviewIdx, status]),
    );

    reviewPagerbleResponseDto.reviews.map((review) => {
      const userStatus = statusMap.get(review.idx);
      if (userStatus) {
        review.isMyLike = userStatus.isMyLike;
        review.isMyDislike = userStatus.isMyDislike;
        review.isMyBookmark = userStatus.isMyBookmark;
        review.isMyBlock = userStatus.isMyBlock;
      }
    });

    return reviewPagerbleResponseDto;
  }

  async increaseViewCount(reviewIdx: number): Promise<void> {
    await this.redis.incr(`review:${reviewIdx}:viewCount`);
  }

  async getViewCount(reviewIdx: number): Promise<number> {
    let viewCount = parseInt(
      await this.redis.get(`review:${reviewIdx}:viewCount`),
      10,
    );
    if (!viewCount) {
      const review = await this.getReviewByIdx(reviewIdx);
      viewCount = review.viewCount;

      await this.redis.set(`review:${reviewIdx}:viewCount`, viewCount);
    }

    return viewCount;
  }

  async getLatestReviewsByUsers(
    dto: GetLatestReveiwsByUserIdxsDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const totalCount = await this.prismaService.reviewTb.count({
      where: {
        accountIdx: {
          in: dto.userIdxs,
        },
      },
    });

    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        accountIdx: {
          in: dto.userIdxs,
        },
      },
      skip: dto.page * dto.size,
      take: dto.size,
      orderBy: { createdAt: 'desc' },
    });

    return {
      totalPage: Math.ceil(totalCount / dto.size),
      reviews: reviewData.map((elem) => new ReviewEntity(elem)),
    };
  }

  async getReviewWithSearch(
    dto: GetReviewWithSearchDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const totalCount = await this.prismaService.reviewTb.count({
      where: {
        OR: [
          {
            title: {
              contains: dto.search,
              mode: 'insensitive',
            },
          },
          {
            content: {
              contains: dto.search,
              mode: 'insensitive',
            },
          },
          {
            accountTb: {
              nickname: {
                contains: dto.search,
                mode: 'insensitive',
              },
            },
          },
          {
            tagTb: {
              some: {
                tagName: {
                  contains: dto.search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
        deletedAt: null,
      },
    });

    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        OR: [
          {
            title: {
              contains: dto.search,
              mode: 'insensitive',
            },
          },
          {
            content: {
              contains: dto.search,
              mode: 'insensitive',
            },
          },
          {
            accountTb: {
              nickname: {
                contains: dto.search,
                mode: 'insensitive',
              },
            },
          },
          {
            tagTb: {
              some: {
                tagName: {
                  contains: dto.search,
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
        deletedAt: null,
      },
      orderBy: {
        idx: 'desc',
      },
      take: dto.size,
      skip: dto.size * (dto.page - 1),
    });

    return {
      totalPage: Math.ceil(totalCount / dto.size),
      reviews: reviewData.map((elem) => new ReviewEntity(elem)),
    };
  }

  getMidnightDaysAgo(daysAgo: number): Date {
    const date = new Date();

    date.setDate(date.getDate() - daysAgo);
    date.setHours(0, 0, 0, 0);

    return date;
  }

  async fetchHotReviews(start: Date, end: Date): Promise<ReviewEntity[]> {
    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        reviewLikeTb: {
          some: {
            createdAt: {
              gte: start,
              lte: end,
            },
          },
        },
      },
      orderBy: {
        reviewLikeTb: {
          _count: 'desc',
        },
      },
      take: 100,
    });

    return reviewData.map((review) => new ReviewEntity(review));
  }

  async fetchColdReviews(start: Date, end: Date): Promise<ReviewEntity[]> {
    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        reviewDislikeTb: {
          some: {
            createdAt: {
              gte: start,
              lte: end,
            },
          },
        },
      },
      orderBy: {
        reviewLikeTb: {
          _count: 'desc',
        },
      },
      take: 100,
    });

    return reviewData.map((review) => new ReviewEntity(review));
  }

  // 700ms, 460ms 소요(캐싱, 인덱스 안했을경우)
  // (인덱싱 했을경우)
  // 메모리에 저장하는 함수, 12시간마다 실행되는 함수
  @Cron('0 0 0 * * *')
  async setHotReviews(): Promise<void> {
    const endDay = new Date();

    const start1Day = this.getMidnightDaysAgo(1);
    const start7Day = this.getMidnightDaysAgo(7);
    const start30Day = this.getMidnightDaysAgo(30);
    endDay.setHours(0, 0, 0, 0);

    const hotReviews1Day = await this.fetchHotReviews(start1Day, endDay);
    const hotReviews7Day = await this.fetchHotReviews(start7Day, endDay);
    const hotReviews30Day = await this.fetchHotReviews(start30Day, endDay);

    await this.redis.set('hotReviews1Day', JSON.stringify(hotReviews1Day));
    await this.redis.set('hotReviews7Day', JSON.stringify(hotReviews7Day));
    await this.redis.set('hotReviews30Day', JSON.stringify(hotReviews30Day));
  }

  @Cron('0 0 0 * * *')
  async setColdReviews(): Promise<void> {
    const endDay = new Date();

    const start1Day = this.getMidnightDaysAgo(1);
    const start7Day = this.getMidnightDaysAgo(7);
    const start30Day = this.getMidnightDaysAgo(30);
    endDay.setHours(0, 0, 0, 0);

    const coldReviews1Day = await this.fetchColdReviews(start1Day, endDay);
    const coldReviews7Day = await this.fetchColdReviews(start7Day, endDay);
    const coldReviews30Day = await this.fetchColdReviews(start30Day, endDay);

    await this.redis.set('coldReviews1Day', JSON.stringify(coldReviews1Day));
    await this.redis.set('coldReviews7Day', JSON.stringify(coldReviews7Day));
    await this.redis.set('coldReviews30Day', JSON.stringify(coldReviews30Day));
  }

  async getHotReviewAll(
    dto: ReviewPagerbleDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const hotReviews = JSON.parse(
      await this.redis.get('hotReviews'),
    ) as Array<ReviewEntity>;

    if (!hotReviews) {
      return {
        totalPage: 0,
        reviews: [],
      };
    }

    const startIndex = dto.size * (dto.page - 1);

    return {
      totalPage: Math.ceil(hotReviews.length / dto.size),
      reviews: hotReviews.slice(startIndex, startIndex + dto.size),
    };
  }

  async getColdReviewAll(
    dto: ReviewPagerbleDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const coldReviews = JSON.parse(
      await this.redis.get('coldReviews'),
    ) as Array<ReviewEntity>;

    if (!coldReviews) {
      return {
        totalPage: 0,
        reviews: [],
      };
    }

    const startIndex = dto.size * (dto.page - 1);

    return {
      totalPage: Math.ceil(coldReviews.length / dto.size),
      reviews: coldReviews.slice(startIndex, startIndex + dto.size),
    };
  }

  //기존 135ms
  //100-110ms로 개선
  async getReviewsWithUserStatus(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const reviewPagerbleResponseDto = await this.getReviewsAll({
      page: dto.page,
      size: dto.size,
      timeframe: dto.timeframe,
      ...(dto.userIdx && { userIdx: dto.userIdx }),
    });

    if (!dto.loginUserIdx) {
      return reviewPagerbleResponseDto;
    }

    const userStatuses = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      reviewPagerbleResponseDto.reviews.map((review) => review.idx),
      null,
    );

    const statusMap = new Map(
      userStatuses.map((status) => [status.reviewIdx, status]),
    );

    reviewPagerbleResponseDto.reviews = reviewPagerbleResponseDto.reviews.map(
      (review) => {
        const userStatus = statusMap.get(review.idx);
        if (userStatus) {
          review.isMyLike = userStatus.isMyLike;
          review.isMyDislike = userStatus.isMyDislike;
          review.isMyBookmark = userStatus.isMyBookmark;
          review.isMyBlock = userStatus.isMyBlock;
        }
        return review;
      },
    );

    return reviewPagerbleResponseDto;
  }

  async getBookmarkedReviewsWithUserStatus(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const reviewPagerbleResponseDto =
      await this.reviewBookmarkService.getBookmarkedReviewAll({
        ...dto,
      });

    if (!dto.loginUserIdx) {
      return reviewPagerbleResponseDto;
    }

    const reviewIdxs = reviewPagerbleResponseDto.reviews.map(
      (review) => review.idx,
    );

    const userStatuses = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      reviewIdxs,
      null,
    );

    const statusMap = new Map(
      userStatuses.map((status) => [status.reviewIdx, status]),
    );

    reviewPagerbleResponseDto.reviews.map((review) => {
      const userStatus = statusMap.get(review.idx);
      if (userStatus) {
        review.isMyLike = userStatus.isMyLike;
        review.isMyDislike = userStatus.isMyDislike;
        review.isMyBookmark = userStatus.isMyBookmark;
        review.isMyBlock = userStatus.isMyBlock;
      }
      return review;
    });

    return reviewPagerbleResponseDto;
  }

  async getCommentedReviews(
    dto: GetReviewsDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const user = await this.userService.getUser({ idx: dto.userIdx });

    if (!user) {
      throw new NotFoundException('Not Found User');
    }

    // const countSQLResult: { count: bigint }[] = await this.prismaService
    //   .$queryRaw`
    //   SELECT count(*)
    //   FROM review_tb r
    //   JOIN comment_tb c ON r.idx = c.review_idx
    //   WHERE c.account_idx = ${dto.userIdx}
    //   AND r.deleted_at IS NULL;
    // `;

    const totalCount = await this.prismaService.reviewTb.count({
      where: {
        deletedAt: null,
        commentTb: {
          some: {
            accountIdx: dto.userIdx,
          },
        },
      },
    });

    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        commentTb: {
          some: {
            accountIdx: dto.userIdx,
            deletedAt: null,
          },
        },
      },
      orderBy: {
        commentTb: {},
      },
      skip: (dto.page - 1) * dto.size,
      take: dto.size,
    });

    return {
      totalPage: Math.ceil(totalCount / dto.size),
      reviews: reviewData.map((elem) => new ReviewEntity(elem)),
    };
  }

  async getCommentedReviewsWithUserStatus(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const reviewPagerbleResponseDto = await this.getCommentedReviews({
      page: dto.page,
      size: dto.size,
      userIdx: dto.userIdx,
    });

    if (!dto.loginUserIdx) {
      return reviewPagerbleResponseDto;
    }

    const reviewIdxs = reviewPagerbleResponseDto.reviews.map(
      (review) => review.idx,
    );

    const userStatuses = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      reviewIdxs,
      null,
    );

    const statusMap = new Map(
      userStatuses.map((status) => [status.reviewIdx, status]),
    );

    reviewPagerbleResponseDto.reviews.map((review) => {
      const userStatus = statusMap.get(review.idx);
      if (userStatus) {
        review.isMyLike = userStatus.isMyLike;
        review.isMyDislike = userStatus.isMyDislike;
        review.isMyBookmark = userStatus.isMyBookmark;
        review.isMyBlock = userStatus.isMyBlock;
      }
      return review;
    });
    // await this.reviewLikeCheckService.isReviewLiked(
    //   loginUser.idx,
    //   reviewPagerbleResponseDto.reviews,
    // );

    // await this.reviewLikeCheckService.isReviewDisliked(
    //   loginUser.idx,
    //   reviewPagerbleResponseDto.reviews,
    // );

    // await this.reviewBlockCheckService.isReviewBlocked(
    //   loginUser.idx,
    //   reviewPagerbleResponseDto.reviews,
    // );

    // await this.userBlockCheckService.isBlockedUser(
    //   loginUser.idx,
    //   reviewPagerbleResponseDto.reviews.map((elem) => elem.user),
    // );

    return reviewPagerbleResponseDto;
  }

  async getLikedReviews(
    dto: GetReviewsDto,
  ): Promise<ReviewPagerbleResponseDto> {
    //총숫자
    const totalCount = await this.prismaService.reviewTb.count({
      where: {
        reviewLikeTb: {
          every: {
            accountIdx: dto.userIdx,
          },
        },
      },
    });

    //리뷰페이지네이션 반환
    const reviewData = await this.prismaService.reviewTb.findMany({
      include: {
        accountTb: true,
        tagTb: true,
        reviewImgTb: true,
        _count: {
          select: {
            commentTb: true,
            reviewLikeTb: true,
            reviewDislikeTb: true,
            reviewBookmarkTb: true,
          },
        },
      },
      where: {
        accountIdx: {
          in: dto.userIdxs,
        },
      },
      skip: dto.page * dto.size,
      take: dto.size,
      orderBy: { createdAt: 'desc' },
    });

    return {
      totalPage: Math.ceil(totalCount / dto.size),
      reviews: reviewData.map((elem) => new ReviewEntity(elem)),
    };
  }

  async getLikedReviewsWithUserStatus(
    dto: GetReviewsWithLoginUserDto,
  ): Promise<ReviewPagerbleResponseDto> {
    const reviewPagerbleResponseDto = await this.getLikedReviews({
      page: dto.page,
      size: dto.size,
      userIdx: dto.userIdx,
    });

    if (!dto.loginUserIdx) {
      return reviewPagerbleResponseDto;
    }

    const reviewIdxs = reviewPagerbleResponseDto.reviews.map(
      (review) => review.idx,
    );

    const userStatuses = await this.reviewWithUserStatusService.getUserStatus(
      dto.loginUserIdx,
      reviewIdxs,
      null,
    );

    const statusMap = new Map(
      userStatuses.map((status) => [status.reviewIdx, status]),
    );

    reviewPagerbleResponseDto.reviews.map((review) => {
      const userStatus = statusMap.get(review.idx);
      if (userStatus) {
        review.isMyLike = userStatus.isMyLike;
        review.isMyDislike = userStatus.isMyDislike;
        review.isMyBookmark = userStatus.isMyBookmark;
        review.isMyBlock = userStatus.isMyBlock;
      }
      return review;
    });
  }

  getMostRecentNoon(): Date {
    const now = new Date();
    const noon = new Date(now);

    // 현재 시간이 12시 이후인지 확인
    if (now.getHours() >= 12) {
      // 오늘 12시 정각으로 설정
      noon.setHours(12, 0, 0, 0);
    } else {
      // 어제 12시 정각으로 설정
      noon.setDate(noon.getDate() - 1);
      noon.setHours(12, 0, 0, 0);
    }

    return noon;
  }

  async onModuleInit() {
    this.logger.log('setHotReviewAll Method Start');
    this.logger.log('setColdReviewAll() Method Start');

    await this.setHotReviews();
    await this.setColdReviews();
  }
}
