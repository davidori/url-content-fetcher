import { IsArray, IsString, IsUrl, ArrayNotEmpty } from 'class-validator';

export class StoreUrlsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  urls: string[];
}

