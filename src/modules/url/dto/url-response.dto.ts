export class UrlMetadataDto {
  url: string;
  status: string;
  errorMessage?: string;
  redirects?: string[];
  contentType?: string;
  contentLength?: number;
  finalUrl?: string;
  content?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export class StoreUrlsResponseDto {
  success: UrlMetadataDto[];
  failed: UrlMetadataDto[];
}

export class GetUrlsResponseDto {
  urls: UrlMetadataDto[];
}

