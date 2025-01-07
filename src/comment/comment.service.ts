import { CommentPagerbleResponseDto } from './dto/response/comment-pagerble-response.dto';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CommentEntity } from './entity/Comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReviewService } from 'src/review/review.service';
import { CommentPagerbleDto } from './dto/comment-pagerble.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class CommentService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly reviewService: ReviewService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getCommentByIdx(
    reviewIdx: number,
    commentIdx: number,
  ): Promise<CommentEntity> {
    const review = await this.reviewService.getReviewByIdx(reviewIdx);

    if (!review) {
      throw new NotFoundException('Not Found Review');
    }

    const comment = await this.prismaService.commentTb.findUnique({
      include: {
        accountTb: {
          include: {
            profileImgTb: true,
          },
        },
        commentTagTb: {
          include: {
            accountTb: {
              include: {
                profileImgTb: true,
              },
            },
          },
        },
        _count: {
          select: {
            commentLikeTb: true,
          },
        },
      },
      where: {
        idx: commentIdx,
        reviewIdx: reviewIdx,
      },
    });

    if (!comment) {
      return;
    }

    return new CommentEntity(comment);
  }

  async getCommentAll(
    dto: CommentPagerbleDto,
  ): Promise<CommentPagerbleResponseDto> {
    const review = await this.reviewService.getReviewByIdx(dto.reviewIdx);

    if (!review) {
      throw new NotFoundException('Not Found Review');
    }

    const totalCount = await this.prismaService.commentTb.count({
      where: {
        reviewIdx: dto.reviewIdx,
      },
    });

    const commentData = await this.prismaService.commentTb.findMany({
      include: {
        accountTb: {
          include: {
            profileImgTb: true,
          },
        },
        commentTagTb: {
          include: {
            accountTb: {
              include: {
                profileImgTb: true,
              },
            },
          },
        },
        _count: {
          select: {
            commentLikeTb: true,
          },
        },
      },
      where: {
        reviewIdx: dto.reviewIdx,
        deletedAt: {
          equals: null,
        },
      },
      take: dto.size,
      skip: (dto.page - 1) * dto.size,
    });

    return {
      totalPage: Math.ceil(totalCount / dto.size),
      comments: commentData.map((comment) => new CommentEntity(comment)),
    };
  }

  async createComment(dto: CreateCommentDto): Promise<CommentEntity> {
    let comment;
    const review = await this.reviewService.getReviewByIdx(dto.reviewIdx);

    if (!review) {
      throw new NotFoundException('Not Found Review');
    }

    if (dto.commentIdx) {
      comment = await this.getCommentByIdx(dto.reviewIdx, dto.commentIdx);
    }

    if (dto.commentIdx && !comment) {
      throw new NotFoundException('Not Found Comment');
    }

    //태그테이블 데이터 생성
    const commentData = await this.prismaService.commentTb.create({
      include: {
        accountTb: {
          include: {
            profileImgTb: true,
          },
        },
        commentTagTb: {
          include: {
            accountTb: {
              include: {
                profileImgTb: true,
              },
            },
          },
        },
        _count: {
          select: {
            commentLikeTb: true,
          },
        },
      },
      data: {
        reviewIdx: dto.reviewIdx,
        accountIdx: dto.loginUserIdx,
        content: dto.content,
        ...(dto.commentIdx && { commentIdx: dto.commentIdx }),
        commentTagTb: {
          createMany: {
            data: dto.userIdxs.map((userIdx) => ({
              accountIdx: userIdx,
            })),
          },
        },
      },
    });

    if (dto.loginUserIdx !== review.user.idx) {
      this.eventEmitter.emit('notification.create', {
        senderIdx: dto.loginUserIdx,
        recipientIdx: review.user.idx,
        type: 3,
        reviewIdx: review.idx,
        commentIdx: commentData.idx,
      });
    }

    return new CommentEntity(commentData);
  }

  //댓글 수정시 없는 댓글요청시 서버에러나는거 수정해야함
  async updateComment(
    userIdx: string,
    reviewIdx: number,
    commentIdx: number,
    dto: UpdateCommentDto,
  ): Promise<CommentEntity> {
    const comment = await this.getCommentByIdx(reviewIdx, commentIdx);

    if (!comment) {
      throw new NotFoundException('Not Found Comment');
    }

    if (comment.user.idx !== userIdx) {
      throw new UnauthorizedException('Unauthorized User');
    }

    const commentData = await this.prismaService.commentTb.update({
      include: {
        accountTb: {
          include: {
            profileImgTb: true,
          },
        },
        commentTagTb: {
          include: {
            accountTb: {
              include: {
                profileImgTb: true,
              },
            },
          },
        },
        _count: {
          select: {
            commentLikeTb: true,
          },
        },
      },
      data: {
        content: dto.content,
        updatedAt: new Date(),
      },
      where: {
        idx: commentIdx,
      },
    });

    return new CommentEntity(commentData);
  }

  async deleteComment(
    userIdx: string,
    reviewIdx: number,
    commentIdx: number,
  ): Promise<void> {
    const comment = await this.getCommentByIdx(reviewIdx, commentIdx);

    if (!comment) {
      throw new NotFoundException('Not Found Comment');
    }

    if (comment.user.idx !== userIdx) {
      throw new UnauthorizedException('Unauthorized');
    }

    await this.prismaService.commentTb.update({
      data: {
        deletedAt: new Date(),
      },
      where: {
        idx: commentIdx,
        accountIdx: userIdx,
      },
    });

    return;
  }
}
