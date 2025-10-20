import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import axios, { AxiosResponse } from 'axios';
import { Url, UrlDocument } from './schemas/url.schema';
import { Content, ContentDocument } from './schemas/content.schema';
import { UrlMetadataDto, StoreUrlsResponseDto, GetUrlsResponseDto } from './dto/url-response.dto';

@Injectable()
export class UrlService {
  private readonly logger = new Logger(UrlService.name);
  private readonly contentSizeLimit: number;
  private readonly maxRedirects: number;

  constructor(
    @InjectModel(Url.name) private urlModel: Model<UrlDocument>,
    @InjectModel(Content.name) private contentModel: Model<ContentDocument>,
    private configService: ConfigService,
  ) {
    this.contentSizeLimit = this.configService.get<number>('contentFetching.sizeLimit');
    this.maxRedirects = this.configService.get<number>('contentFetching.maxRedirects');
  }

  async storeUrls(urls: string[]): Promise<StoreUrlsResponseDto> {
    const success: UrlMetadataDto[] = [];
    const failed: UrlMetadataDto[] = [];

    for (const url of urls) {
      try {
        const existingUrl = await this.urlModel.findOne({ url }).populate('contentId').exec();
        
        if (existingUrl) {
          this.handleExistingUrl(existingUrl, success, failed);
          continue;
        }

        await this.handleNewUrl(url, success, failed);
      } catch (error) {
        this.logger.error(`Error processing URL ${url}:`, error.message);
        await this.handleUrlError(url, error, failed);
      }
    }

    return { success, failed };
  }

  private handleExistingUrl(
    existingUrl: UrlDocument,
    success: UrlMetadataDto[],
    failed: UrlMetadataDto[],
  ): void {
    this.logger.log(`URL already exists: ${existingUrl.url}`);

    const urlMetadata: UrlMetadataDto = {
      url: existingUrl.url,
      status: existingUrl.status,
      errorMessage: existingUrl.errorMessage,
      redirects: existingUrl.redirects,
      createdAt: existingUrl.createdAt,
      updatedAt: existingUrl.updatedAt,
    };

    if (existingUrl.status === 'error' || existingUrl.errorMessage) {
      failed.push(urlMetadata);
    } else {
      success.push({
        ...urlMetadata,
        contentType: existingUrl.contentType,
        contentLength: existingUrl.contentLength,
        finalUrl: existingUrl.finalUrl,
        content: (existingUrl.contentId as any)?.content,
      });
    }
  }

  private async handleNewUrl(
    url: string,
    success: UrlMetadataDto[],
    failed: UrlMetadataDto[],
  ): Promise<void> {
    const result = await this.fetchUrlContent(url);

    if (result.status === 'success' && result.content) {
      const urlMetadata = await this.storeSuccessfulUrl(url, {
        content: result.content,
        contentType: result.contentType,
        contentLength: result.contentLength,
        finalUrl: result.finalUrl,
        redirects: result.redirects,
      });
      success.push(urlMetadata);
    } else {
      const urlMetadata = await this.storeFailedUrl(url, {
        errorMessage: result.errorMessage || 'Unknown error',
        redirects: result.redirects,
      });
      failed.push(urlMetadata);
    }
  }

  private async storeSuccessfulUrl(
    url: string,
    result: {
      content: string;
      contentType?: string;
      contentLength?: number;
      finalUrl?: string;
      redirects?: string[];
    },
  ): Promise<UrlMetadataDto> {
    // Store content first
    const contentDoc = new this.contentModel({
      url,
      content: result.content,
    });
    const savedContent = await contentDoc.save();

    // Store URL metadata with content reference
    const urlDoc = new this.urlModel({
      url,
      status: 'success',
      redirects: result.redirects,
      contentType: result.contentType,
      contentLength: result.contentLength,
      finalUrl: result.finalUrl,
      contentId: savedContent._id,
    });
    const savedUrl = await urlDoc.save();

    return {
      url: savedUrl.url,
      status: savedUrl.status,
      redirects: savedUrl.redirects,
      contentType: savedUrl.contentType,
      contentLength: savedUrl.contentLength,
      finalUrl: savedUrl.finalUrl,
      content: result.content,
      createdAt: savedUrl.createdAt,
      updatedAt: savedUrl.updatedAt,
    };
  }

