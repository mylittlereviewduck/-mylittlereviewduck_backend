import { ApiProperty } from '@nestjs/swagger';

export class UserBlockEntity {
  @ApiProperty({
    example: 'de1704a4-bdd4-4df5-8fe8-053338cbac44',
    description: '차단한 사람',
  })
  blockerIdx: number;

  @ApiProperty({
    example: '96189f51-1b01-4781-b9df-e659d551d665',
    description: '차단당한 사람',
  })
  blockedIdx: number;

  @ApiProperty({ example: '2024-08-01T07:58:57.844Z', description: '가입일' })
  createdAt: Date;

  constructor(data) {
    this.blockerIdx = data.blockerIdx;
    this.blockedIdx = data.blockedIdx;
    this.createdAt = data.createdAt;
  }
}
