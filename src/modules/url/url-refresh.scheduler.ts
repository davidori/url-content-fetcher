import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Url, UrlDocument } from './schemas/url.schema';
import { Content, ContentDocument } from './schemas/content.schema';

@Injectable()
export class UrlRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(UrlRefreshScheduler.name);
  private readonly refetchIntervalHours: number;
  private readonly refetchCheckIntervalMinutes: number;

  constructor(
    @InjectModel(Url.name) private urlModel: Model<UrlDocument>,
    @InjectModel(Content.name) private contentModel: Model<ContentDocument>,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    this.refetchIntervalHours = this.configService.get<number>('refetch.intervalHours');
    this.refetchCheckIntervalMinutes = this.configService.get<number>('refetch.checkIntervalMinutes');
  }

  onModuleInit() {
    // Set up dynamic interval for refetch based on configuration
    const intervalMs = this.refetchCheckIntervalMinutes * 60 * 1000;
    const interval = setInterval(() => {
      this.refetchStaleUrls();
    }, intervalMs);

    this.schedulerRegistry.addInterval('refetch-stale-urls', interval);
    this.logger.log(
      `Automatic refetch scheduled every ${this.refetchCheckIntervalMinutes} minutes for URLs older than ${this.refetchIntervalHours} hours`,
    );
  }

  async refetchStaleUrls(): Promise<void> {
    this.logger.log('Starting periodic refetch of stale URLs...');

    try {
      const staleUrls = await this.findStaleUrls();

      if (staleUrls.length === 0) {
        this.logger.log('No stale URLs found for refetch.');
        return;
      }

      this.logger.log(`Found ${staleUrls.length} stale URL(s) to refetch (includes both successful and failed URLs for retry).`);

      const { successCount, errorCount } = await this.processStaleUrls(staleUrls);

      this.logger.log(
        `Refetch completed. Success: ${successCount}, Failed: ${errorCount}, Total: ${staleUrls.length}`,
      );
    } catch (error) {
      this.logger.error('Error in refetch process:', error.message);
    }
  }

  private async findStaleUrls(): Promise<UrlDocument[]> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - this.refetchIntervalHours);

    // Refetch ALL stale URLs (both success and error)
    // This allows previously failed URLs to be retried
    return this.urlModel
      .find({
        updatedAt: { $lt: cutoffTime },
      })
      .exec();
  }

  private async processStaleUrls(
    staleUrls: UrlDocument[],
  ): Promise<{ successCount: number; errorCount: number }> {
    let successCount = 0;
    let errorCount = 0;

    for (const urlDoc of staleUrls) {
      try {
        this.logger.log(`Refetching URL: ${urlDoc.url} (last updated: ${urlDoc.updatedAt})`);

        const result = await this.fetchUrlContent(urlDoc.url);

        if (result.status === 'success' && result.content) {
          await this.updateSuccessfulRefetch(urlDoc, {
            content: result.content,
            contentType: result.contentType,
            contentLength: result.contentLength,
            finalUrl: result.finalUrl,
            redirects: result.redirects,
          });
          successCount++;
          this.logger.log(`Successfully refetched: ${urlDoc.url}`);
        } else {
          await this.updateFailedRefetch(urlDoc, result.errorMessage);
          errorCount++;
          this.logger.warn(`Failed to refetch ${urlDoc.url}: ${result.errorMessage}`);
        }
      } catch (error) {
        this.logger.error(`Error refetching URL ${urlDoc.url}:`, error.message);
        await this.handleRefetchError(urlDoc, error);
        errorCount++;
      }
    }

    return { successCount, errorCount };
  }

  private async updateSuccessfulRefetch(
    urlDoc: UrlDocument,
    result: { content: string; contentType?: string; contentLength?: number; finalUrl?: string; redirects?: string[] },
  ): Promise<void> {
    // Update existing content or create new one
    const existingContent = await this.contentModel.findOne({ url: urlDoc.url }).exec();

    if (existingContent) {
      existingContent.content = result.content;
      await existingContent.save();
    } else {
      const contentDoc = new this.contentModel({
        url: urlDoc.url,
        content: result.content,
      });
      const savedContent = await contentDoc.save();
      urlDoc.contentId = savedContent._id as any;
    }

    // Update URL metadata
    urlDoc.status = 'success';
    urlDoc.redirects = result.redirects || [];
    urlDoc.contentType = result.contentType;
    urlDoc.contentLength = result.contentLength;
    urlDoc.finalUrl = result.finalUrl;
    urlDoc.errorMessage = undefined;
    await urlDoc.save();
  }

  private async updateFailedRefetch(urlDoc: UrlDocument, errorMessage?: string): Promise<void> {
    urlDoc.status = 'error';
    urlDoc.errorMessage = errorMessage || 'Unknown error';
    await urlDoc.save();
  }

  private async handleRefetchError(urlDoc: UrlDocument, error: any): Promise<void> {
    try {
      urlDoc.status = 'error';
      urlDoc.errorMessage = error.message || 'Unknown error during refetch';
      await urlDoc.save();
    } catch (dbError) {
      this.logger.error(`Error updating URL ${urlDoc.url} in database:`, dbError.message);
    }
  }

  // TODO: Extract this to a shared UrlFetchService to avoid duplication
  private async fetchUrlContent(url: string): Promise<{
    status: string;
    content?: string;
    contentType?: string;
    contentLength?: number;
    finalUrl?: string;
    redirects?: string[];
    errorMessage?: string;
  }> {
    // This is duplicated from UrlService - should be extracted to a shared service
    // For now, importing axios and implementing fetch logic
    const axios = require('axios');
    const maxRedirects = this.configService.get<number>('contentFetching.maxRedirects');
    const contentSizeLimit = this.configService.get<number>('contentFetching.sizeLimit');

    const redirects: string[] = [];
    let currentUrl = url;
    let redirectCount = 0;

    try {
      while (redirectCount <= maxRedirects) {
        const response = await axios.get(currentUrl, {
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
          maxContentLength: contentSizeLimit,
          responseType: 'text',
          timeout: 30000,
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location;
          if (!location) {
            throw new Error('Redirect response without Location header');
          }

          const redirectUrl = new URL(location, currentUrl).href;
          redirects.push(redirectUrl);

          if (redirectCount >= maxRedirects) {
            throw new Error(`Too many redirects (max: ${maxRedirects})`);
          }

          currentUrl = redirectUrl;
          redirectCount++;
          continue;
        }

        const content = response.data;
        const contentType = response.headers['content-type'];
        const contentLength = content.length;

        if (contentLength > contentSizeLimit) {
          throw new Error(`Content size (${contentLength} bytes) exceeds limit (${contentSizeLimit} bytes)`);
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

      throw new Error(`Too many redirects (max: ${maxRedirects})`);
    } catch (error) {
      return {
        status: 'error',
        errorMessage: error.response?.statusText || error.message || 'Failed to fetch content',
        redirects: redirects.length > 0 ? redirects : undefined,
      };
    }
  }
}

