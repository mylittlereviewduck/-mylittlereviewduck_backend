import { CommentLikeCheckService } from './comment-like-check.service';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CommentEntity } from './entity/Comment.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginUser } from 'src/auth/model/login-user.model';

@Injectable()
export class CommentService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly commentLikeCheckService: CommentLikeCheckService,
  ) {}

  async getComment(
    reviewIdx: number,
    commentIdx: number,
  ): Promise<CommentEntity> {
    const comment = await this.prismaService.commentTb.findUnique({
      where: {
        idx: commentIdx,
        reviewIdx: reviewIdx,
      },
    });

    if (!comment) {
      return;
    }

    const commentData = {
      ...comment,
      userIdx: comment.accountIdx,
    };

    console.log('comment: ', comment);

    // return;
    return new CommentEntity(commentData);
  }

  async getCommentAll(reviewIdx: number): Promise<CommentEntity[]> {
    const commentData = await this.prismaService.commentTb.findMany({
      include: {
        accountTb: true,
      },
      where: {
        reviewIdx: reviewIdx,
        deletedAt: {
          equals: null,
        },
      },
      orderBy: {
        idx: 'desc',
      },
    });

    return commentData.map((elem) => new CommentEntity(elem));
  }

  async createComment(
    accountIdx: number,
    reviewIdx: number,
    createCommentDto: CreateCommentDto,
  ): Promise<CommentEntity> {
    const review = await this.prismaService.reviewTb.findUnique({
      where: { idx: reviewIdx },
    });

    if (!review) {
      throw new NotFoundException('Not Found Review');
    }

    const commentData = await this.prismaService.commentTb.create({
      data: {
        reviewIdx: reviewIdx,
        accountIdx: accountIdx,
        content: createCommentDto.content,
        commentIdx: createCommentDto.commentIdx,
      },
    });

    return new CommentEntity(commentData);
  }

  async updateComment(
    accountIdx: number,
    updateCommentDto: UpdateCommentDto,
  ): Promise<CommentEntity> {
    const comment = await this.prismaService.commentTb.findUnique({
      where: {
        idx: updateCommentDto.commentIdx,
      },
    });

    if (!comment) {
      throw new NotFoundException('Not Found Comment');
    }

    if (comment.accountIdx !== accountIdx) {
      throw new UnauthorizedException('Unauthorized User');
    }

    const commentData = await this.prismaService.commentTb.update({
      data: {
        content: updateCommentDto.content,
        updatedAt: new Date(),
      },
      where: {
        idx: updateCommentDto.commentIdx,
      },
    });

    return new CommentEntity(commentData);
  }

  async deleteComment(
    commentIdx: number,
    accountIdx: number,
  ): Promise<CommentEntity> {
    const comment = await this.prismaService.commentTb.findUnique({
      where: {
        idx: commentIdx,
      },
    });

    if (!comment) {
      throw new NotFoundException('Not Found Comment');
    }

    if (comment.accountIdx !== accountIdx) {
      throw new UnauthorizedException('Unauthorized');
    }

    const deletedCommentData = await this.prismaService.commentTb.update({
      data: {
        deletedAt: new Date(),
      },
      where: {
        idx: commentIdx,
        accountIdx: accountIdx,
      },
    });
    return new CommentEntity(deletedCommentData);
  }
}