  private async storeFailedUrl(
    url: string,
    result: { errorMessage: string; redirects?: string[] },
  ): Promise<UrlMetadataDto> {
    const urlDoc = new this.urlModel({
      url,
      status: 'error',
      errorMessage: result.errorMessage,
      redirects: result.redirects || [],
    });
    const savedUrl = await urlDoc.save();

    return {
      url: savedUrl.url,
      status: savedUrl.status,
      errorMessage: savedUrl.errorMessage,
      redirects: savedUrl.redirects,
      createdAt: savedUrl.createdAt,
      updatedAt: savedUrl.updatedAt,
    };
  }

  private async handleUrlError(
    url: string,
    error: any,
    failed: UrlMetadataDto[],
  ): Promise<void> {
    try {
      const urlMetadata = await this.storeFailedUrl(url, {
        errorMessage: error.message || 'Unknown error occurred',
        redirects: [],
      });
      failed.push(urlMetadata);
    } catch (dbError) {
      this.logger.error(`Error saving failed URL ${url} to database:`, dbError.message);
      failed.push({
        url,
        status: 'error',
        errorMessage: error.message || 'Unknown error occurred',
      });
    }
  }

  async getAllUrls(): Promise<GetUrlsResponseDto> {
    // Use populate() for efficient single-query fetch
    const urls = await this.urlModel.find().populate('contentId').exec();
    
    const urlsWithContent: UrlMetadataDto[] = urls.map((url) => ({
      url: url.url,
      status: url.status,
      errorMessage: url.errorMessage,
      redirects: url.redirects,
      contentType: url.contentType,
      contentLength: url.contentLength,
      finalUrl: url.finalUrl,
      content: (url.contentId as any)?.content,
      createdAt: url.createdAt,
      updatedAt: url.updatedAt,
    }));

    return { urls: urlsWithContent };
  }

  private async fetchUrlContent(url: string): Promise<{
    status: string;
    content?: string;
    contentType?: string;
    contentLength?: number;
    finalUrl?: string;
    redirects?: string[];
    errorMessage?: string;
  }> {
    const redirects: string[] = [];
    let currentUrl = url;
    let redirectCount = 0;

    try {
      while (redirectCount <= this.maxRedirects) {
        this.logger.log(`Fetching URL (attempt ${redirectCount + 1}): ${currentUrl}`);

        const response: AxiosResponse = await axios.get(currentUrl, {
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
          maxContentLength: this.contentSizeLimit,
          responseType: 'text',
          timeout: 30000, // 30 seconds timeout
        });

        // Check for redirects
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          
          if (!location) {
            throw new Error('Redirect response without Location header');
          }

          // Handle relative URLs
          const redirectUrl = new URL(location, currentUrl).href;
          redirects.push(redirectUrl);
          
          if (redirectCount >= this.maxRedirects) {
            throw new Error(`Too many redirects (max: ${this.maxRedirects})`);
          }

          currentUrl = redirectUrl;
          redirectCount++;
          continue;
        }

        // Success case
        const content = response.data;
        const contentType = response.headers['content-type'];
        const contentLength = content.length;

        // Check content size
        if (contentLength > this.contentSizeLimit) {
          throw new Error(`Content size (${contentLength} bytes) exceeds limit (${this.contentSizeLimit} bytes)`);
        }

        return {
          status: 'success',
          content,
          contentType,
          contentLength,
          finalUrl: currentUrl !== url ? currentUrl : undefined,
          redirects: redirects.length > 0 ? redirects : undefined,
        };
      }

      throw new Error(`Too many redirects (max: ${this.maxRedirects})`);
    } catch (error) {
      this.logger.error(`Error fetching URL ${url}:`, error.message);
      
      return {
        status: 'error',
        errorMessage: error.response?.statusText || error.message || 'Failed to fetch content',
        redirects: redirects.length > 0 ? redirects : undefined,
      };
    }
  }
}

