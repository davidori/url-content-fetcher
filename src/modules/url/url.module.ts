import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UrlController } from './url.controller';
import { UrlService } from './url.service';
import { UrlRefreshScheduler } from './url-refresh.scheduler';
import { Url, UrlSchema } from './schemas/url.schema';
import { Content, ContentSchema } from './schemas/content.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Url.name, schema: UrlSchema },
      { name: Content.name, schema: ContentSchema },
    ]),
  ],
  controllers: [UrlController],
  providers: [UrlService, UrlRefreshScheduler],
})
export class UrlModule {}

