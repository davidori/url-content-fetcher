import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { UrlService } from './url.service';
import { StoreUrlsDto } from './dto/store-urls.dto';
import { StoreUrlsResponseDto, GetUrlsResponseDto } from './dto/url-response.dto';

@Controller('urls')
export class UrlController {
  constructor(private readonly urlService: UrlService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async storeUrls(@Body() storeUrlsDto: StoreUrlsDto): Promise<StoreUrlsResponseDto> {
    return this.urlService.storeUrls(storeUrlsDto.urls);
  }

  @Get()
  async getAllUrls(): Promise<GetUrlsResponseDto> {
    return this.urlService.getAllUrls();
  }
}

