import { Module } from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentController } from './comment.controller';

@Module({
  imports: [],
  controllers: [CommentController],
  providers: [CommentService],
})
export class CommentModule {}
