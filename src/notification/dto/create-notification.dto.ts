export class CreateNotificationDto {
  senderIdx: string;
  recipientIdx: string;
  type: number;
  reviewIdx?: number;
  commentContent?: string;
}
